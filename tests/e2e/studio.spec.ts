import { expect, test, type Page } from '@playwright/test';

const FRAME = 1000 / 60;

/** landing.html plus a Host whose clock advances exactly one 60 Hz frame per step (R18). */
async function open(page: Page) {
  await page.goto('/fixtures/landing.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
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
      return { host, step };
    };
  }, FRAME);
}

test.beforeEach(({ page }) => open(page));

test('intro: cursors circle the logo in a tilted ring while the held page stays blank, then go build', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 2, speed: 4 });
    const eng = cu.createEngine(m.host, cfg);
    const hero = document.querySelector('#hero')!;
    const logo = document.querySelector('#nav')!;
    eng.hold(hero);
    eng.intro(logo);
    // the ring is the liquid flow, a lazy chunk: let it land before stepping
    await new Promise((res) => setTimeout(res, 500));
    m.step(150);
    const lr = logo.getBoundingClientRect();
    const cx = lr.left + lr.width / 2;
    const cy = lr.top + lr.height / 2;
    const cs = eng.stats().cursors;
    const ds = cs.map((c: any) => Math.hypot(c.x - cx, c.y - cy));
    const during = {
      n: cs.length,
      allIdle: cs.every((c: any) => c.phase === 'idle'),
      spread: Math.max(...ds) - Math.min(...ds),
      nearest: Math.min(...ds),
      mean: ds.reduce((a: number, b: number) => a + b, 0) / ds.length,
      tilted: cs.filter((c: any) => Math.abs(c.angle) > 10).length,
      heroHidden: getComputedStyle(hero).visibility,
      marksInside: hero.querySelectorAll('[data-cu]').length,
    };
    eng.addArea(hero, cfg, 'section');
    let worked = false;
    for (let i = 0; i < 2400 && document.querySelectorAll('[data-cu="h"]').length; i++) {
      m.step(1);
      worked ||= eng.stats().cursors.some((c: any) => c.phase === 'work');
    }
    return { during, worked, hiddenAfter: document.querySelectorAll('[data-cu="h"]').length };
  });
  expect(r.during.n).toBeGreaterThanOrEqual(6);
  expect(r.during.allIdle).toBe(true);
  // a liquid ring (it breathes and wobbles into petals): nobody near the center, everyone in a band
  expect(r.during.mean).toBeGreaterThan(70);
  expect(r.during.nearest).toBeGreaterThan(r.during.mean * 0.5);
  expect(r.during.spread).toBeLessThan(r.during.mean);
  expect(r.during.tilted).toBeGreaterThan(r.during.n / 2);
  // held: hidden, but not scanned or marked piece by piece yet
  expect(r.during.heroHidden).toBe('hidden');
  expect(r.during.marksInside).toBe(0);
  expect(r.worked).toBe(true);
  expect(r.hiddenAfter).toBe(0);
});

test('rulers slide in while a guide is dragged, with the guide marked on them, then slide out', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 3 });
    const eng = cu.createEngine(m.host, cfg);
    // three different text lines sharing a left edge: they get a guide to line up on
    const box = document.createElement('section');
    box.style.cssText = 'padding:24px 60px';
    box.innerHTML = '<h3 style="margin:0 0 12px">Aligned heading</h3><p style="margin:0 0 12px">A paragraph on the same edge.</p><small>A caption, too</small>';
    document.body.prepend(box);
    window.scrollTo(0, 0);
    eng.addArea(box, cfg, 'section');
    let peak = 0;
    let dragged = false;
    let ewCursor = false;
    for (let i = 0; i < 3000 && document.querySelectorAll('[data-cu="h"]').length; i++) {
      m.step(1);
      const s = eng.stats();
      peak = Math.max(peak, s.rulers);
      dragged ||= s.decos.some((d: any) => d.t === 'guide' && d.drag);
      ewCursor ||= s.cursors.some((c: any) => c.shape === 'ew');
    }
    m.step(120);
    return { peak, dragged, ewCursor, end: eng.stats().rulers };
  });
  expect(r.dragged).toBe(true);
  expect(r.ewCursor).toBe(true);
  expect(r.peak).toBeGreaterThan(0.9);
  expect(r.end).toBe(0);
});

