import { expect, test, type Page } from '@playwright/test';

const SLOW = { seed: 1, speed: 0.01 };

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures/landing.html');
  await page.waitForFunction(() => (window as any).cuReady === true);
});

/** Creates window.eng and returns nothing; `areas` are CSS selectors (default: body, page mode). */
async function build(page: Page, cfgIn: Record<string, unknown>, areas: string[] = ['body'], failNext = false) {
  await page.evaluate(
    ([cfgArg, sels, failFirst]) => {
      const w = window as any;
      const cfg = w.cu.resolveConfig(cfgArg);
      const eng = w.cu.createEngine(w.cu.browserHost(), cfg);
      w.eng = eng;
      w.completes = 0;
      w.finishedBy = {};
      eng.on('complete', () => w.completes++);
      if (failFirst) eng.__failNextFrame();
      w.runs = {};
      for (const sel of sels as string[]) {
        const run = eng.addArea(document.querySelector(sel)!, cfg, sel === 'body' ? 'page' : 'section');
        w.runs[sel] = run;
        run.done.then(() => (w.finishedBy[sel] = performance.now()));
      }
    },
    [cfgIn, areas, failNext] as const,
  );
}

const hidden = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-cu="h"]').length);

test('failsafe reveals everything even when the build is far too slow', async ({ page }) => {
  await build(page, { ...SLOW, failsafe: 300 });
  expect(await hidden(page)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await hidden(page)).toBe(0);
  expect(await page.evaluate(() => (window as any).completes)).toBe(1);
});

test('an error inside a frame reveals everything and is logged', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await build(page, { ...SLOW, failsafe: 60_000 }, ['body'], true);
  await page.waitForFunction(() => Object.keys((window as any).finishedBy).length === 1, null, { timeout: 2000 });
  expect(await hidden(page)).toBe(0);
  expect(errors.some((e) => e.includes('[curchestra]'))).toBe(true);
});

test('skipOnClick: clicking inside an unbuilt area finishes only that area, quickly', async ({ page }) => {
  await build(page, { ...SLOW, failsafe: 60_000, skipOnClick: true }, ['#cards', '#columns']);
  const box = (await page.locator('.card').first().boundingBox())!;
  const t0 = await page.evaluate(() => performance.now());
  await page.mouse.click(box.x + 20, box.y + 20);
  await page.waitForFunction(() => (window as any).finishedBy['#cards'] !== undefined, null, { timeout: 5000 });
  const done = await page.evaluate(() => (window as any).finishedBy['#cards'] as number);
  expect(done - t0).toBeLessThan(1000);
  const other = await page.evaluate(() => (window as any).finishedBy['#columns']);
  expect(other).toBeUndefined();
  expect(await page.evaluate(() => document.querySelectorAll('#cards [data-cu="h"]').length)).toBe(0);
});

test('by default a click does not skip the build', async ({ page }) => {
  await build(page, { ...SLOW, failsafe: 60_000 }, ['#cards']);
  const box = (await page.locator('.card').first().boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + 20);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).finishedBy['#cards'])).toBeUndefined();
});

test('clicking a revealed link inside an unbuilt area moves focus but does not skip the build', async ({ page }) => {
  await build(page, { seed: 1, speed: 0.3, failsafe: 60_000 });
  await page.waitForFunction(() => !!document.querySelector('#nav a[data-cu="v"]'), null, { timeout: 15_000 });
  const box = (await page.locator('#nav a[data-cu="v"]').first().boundingBox())!;
  await page.evaluate(() => document.querySelector('#nav a[data-cu="v"]')!.addEventListener('click', (e) => e.preventDefault()));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).finishedBy['body'])).toBeUndefined();
  expect(await hidden(page)).toBeGreaterThan(0);
});

test('focusin on an already revealed link inside an unbuilt area finishes it (programmatic focus)', async ({ page }) => {
  await build(page, { seed: 1, speed: 0.3, failsafe: 60_000 });
  await page.waitForFunction(() => !!document.querySelector('#nav a[data-cu="v"]'), null, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).finishedBy['body'])).toBeUndefined();
  // WebKit does not Tab to links by default, so focus the (already revealed) link directly.
  await page.evaluate(() => (document.querySelector('#nav a[data-cu="v"]') as HTMLElement).focus());
  await page.waitForFunction(() => (window as any).finishedBy['body'] !== undefined, null, { timeout: 5000 });
  expect(await hidden(page)).toBe(0);
});

test('Tab into an unbuilt area reveals it first and lands on its link', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not Tab to links by default');
  await build(page, { ...SLOW, failsafe: 60_000 }, ['#nav', '#cards']);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'before';
    b.textContent = 'before';
    document.body.prepend(b);
    b.focus();
  });
  expect(await hidden(page)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => Object.keys((window as any).finishedBy).length === 2, null, { timeout: 5000 });
  expect(await hidden(page)).toBe(0);
  const active = await page.evaluate(() => document.activeElement?.closest('#nav') !== null && document.activeElement?.localName === 'a');
  expect(active).toBe(true);
});

