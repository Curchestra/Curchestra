import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures/lab.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
  await page.evaluate(() => {
    (window as any).vp = () => ({ w: document.documentElement.clientWidth, h: innerHeight });
  });
});


test('canvas is aria-hidden, click-through, and removed on destroy', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const s = cu.createStage(cu.browserHost(), 99, 'light');
    const btn = document.querySelector('#btn')!.getBoundingClientRect();
    const hit = document.elementFromPoint(btn.x + 2, btn.y + 2);
    const out = {
      aria: s.el.getAttribute('aria-hidden'),
      pe: getComputedStyle(s.el).pointerEvents,
      parent: s.el.parentElement === document.documentElement,
      hitIsCanvas: hit === s.el,
      hitId: (hit as HTMLElement).id,
    };
    s.destroy();
    return { ...out, gone: !s.el.isConnected };
  });
  expect(r.aria).toBe('true');
  expect(r.pe).toBe('none');
  expect(r.parent).toBe(true);
  expect(r.hitIsCanvas).toBe(false);
  expect(r.hitId).toBe('btn');
  expect(r.gone).toBe(true);
});

test('getSprite is cached', async ({ page }) => {
  const same = await page.evaluate(() => {
    const cu = (window as any).cu;
    return cu.getSprite('arrow', '#F24E1E', 2, document) === cu.getSprite('arrow', '#F24E1E', 2, document);
  });
  expect(same).toBe(true);
});

test('cursorPath returns a hotspot for each shape', async ({ page }) => {
  const hots = await page.evaluate(() => {
    const cu = (window as any).cu;
    return ['arrow', 'cross', 'ibeam', 'pen', 'dup'].map((s) => cu.cursorPath(s).hot);
  });
  for (const h of hots) {
    expect(h.x).toBeGreaterThanOrEqual(0);
    expect(h.y).toBeLessThanOrEqual(24);
  }
});

test('draw paints cursor and clears when emptied', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const s = cu.createStage(cu.browserHost(), 99, 'light');
    const alpha = (x: number, y: number) => {
      const d = window.devicePixelRatio || 1;
      return s.el.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3];
    };
    const c = {
      id: 1, name: 'Ada', color: '#F24E1E', x: 100, y: 100,
      sx: { x: 100, v: 0 }, sy: { x: 100, v: 0 },
      shape: 'arrow', press: 0, task: null, phase: 'idle', idleFor: 0, seedPhase: 0, alpha: 1,
    };
    s.draw([c], [], true, (window as any).vp());
    const on = alpha(103, 103);
    const tag = alpha(125, 125);
    s.draw([], [], true, (window as any).vp());
    const off = alpha(103, 103);
    const tagOff = alpha(125, 125);
    s.destroy();
    return { on, off, tag, tagOff };
  });
  expect(r.on).toBeGreaterThan(0);
  expect(r.tag).toBeGreaterThan(0);
  expect(r.off).toBe(0);
  expect(r.tagOff).toBe(0);
});

test('hidden cursors and all deco kinds draw without error', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const s = cu.createStage(cu.browserHost(), 99, 'dark');
    const base = {
      id: 1, name: 'Ada', color: '#F24E1E', x: 300, y: 300,
      sx: { x: 0, v: 0 }, sy: { x: 0, v: 0 },
      shape: 'dup', press: 1, task: null, phase: 'hidden', idleFor: 0, seedPhase: 0, alpha: 1,
    };
    const decos = [
      { t: 'outline', r: { x: 10, y: 10, w: 50, h: 30 }, color: '#00f' },
      { t: 'badge', x: 70, y: 10, text: '50 x 30', color: '#00f' },
      { t: 'caret', x: 80, y: 50, h: 16, color: '#0a0' },
      { t: 'guide', x: 200, color: '#f0f' },
      { t: 'path', pts: [{ x: 10, y: 100 }, { x: 60, y: 120 }, { x: 90, y: 90 }], color: '#f00' },
      { t: 'ghost', r: { x: 120, y: 120, w: 40, h: 40 }, color: '#f00' },
      { t: 'media', r: { x: 400, y: 400, w: 100, h: 80 } },
    ];
    s.draw([base], decos, true, (window as any).vp());
    const a = (x: number, y: number) => {
      const d = window.devicePixelRatio || 1;
      return s.el.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3];
    };
    const out = { hiddenCursor: a(303, 303), media: a(410, 410), guide: a(200, 500) };
    s.destroy();
    return out;
  });
  expect(r.hiddenCursor).toBe(0);
  expect(r.media).toBeGreaterThan(0);
  expect(r.guide).toBeGreaterThan(0);
});

test('dirty rect: moving a cursor clears the old position', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const s = cu.createStage(cu.browserHost(), 99, 'light');
    const a = (x: number, y: number) => {
      const d = window.devicePixelRatio || 1;
      return s.el.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3];
    };
    const c = {
      id: 1, name: 'Ada', color: '#F24E1E', x: 100, y: 100,
      sx: { x: 0, v: 0 }, sy: { x: 0, v: 0 },
      shape: 'arrow', press: 0, task: null, phase: 'idle', idleFor: 0, seedPhase: 0, alpha: 1,
    };
    s.draw([c], [], false, (window as any).vp());
    const atA1 = a(103, 103);
    s.draw([{ ...c, x: 400, y: 300 }], [], false, (window as any).vp());
    const out = { atA1, atA: a(103, 103), atB: a(403, 303) };
    s.destroy();
    return out;
  });
  expect(r.atA1).toBeGreaterThan(0);
  expect(r.atA).toBe(0);
  expect(r.atB).toBeGreaterThan(0);
});

test('draw uses the viewport it is given and reads no layout itself', async ({ page }) => {
  const calls = await page.evaluate(() => {
    const cu = (window as any).cu;
    const base = cu.browserHost();
    let n = 0;
    const host = { ...base, viewport: () => (n++, base.viewport()) };
    const s = cu.createStage(host, 99, 'light');
    n = 0;
    const c = {
      id: 1, name: 'Ada', color: '#F24E1E', x: 100, y: 100,
      sx: { x: 100, v: 0 }, sy: { x: 100, v: 0 },
      shape: 'arrow', press: 0, task: null, phase: 'idle', idleFor: 0, seedPhase: 0, alpha: 1,
    };
    s.draw([c], [{ t: 'guide', x: 50, color: '#f0f' }], true, (window as any).vp());
    s.destroy();
    return n;
  });
  expect(calls).toBe(0);
});