test('rulers stay in while work is on screen, slide out when the visitor scrolls away mid-build, and come back', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 0.1 });
    const eng = cu.createEngine(m.host, cfg);
    // tall filler below so the hero can be scrolled fully out of view
    const pad = document.createElement('div');
    pad.style.height = '3000px';
    document.body.append(pad);
    window.scrollTo(0, 0);
    eng.addArea(document.querySelector('#hero'), cfg, 'section');
    m.step(90);
    const working = eng.stats().rulers;
    window.scrollTo(0, document.documentElement.scrollHeight);
    m.step(90);
    const away = eng.stats().rulers;
    const stillBuilding = document.querySelectorAll('[data-cu="h"]').length > 0;
    window.scrollTo(0, 0);
    m.step(90);
    const back = eng.stats().rulers;
    return { working, away, stillBuilding, back, stillBuildingBack: document.querySelectorAll('[data-cu="h"]').length > 0 };
  });
  expect(r.stillBuilding).toBe(true);
  expect(r.working).toBe(1);
  expect(r.away).toBe(0);
  expect(r.stillBuildingBack).toBe(true);
  expect(r.back).toBe(1);
});

test('a placed guide hides with the rulers when the visitor scrolls away mid-build, and comes back', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const cu = w.cu;
    const m = w.manualHost();
    const cfg = cu.resolveConfig({ seed: 1, speed: 0.3 });
    const eng = cu.createEngine(m.host, cfg);
    // three text lines sharing a left edge get a guide; tall filler lets the box leave the view
    const box = document.createElement('section');
    box.style.cssText = 'padding:24px 60px';
    box.innerHTML = '<h3 style="margin:0 0 12px">Aligned heading</h3><p style="margin:0 0 12px">A paragraph on the same edge, long enough to take a while to type.</p><small>A caption, too, also typed slowly</small>';
    document.body.prepend(box);
    const pad = document.createElement('div');
    pad.style.height = '4000px';
    document.body.append(pad);
    window.scrollTo(0, 0);
    eng.addArea(box, cfg, 'section');
    const placed = () => eng.stats().decos.some((d: any) => d.t === 'guide' && !d.drag);
    let seen = false;
    for (let i = 0; i < 3000 && !seen; i++) {
      m.step(1);
      seen = placed();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    m.step(2);
    const away = placed();
    window.scrollTo(0, 0);
    m.step(2);
    return { seen, away, back: placed(), building: document.querySelectorAll('[data-cu="h"]').length > 0 };
  });
  expect(r.seen).toBe(true);
  expect(r.away).toBe(false);
  expect(r.building).toBe(true);
  expect(r.back).toBe(true);
});

test("trigger 'scroll': the page is blank until the first scroll, then it is built", async ({ page }) => {
  const before = await page.evaluate(() => {
    const w = window as any;
    w.run = w.curchestra({ seed: 1, speed: 8 }).page({ trigger: 'scroll' });
    w.done = false;
    w.run.done.then(() => (w.done = true));
    const roots = [...document.body.children].filter((e) => e.getAttribute('data-cu') === 'h');
    return { roots: roots.length, pieces: document.querySelectorAll('[data-cu] [data-cu]').length };
  });
  expect(before.roots).toBeGreaterThan(0);
  expect(before.pieces).toBe(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelectorAll('[data-cu] [data-cu]').length)).toBe(0);
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 40);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-cu] [data-cu]').length), { timeout: 5000 }).toBeGreaterThan(0);
});

test("trigger 'scroll' with nobody scrolling still builds after the failsafe time", async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.curchestra({ seed: 1, speed: 8 }).page({ trigger: 'scroll', failsafe: 500 });
  });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-cu] [data-cu]').length), { timeout: 4000 }).toBeGreaterThan(0);
});

test('finish() while still waiting for the scroll shows the page as it is', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const run = w.curchestra({ seed: 1 }).page({ trigger: 'scroll', intro: true });
    run.finish();
    return document.querySelectorAll('[data-cu]').length;
  });
  expect(r).toBe(0);
});
