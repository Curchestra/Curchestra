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

test('median frame time stays within 2 ms at 30 cursors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'perf budget is measured in chromium');
  await build(page, { agents: { min: 30, max: 30 } });
  await page.waitForTimeout(1500);
  const ms: number[] = await page.evaluate(() => (window as any).eng.stats().frameMs);
  expect(ms.length).toBeGreaterThan(30);
  const sorted = [...ms].sort((a, b) => a - b);
  expect(sorted[sorted.length >> 1]).toBeLessThanOrEqual(2);
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
