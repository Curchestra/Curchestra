import { expect, test, type Page } from '@playwright/test';

const BASE = { seed: 1, speed: 4 };
const FRAME = 1000 / 60;

async function open(page: Page) {
  await page.goto('/fixtures/landing.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
  // A Host with a manual raf queue and a clock advanced by exactly one 60 Hz frame per step (R18).
  await page.evaluate((frame) => {
    const w = window as any;
    w.manualHost = () => {
      const base = w.cu.browserHost();
      let t = 0;
      let next = 1;
      let q: { id: number; cb: (t: number) => void }[] = [];
      const host = {
        ...base,
        now: () => t,
        raf: (cb: (t: number) => void) => {
          q.push({ id: next, cb });
          return next++;
        },
        caf: (id: number) => {
          q = q.filter((e) => e.id !== id);
        },
      };
      const step = (n: number) => {
        for (let i = 0; i < n; i++) {
          t += frame;
          const cur = q;
          q = [];
          for (const e of cur) e.cb(t);
        }
      };
      return { host, step, pending: () => q.length };
    };
    w.desc = (el: Element | null) => {
      if (!el) return 'guide';
      const parent = el.parentElement;
      const idx = parent ? [...parent.children].indexOf(el) : 0;
      return `${el.localName}#${el.id}.${el.className}[${idx}]`;
    };
  }, FRAME);
}

test.beforeEach(({ page }) => open(page));

async function build(page: Page, extra: Record<string, unknown> = {}) {
  await page.evaluate(
    ([cfgIn]) => {
      const w = window as any;
      const cu = w.cu;
      const cfg = cu.resolveConfig(cfgIn);
      const eng = cu.createEngine(cu.browserHost(), cfg);
      w.eng = eng;
      w.completes = 0;
      eng.on('complete', () => w.completes++);
      w.run = eng.addArea(document.body, cfg, 'page');
      w.finished = false;
      w.run.done.then(() => (w.finished = true));
    },
    [{ ...BASE, ...extra }] as const,
  );
}

test('builds the landing page: done resolves, nothing left hidden, complete fires once', async ({ page }) => {
  await build(page);
  await page.waitForFunction(() => (window as any).finished === true, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    hidden: document.querySelectorAll('[data-cu="h"]').length,
    completes: (window as any).completes,
  }));
  expect(r.hidden).toBe(0);
  expect(r.completes).toBe(1);
});

test('orbit: idle cursors gather around the pointer after complete', async ({ page }) => {
  await build(page, { idle: { behavior: 'orbit' } });
  await page.waitForFunction(() => (window as any).completes === 1, null, { timeout: 10_000 });
  await page.mouse.move(400, 300);
  await page.waitForTimeout(2000);
  const cursors = await page.evaluate(() =>
    (window as any).eng.stats().cursors.filter((c: any) => c.phase !== 'leave'),
  );
  expect(cursors.length).toBeGreaterThan(0);
  for (const c of cursors) {
    expect(Math.hypot(c.x - 400, c.y - 300)).toBeLessThanOrEqual(1.3 * 60 + 10);
  }
});

test('sticky nav: the outline tracks the live rect when the page scrolls mid-task', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    eng.addArea(document.body, cfg, 'page');
    const nav = document.querySelector('#nav')!;
    const near = (d: any, r: DOMRect) => d.t === 'outline' && Math.abs(d.r.x - r.left) <= 2 && Math.abs(d.r.y - r.top) <= 2;
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      m.step(1);
      found = eng.stats().decos.some((d: any) => near(d, nav.getBoundingClientRect()));
    }
    window.scrollTo(0, 600);
    m.step(1);
    const live = nav.getBoundingClientRect();
    const tracked = eng.stats().decos.some((d: any) => near(d, live));
    return { found, tracked, navTop: live.top, scrollY: window.scrollY };
  });
  expect(r.found).toBe(true);
  expect(r.scrollY).toBe(600);
  expect(r.navTop).toBe(0);
  expect(r.tracked).toBe(true);
});

test('same seed gives the same task sequence', async ({ page }) => {
  const runOnce = () =>
    page.evaluate(() => {
      const w = window as any;
      const cu = w.cu;
      const m = w.manualHost();
      const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
      const eng = cu.createEngine(m.host, cfg);
      const seq: string[] = [];
      eng.on('task', (p: any) => seq.push(`${p.type}:${w.desc(p.el)}`));
      eng.addArea(document.body, cfg, 'page');
      m.step(600);
      return seq;
    });
  const a = await runOnce();
  await open(page);
  const b = await runOnce();
  expect(a.length).toBeGreaterThan(10);
  expect(b).toEqual(a);
});

