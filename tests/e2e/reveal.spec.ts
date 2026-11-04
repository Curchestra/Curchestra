import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures/lab.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
});

const vis = (page: Page, sel: string) => page.$eval(sel, (e) => getComputedStyle(e).visibility);

test('markArea hides root and pieces', async ({ page }) => {
  await page.evaluate(() => {
    const cu = (window as any).cu;
    cu.installStyles(cu.browserHost());
    cu.markArea(document.querySelector('#parent'), [document.querySelector('#piece')]);
  });
  expect(await vis(page, '#parent')).toBe('hidden');
  expect(await vis(page, '#piece')).toBe('hidden');
});

test('show on parent reveals non-piece child, piece child stays hidden', async ({ page }) => {
  await page.evaluate(() => {
    const cu = (window as any).cu;
    cu.installStyles(cu.browserHost());
    cu.markArea(document.querySelector('#parent'), [document.querySelector('#piece')]);
    cu.applyOps([{ op: 'show', el: document.querySelector('#parent') }]);
  });
  await expect.poll(() => vis(page, '#plain')).toBe('visible');
  await expect.poll(() => vis(page, '#piece')).toBe('hidden');
});

test('clip sets a clip-path, revealAll clears it and cleans up', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    cu.installStyles(cu.browserHost());
    const el = document.querySelector('#piece') as HTMLElement;
    cu.markArea(document.querySelector('#parent'), [el]);
    const b = el.getBoundingClientRect();
    const lines = [{ x: b.left, y: b.top, w: b.width, h: b.height }];
    cu.applyOps([{ op: 'clip', el, lines, progress: 0.5, rtl: false }]);
    const during = el.style.clipPath;
    cu.revealAll(document);
    return {
      during,
      after: el.style.clipPath,
      attrs: document.querySelectorAll('[data-cu]').length,
      styles: document.querySelectorAll('style[data-cu-style]').length,
    };
  });
  expect(r.during).toContain('polygon');
  expect(r.after).toBe('');
  expect(r.attrs).toBe(0);
  expect(r.styles).toBe(0);
});

test('unclip clears clip-path', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const el = document.querySelector('#piece') as HTMLElement;
    const lines = [{ x: 0, y: 0, w: 10, h: 10 }];
    cu.applyOps([{ op: 'clip', el, lines, progress: 0.5, rtl: false }]);
    cu.applyOps([{ op: 'unclip', el }]);
    return el.style.clipPath;
  });
  expect(r).toBe('');
});

test('installStyles is refcounted', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    const h = cu.browserHost();
    const d1 = cu.installStyles(h);
    const d2 = cu.installStyles(h);
    const n = () => document.querySelectorAll('style[data-cu-style]').length;
    d1();
    const afterFirst = n();
    d2();
    return { afterFirst, afterSecond: n() };
  });
  expect(r.afterFirst).toBe(1);
  expect(r.afterSecond).toBe(0);
});

test('revealArea shows root and pieces and clears their clips', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    cu.installStyles(cu.browserHost());
    const parent = document.querySelector('#parent')!;
    const piece = document.querySelector('#piece') as HTMLElement;
    cu.markArea(parent, [piece]);
    cu.applyOps([{ op: 'clip', el: piece, lines: [{ x: 0, y: 0, w: 10, h: 10 }], progress: 0.5, rtl: false, elRect: { x: 0, y: 0, w: 10, h: 10 } }]);
    const clippedBefore = piece.style.clipPath !== '';
    cu.revealArea(parent, [piece]);
    return {
      clippedBefore,
      clip: piece.style.clipPath,
      root: parent.getAttribute('data-cu'),
      piece: piece.getAttribute('data-cu'),
    };
  });
  expect(r).toEqual({ clippedBefore: true, clip: '', root: 'v', piece: 'v' });
});
