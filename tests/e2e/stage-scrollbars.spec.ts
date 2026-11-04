import { expect, test } from '@playwright/test';

// Headless Chromium hides scrollbars by default; classic scrollbars make 100vw wider than the layout viewport.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures/lab.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
  await page.evaluate(() => {
    (window as any).vp = () => ({ w: document.documentElement.clientWidth, h: innerHeight });
  });
});

test('the canvas CSS size matches its backing size, so decos land on their element', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'scrollbar flag is chromium-only');
  const r = await page.evaluate(() => {
    const cu = (window as any).cu;
    document.body.style.height = '3000px';
    const target = document.createElement('div');
    target.style.cssText = 'position:absolute;right:20px;top:40px;width:100px;height:50px';
    document.body.appendChild(target);
    const s = cu.createStage(cu.browserHost(), 99, 'light');
    const b = target.getBoundingClientRect();
    const css = s.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Where canvas x = b.right ends up on screen once the backing store is stretched to the CSS box.
    const shownRight = css.left + (b.right * css.width) / (s.el.width / dpr);
    s.draw([], [{ t: 'outline', r: { x: b.left, y: b.top, w: b.width, h: b.height }, color: '#00f' }], false, (window as any).vp());
    const out = {
      scrollbar: innerWidth - document.documentElement.clientWidth,
      cssW: s.el.clientWidth,
      docW: document.documentElement.clientWidth,
      drift: Math.abs(shownRight - b.right),
    };
    s.destroy();
    return out;
  });
  expect(r.scrollbar).toBeGreaterThan(0);
  expect(r.cssW).toBe(r.docW);
  expect(r.drift).toBeLessThanOrEqual(2);
});