test('median frame time stays within 2 ms at 30 cursors @perf', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'perf budget is measured in chromium');
  test.setTimeout(60_000);
  await page.goto('/fixtures/big.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
  const r = await page.evaluate(async () => {
    const w = window as any;
    const cu = w.cu;
    const base = cu.browserHost();
    let frames = 0;
    const host = { ...base, raf: (cb: (t: number) => void) => base.raf((t: number) => (frames++, cb(t))) };
    // big.html (maxTasks 1500 pieces) at speed 0.5 outlasts the 1-per-0.12 s spawn ramp to 30.
    const cfg = cu.resolveConfig({ seed: 1, speed: 0.5, agents: { min: 30, max: 30 } });
    const eng = cu.createEngine(host, cfg);
    let finished = false;
    eng.addArea(document.querySelector('#root'), cfg, 'section').done.then(() => (finished = true));
    const live = () => eng.stats().cursors.filter((c: any) => c.phase !== 'leave').length;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const t0 = performance.now();
    while (live() < 30 && performance.now() - t0 < 15_000) await wait(50);
    const rampMs = performance.now() - t0;
    // ignore ramp-up frames: sample only once 120 frames have run at full crew
    const start = frames;
    while (frames - start < 130 && performance.now() - t0 < 30_000) await wait(50);
    const ms: number[] = eng.stats().frameMs;
    const out = { rampMs, sampled: frames - start, count: live(), finished, ms };
    eng.destroy();
    return out;
  });
  expect(r.count).toBe(30);
  expect(r.finished).toBe(false);
  expect(r.sampled).toBeGreaterThanOrEqual(120);
  expect(r.ms.length).toBe(120);
  const sorted = [...r.ms].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  console.log(`perf: ramp ${Math.round(r.rampMs)} ms, median frame ${median.toFixed(3)} ms at ${r.count} cursors`);
  expect(median).toBeLessThanOrEqual(2);
});

test("an 'idle' listener that adds an area keeps the loop going", async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    // no pointer + noPointer 'stay': idle cursors stand still, so nothing else keeps the loop alive after 'idle'
    const cfg = cu.resolveConfig({ seed: 1, speed: 4, idle: { behavior: 'orbit', noPointer: 'stay' } });
    const eng = cu.createEngine(m.host, cfg);
    let added = false;
    eng.on('idle', () => {
      if (added) return;
      added = true;
      eng.addArea(document.querySelector('#quote'), cfg, 'section');
    });
    eng.addArea(document.querySelector('#hero'), cfg, 'section');
    for (let i = 0; i < 1200 && document.querySelector('#quote')!.getAttribute('data-cu') !== 'v'; i++) m.step(1);
    return { added, quote: document.querySelector('#quote')!.getAttribute('data-cu'), hidden: document.querySelectorAll('[data-cu="h"]').length };
  });
  expect(r).toEqual({ added: true, quote: 'v', hidden: 0 });
});

test('pause and resume inside a listener leave exactly one rAF pending', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    let toggled = false;
    eng.on('task', () => {
      if (toggled) return;
      toggled = true;
      eng.pause();
      eng.resume();
    });
    eng.addArea(document.querySelector('#hero'), cfg, 'section');
    let maxPending = 0;
    for (let i = 0; i < 300; i++) {
      m.step(1);
      maxPending = Math.max(maxPending, m.pending());
    }
    eng.destroy();
    return { toggled, maxPending };
  });
  expect(r).toEqual({ toggled: true, maxPending: 1 });
});

test('a frame that throws is recovered: area revealed, loop usable again (T11)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    eng.__failNextFrame();
    eng.addArea(document.querySelector('#hero'), cfg, 'section');
    let caught = false;
    try { m.step(300); } catch { caught = true; }
    const heroHidden = document.querySelectorAll('#hero [data-cu="h"]').length;
    const pendingAfterThrow = m.pending();
    eng.addArea(document.querySelector('#cards'), cfg, 'section');
    const pendingAfterAdd = m.pending();
    m.step(600);
    return { caught, heroHidden, pendingAfterThrow, pendingAfterAdd, hidden: document.querySelectorAll('[data-cu="h"]').length };
  });
  expect(r.caught).toBe(false);
  expect(r.heroHidden).toBe(0);
  expect(r.pendingAfterThrow).toBe(0);
  expect(r.pendingAfterAdd).toBe(1);
  expect(r.hidden).toBe(0);
});