test('cancelled area does not leave a stale failsafe for the next area', async ({ page }) => {
  await build(page, { ...SLOW, failsafe: 400 }, ['#hero']);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const w = window as any;
    w.runs['#hero'].cancel();
    w.cfg2 = w.cu.resolveConfig({ seed: 1, speed: 0.01, failsafe: 400 });
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const w = window as any;
    w.t2 = performance.now();
    w.run2 = w.eng.addArea(document.querySelector('#cards'), w.cfg2, 'section');
    w.run2.done.then(() => (w.end2 = performance.now()));
    setTimeout(() => (w.midEnd2 = w.end2 === undefined ? "pending" : "early"), 300);
  });
  // Checked from a page timer due before the 400 ms failsafe, so host load cannot reorder the two.
  await page.waitForFunction(() => (window as any).midEnd2 !== undefined, null, { timeout: 5000 });
  expect(await page.evaluate(() => (window as any).midEnd2)).toBe("pending");
  await page.waitForFunction(() => (window as any).end2 !== undefined, null, { timeout: 5000 });
  const dur = await page.evaluate(() => (window as any).end2 - (window as any).t2);
  expect(dur).toBeGreaterThanOrEqual(390);
});

test('elements appended mid-build are visible at complete', async ({ page }) => {
  await build(page, { seed: 1, speed: 2, failsafe: 60_000 });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const host = document.querySelector('#columns')!;
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'late';
      d.textContent = `late ${i}`;
      host.appendChild(d);
    }
    // a page is built as the visitor scrolls to it
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForFunction(() => (window as any).completes === 1, null, { timeout: 20_000 });
  const r = await page.evaluate(() => ({
    hidden: document.querySelectorAll('[data-cu="h"]').length,
    vis: [...document.querySelectorAll('.late')].map((e) => getComputedStyle(e).visibility),
  }));
  expect(r.hidden).toBe(0);
  expect(r.vis).toEqual(Array(5).fill('visible'));
});

test('removing an unbuilt card mid-build is silent and complete still fires', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await build(page, { seed: 1, speed: 2, failsafe: 60_000 });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    document.querySelector('.card:nth-child(6)')!.remove();
    document.querySelector('#columns p:last-child')!.remove();
    // a page is built as the visitor scrolls to it
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForFunction(() => (window as any).completes === 1, null, { timeout: 20_000 });
  expect(errors).toEqual([]);
  expect(await hidden(page)).toBe(0);
});

test('reduced motion: nothing is ever hidden and the run is already resolved', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as any).sawHidden = 0;
    new MutationObserver((recs) => {
      for (const r of recs) {
        const t = r.target as Element;
        if (t.getAttribute && t.getAttribute('data-cu') === 'h') (window as any).sawHidden++;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-cu'] });
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).cuReady === true);
  await build(page, { seed: 1, failsafe: 60_000 });
  await page.evaluate(() => (window as any).runs['body'].done);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    saw: (window as any).sawHidden,
    hidden: document.querySelectorAll('[data-cu="h"]').length,
    cursors: (window as any).eng.stats().cursors.length,
  }));
  expect(r.saw).toBe(0);
  expect(r.hidden).toBe(0);
  expect(r.cursors).toBe(0);
});

async function expectClean(page: Page) {
  const r = await page.evaluate(() => ({
    cu: document.querySelectorAll('[data-cu]').length,
    style: document.querySelectorAll('style[data-cu-style]').length,
    clip: [...document.querySelectorAll('*')].filter((e) => (e as HTMLElement).style?.clipPath).length,
    canvas: document.querySelectorAll('canvas').length,
  }));
  expect(r).toEqual({ cu: 0, style: 0, clip: 0, canvas: 0 });
}

test('destroy right after addArea leaves no trace', async ({ page }) => {
  await build(page, { seed: 1, speed: 1, failsafe: 60_000 });
  await page.evaluate(() => (window as any).eng.destroy());
  await page.waitForTimeout(200);
  await expectClean(page);
});

test('destroy mid text clip leaves no trace', async ({ page }) => {
  await build(page, { seed: 1, speed: 1, failsafe: 60_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('*')].some((e) => (e as HTMLElement).style?.clipPath),
    null,
    { timeout: 15_000, polling: 'raf' },
  );
  await page.evaluate(() => (window as any).eng.destroy());
  await page.waitForTimeout(200);
  await expectClean(page);
});

test('a page builds only what the visitor has seen; the failsafe still reveals the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await build(page, { seed: 1, speed: 4, failsafe: 4000 });
  const below = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-cu="h"]')].filter((e) => e.getBoundingClientRect().top > innerHeight).length,
    );
  await page.waitForTimeout(2500);
  // nobody scrolled: work below the fold is still waiting, the page is not complete
  expect(await below()).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).completes)).toBe(0);
  // the failsafe reveals it anyway (screen readers and crawlers never scroll)
  await page.waitForFunction(() => (window as any).completes === 1, null, { timeout: 5000 });
  expect(await hidden(page)).toBe(0);
});