test('hide: the loop stops after complete', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const cu = w.cu;
    const base = cu.browserHost();
    let frames = 0;
    const host = { ...base, raf: (cb: (t: number) => void) => base.raf((t: number) => (frames++, cb(t))) };
    const cfg = cu.resolveConfig({ seed: 1, speed: 4, idle: { behavior: 'hide' } });
    const eng = cu.createEngine(host, cfg);
    await eng.addArea(document.body, cfg, 'page').done;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < 20; i++) {
      const before = frames;
      await wait(500);
      if (frames === before) {
        return { stopped: true, phases: eng.stats().cursors.map((c: any) => c.phase) };
      }
    }
    return { stopped: false, phases: eng.stats().cursors.map((c: any) => c.phase) };
  });
  expect(r.stopped).toBe(true);
  for (const p of r.phases) expect(p).toBe('hidden');
});

test('addArea returns the existing run for the same root or a descendant', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const cfg = cu.resolveConfig({ seed: 1 });
    const eng = cu.createEngine(cu.browserHost(), cfg);
    const run = eng.addArea(document.body, cfg, 'page');
    const out = {
      same: eng.addArea(document.body, cfg, 'page') === run,
      inner: eng.addArea(document.querySelector('#hero'), cfg, 'section') === run,
      areaFor: eng.areaFor(document.querySelector('#cards .card')) === run,
      outside: eng.areaFor(document.head),
    };
    eng.destroy();
    return out;
  });
  expect(r).toEqual({ same: true, inner: true, areaFor: true, outside: null });
});

test('an outer root skips an inner active area', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cu = (window as any).cu;
    const m = (window as any).manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    const els: string[] = [];
    eng.on('task', (p: any) => p.el && els.push((p.el.closest('#cards') ? 'in' : 'out')));
    const inner = eng.addArea(document.querySelector('#cards'), cfg, 'section');
    const outer = eng.addArea(document.body, cfg, 'page');
    const distinct = inner !== outer;
    // the inner card count of tasks must match a standalone build: 6 cards + 6 h3 + 6 p
    m.step(900);
    return { distinct, inCount: els.filter((e) => e === 'in').length, hidden: document.querySelectorAll('[data-cu="h"]').length };
  });
  expect(r.distinct).toBe(true);
  expect(r.inCount).toBe(18);
  expect(r.hidden).toBe(0);
});

test('cancel reveals without events; finish emits section:done', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cu = (window as any).cu;
    const cfg = cu.resolveConfig({ seed: 1 });
    const eng = cu.createEngine(cu.browserHost(), cfg);
    const ev: string[] = [];
    eng.on('section:done', (root: Element) => ev.push('done:' + root.id));
    eng.on('complete', () => ev.push('complete'));
    const a = eng.addArea(document.querySelector('#hero'), cfg, 'section');
    const b = eng.addArea(document.querySelector('#cards'), cfg, 'section');
    a.cancel();
    await a.done;
    const afterCancel = [...ev];
    b.finish();
    await b.done;
    const hidden = document.querySelectorAll('[data-cu="h"]').length;
    eng.destroy();
    eng.destroy();
    return {
      afterCancel,
      ev,
      hidden,
      canvas: document.querySelectorAll('canvas').length,
      style: document.querySelectorAll('style[data-cu-style]').length,
    };
  });
  expect(r.afterCancel).toEqual([]);
  expect(r.ev).toEqual(['done:cards', 'complete']);
  expect(r.hidden).toBe(0);
  expect(r.canvas).toBe(0);
  expect(r.style).toBe(0);
});

test('task events carry the element; guides carry null', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    // duplicate off: the four identical paragraphs stay text tasks and share a guide
    const cfg = cu.resolveConfig({ seed: 1, speed: 4, effects: { duplicate: false } });
    const eng = cu.createEngine(m.host, cfg);
    const seen: { type: string; el: boolean }[] = [];
    eng.on('task', (p: any) => seen.push({ type: p.type, el: p.el instanceof Element }));
    eng.addArea(document.querySelector('#columns'), cfg, 'section');
    m.step(600);
    return seen;
  });
  expect(r.some((s) => s.type === 'guide' && !s.el)).toBe(true);
  expect(r.filter((s) => s.type === 'text').length).toBe(4);
  expect(r.every((s) => s.type === 'guide' || s.el)).toBe(true);
});

test('a throwing plugin is logged and does not break the frame (T13)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    let unlocked = 0;
    eng.use({ onTask() { throw new Error('boom'); }, onKey() { throw new Error('boom'); }, unlock: () => void unlocked++ });
    eng.addArea(document.querySelector('#hero'), cfg, 'section');
    m.step(600);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    eng.use({ unlock: () => void unlocked++ });
    console.error = orig;
    return { logged: logged.length, tag: logged[0]?.[0], unlocked, hidden: document.querySelectorAll('[data-cu="h"]').length };
  });
  expect(r.logged).toBeGreaterThan(0);
  expect(r.tag).toBe('[curchestra]');
  expect(r.unlocked).toBe(2);
  expect(r.hidden).toBe(0);
});
