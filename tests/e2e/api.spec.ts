import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, fixture: string) {
  await page.goto(`/fixtures/${fixture}`);
  await page.waitForFunction(() => (window as any).cuReady === true);
}

const hidden = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-cu="h"]').length);

test.describe('api', () => {
  test('long page, in-view: only nearby areas hide at first; scrolling to the bottom completes everything', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, 'long.html');
    await page.evaluate(() => {
      const w = window as any;
      w.finished = false;
      w.run = w.curchestra({ seed: 1, speed: 8, trigger: 'in-view' }).page();
      w.run.done.then(() => (w.finished = true));
    });
    await page.waitForFunction(() => document.querySelector('#s0')!.hasAttribute('data-cu'));
    const far = await page.evaluate(() =>
      [3, 4, 5, 6, 7, 8, 9].map((i) => document.querySelector(`#s${i}`)!.hasAttribute('data-cu')),
    );
    expect(far.every((x) => x === false)).toBe(true);

    const deadline = Date.now() + 70_000;
    while (Date.now() < deadline) {
      if (await page.evaluate(() => (window as any).finished === true)) break;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.7));
      await page.waitForTimeout(250);
    }
    expect(await page.evaluate(() => (window as any).finished)).toBe(true);
    expect(await hidden(page)).toBe(0);
    const built = await page.evaluate(() =>
      [...document.querySelectorAll('.v')].every((s) => s.getAttribute('data-cu') === 'v'),
    );
    expect(built).toBe(true);
  });

  test('page() default trigger: far sections are not hidden or scanned at start (R31)', async ({ page }) => {
    await open(page, 'long.html');
    const far = await page.evaluate(() => {
      const run = (window as any).curchestra({ seed: 1 }).page();
      const out = [3, 4, 5, 6, 7, 8, 9].map((i) => document.querySelector(`#s${i}`)!.hasAttribute('data-cu'));
      run.finish();
      return out;
    });
    expect(far).toEqual(Array(7).fill(false));
  });

  test('page(): a far section reached after the failsafe is still built by cursors (R31)', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, 'long.html');
    await page.evaluate(() => {
      const w = window as any;
      w.tasksIn8 = 0;
      const swarm = w.curchestra({ seed: 1, speed: 8, failsafe: 800 });
      swarm.on('task', (p: any) => {
        if (p?.el?.closest('#s8')) w.tasksIn8++;
      });
      swarm.page();
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('#s8')!.scrollIntoView());
    await page.waitForFunction(() => (window as any).tasksIn8 > 0, null, { timeout: 10_000 });
  });

  test('inner scroll container: a section build completes', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, 'inner-scroll.html');
    const left = await page.evaluate(async () => {
      const run = (window as any).curchestra({ seed: 1, speed: 8 }).section('#panel');
      await run.done;
      return document.querySelectorAll('[data-cu="h"]').length;
    });
    expect(left).toBe(0);
  });

  test('transition: resolves once the new view is fully visible; swap ran once; new view hid while building', async ({ page }) => {
    await open(page, 'spa.html');
    const r = await page.evaluate(async () => {
      const w = window as any;
      const swarm = w.curchestra({ seed: 1, speed: 8 });
      let hiddenDuring = -1;
      swarm.on('task', () => {
        if (hiddenDuring < 0) hiddenDuring = document.querySelectorAll('[data-cu="h"]').length;
      });
      await swarm.transition(() => w.swap(), { root: '#app' });
      return {
        swaps: w.swapCount,
        hiddenDuring,
        left: document.querySelectorAll('[data-cu="h"]').length,
        viewB: !!document.querySelector('#view-b'),
        viewA: !!document.querySelector('#view-a'),
      };
    });
    expect(r.swaps).toBe(1);
    expect(r.viewB).toBe(true);
    expect(r.viewA).toBe(false);
    expect(r.hiddenDuring).toBeGreaterThan(0);
    expect(r.left).toBe(0);
  });

  test('transition: the fade-out fallback path also builds the new view', async ({ page }) => {
    await open(page, 'spa.html');
    const r = await page.evaluate(async () => {
      const w = window as any;
      (document as any).startViewTransition = undefined;
      const swarm = w.curchestra({ seed: 1, speed: 8 });
      await swarm.transition(() => w.swap(), { root: '#app' });
      const app = document.querySelector('#app') as HTMLElement;
      return {
        swaps: w.swapCount,
        left: document.querySelectorAll('[data-cu="h"]').length,
        opacity: getComputedStyle(app).opacity,
        anims: app.getAnimations().length,
      };
    });
    expect(r).toEqual({ swaps: 1, left: 0, opacity: '1', anims: 0 });
  });

  test('transition: an update() that throws reveals and rethrows', async ({ page }) => {
    await open(page, 'spa.html');
    const r = await page.evaluate(async () => {
      const swarm = (window as any).curchestra({ seed: 1, speed: 8 });
      let msg = '';
      try {
        await swarm.transition(
          () => {
            throw new Error('nope');
          },
          { root: '#app' },
        );
      } catch (e) {
        msg = (e as Error).message;
      }
      return { msg, left: document.querySelectorAll('[data-cu="h"]').length };
    });
    expect(r).toEqual({ msg: 'nope', left: 0 });
  });

  test('data-cu-speed makes that section build faster @perf', async ({ page }) => {
    const time = async (speedAttr: string | null) => {
      await open(page, 'spa.html');
      return page.evaluate(async (attr) => {
        const el = document.querySelector('#view-a')!;
        if (attr) el.setAttribute('data-cu-speed', attr);
        const t0 = performance.now();
        await (window as any).curchestra({ seed: 1 }).section(el, { trigger: 'load' }).done;
        return performance.now() - t0;
      }, speedAttr);
    };
    const slow = await time(null);
    const fast = await time('3');
    expect(fast).toBeLessThan(slow * 0.75);
  });

  test('page() twice returns the same Run and does no duplicate work; section() during page() reuses the area', async ({ page }) => {
    test.setTimeout(60_000);
    // Tall enough that every section is near the viewport and starts at once (R31).
    await page.setViewportSize({ width: 1280, height: 2000 });
    const run = async (twice: boolean) => {
      await open(page, 'landing.html');
      return page.evaluate(async (again) => {
        const swarm = (window as any).curchestra({ seed: 1, speed: 12 });
        let tasks = 0;
        swarm.on('task', () => tasks++);
        const first = swarm.page();
        let same = true;
        let sectionSame = true;
        if (again) {
          same = swarm.page() === first;
          const a = swarm.section('#cards');
          sectionSame = a === swarm.section('#cards') && a !== first;
        }
        await first.done;
        return { same, sectionSame, tasks };
      }, twice);
    };
    const once = await run(false);
    const twice = await run(true);
    expect(once.tasks).toBeGreaterThan(0);
    expect(twice.same).toBe(true);
    expect(twice.sectionSame).toBe(true);
    expect(twice.tasks).toBe(once.tasks);
  });

  test('finish() reveals not-yet-added in-view areas and resolves done', async ({ page }) => {
    await open(page, 'long.html');
    const r = await page.evaluate(async () => {
      const swarm = (window as any).curchestra({ seed: 1, trigger: 'in-view' });
      const run = swarm.page();
      await new Promise((res) => setTimeout(res, 100));
      run.finish();
      await run.done;
      return {
        left: document.querySelectorAll('[data-cu="h"]').length,
        ready: document.documentElement.classList.contains('cu-ready'),
      };
    });
    expect(r).toEqual({ left: 0, ready: true });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    expect(await hidden(page)).toBe(0);
  });
});

test.describe('fix round 1', () => {
  test('page() after its Run completed returns that Run and does not rebuild', async ({ page }) => {
    await open(page, 'spa.html');
    const r = await page.evaluate(async () => {
      const swarm = (window as any).curchestra({ seed: 1, speed: 12 });
      const first = swarm.page();
      await first.done;
      let rehidden = 0;
      new MutationObserver((recs) => {
        for (const rec of recs) if ((rec.target as Element).getAttribute('data-cu') === 'h') rehidden++;
      }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-cu'] });
      const again = swarm.page();
      await new Promise((res) => setTimeout(res, 100));
      return { same: again === first, rehidden, left: document.querySelectorAll('[data-cu="h"]').length };
    });
    expect(r).toEqual({ same: true, rehidden: 0, left: 0 });
  });

  test('mixed triggers: an in-view area within a viewport is hidden in the same task as cu-ready, after it (R30)', async ({ page }) => {
    await open(page, 'long.html');
    const order = await page.evaluate(() => {
      document.querySelector('#s0')!.setAttribute('data-cu-trigger', 'load');
      const s1 = document.querySelector('#s1')!;
      const mo = new MutationObserver(() => {});
      mo.observe(s1, { attributes: true, attributeFilter: ['data-cu'] });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      const run = (window as any).curchestra({ seed: 1, trigger: 'in-view' }).page();
      // Taken synchronously: both writes happened inside the page() call.
      const log = mo.takeRecords().map((r) => (r.target === s1 ? 's1-hidden' : 'ready'));
      run.finish();
      return log;
    });
    expect(order.slice(0, 2)).toEqual(['ready', 's1-hidden']);
  });

  test('page() reads every section position before it hides anything', async ({ page }) => {
    await open(page, 'long.html');
    const marked = await page.evaluate(() => {
      const s3 = document.querySelector('#s3')!;
      const orig = Element.prototype.getBoundingClientRect;
      let first: boolean | null = null;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this === s3 && first === null) first = document.querySelector('[data-cu]') !== null;
        return orig.call(this);
      };
      (window as any).curchestra({ seed: 1, trigger: 'in-view' }).page();
      Element.prototype.getBoundingClientRect = orig;
      return first;
    });
    // Reading #s3 after another section was marked would force a style recalc mid-task.
    expect(marked).toBe(false);
  });

  test('per-call frenzy bounds (min 36, max 48) raise the crew above the instance maximum of 30', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/fixtures/big.html');
    await page.waitForFunction(() => (window as any).cuReady === true && (window as any).bigReady === true);
    const peak = await page.evaluate(async () => {
      const cu = (window as any).cu;
      const eng = cu.createEngine(cu.browserHost(), cu.resolveConfig({ seed: 1 }));
      const run = eng.addArea(document.body, cu.resolveConfig({ seed: 1, preset: 'frenzy', agents: { min: 36 } }), 'page');
      let max = 0;
      const until = performance.now() + 45_000;
      while (performance.now() < until && max <= 30) {
        await new Promise((res) => setTimeout(res, 200));
        max = Math.max(max, eng.stats().cursors.length);
      }
      run.cancel();
      eng.destroy();
      return max;
    });
    expect(peak).toBeGreaterThan(30);
  });

  test('instance-level keys in per-call options warn once in dev', async ({ page }) => {
    await open(page, 'spa.html');
    const warnings: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    await page.evaluate(() => {
      const swarm = (window as any).curchestra({ seed: 1, speed: 12 });
      swarm.section('#view-a', { seed: 5, trigger: 'load' });
      swarm.section('#app', { theme: 'dark', trigger: 'manual' });
    });
    expect(warnings.filter((w) => w.includes('seed') || w.includes('theme'))).toHaveLength(1);
  });
});

test.describe('script tag', () => {
  test('the IIFE build reads data-curchestra, adds cu-ready and builds the page', async ({ page }) => {
    await page.goto('/fixtures/script-tag.html');
    await page.waitForFunction(() => document.documentElement.classList.contains('cu-ready'));
    expect(await page.evaluate(() => typeof (window as any).Curchestra?.curchestra)).toBe('function');
    // Well under the 15 s failsafe, so this is the real build finishing.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-cu="h"]').length === 0 && document.querySelectorAll('[data-cu="v"]').length > 0,
      null,
      { timeout: 10_000 },
    );
  });

  test('with preload.css the intro hides and builds the pieces inside the sections, not just the roots (R30)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.hiddenPieces = new Set<Element>();
      new MutationObserver((recs) => {
        for (const r of recs) {
          const t = r.target as Element;
          if (t.getAttribute('data-cu') === 'h' && !t.hasAttribute('data-cu-section')) w.hiddenPieces.add(t);
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-cu'] });
    });
    await page.goto('/fixtures/script-tag.html');
    await page.waitForFunction(() => document.documentElement.classList.contains('cu-ready'));
    await page.waitForFunction(() => document.querySelectorAll('[data-cu="h"]').length === 0, null, { timeout: 10_000 });
    // h1, p and .box are pieces: each was hidden and then built.
    expect(await page.evaluate(() => (window as any).hiddenPieces.size)).toBeGreaterThanOrEqual(3);
  });

  test('preload.css reveals the content after the failsafe when the script never loads', async ({ page }) => {
    await page.route('**/curchestra.js', (r) => r.abort());
    await page.goto('/fixtures/script-blocked.html');
    const vis = () => page.evaluate(() => getComputedStyle(document.querySelector('#only')!).visibility);
    expect(await vis()).toBe('hidden');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#only')!).visibility === 'visible', null, {
      timeout: 5000,
    });
    expect(await page.evaluate(() => document.documentElement.classList.contains('cu-ready'))).toBe(false);
  });

  for (const mode of ['none', 'bogus']) {
    test(`data-curchestra="${mode}" adds cu-ready so preload.css does not hide the content`, async ({ page }) => {
      await page.goto(`/fixtures/script-${mode}.html`);
      await page.waitForFunction(() => document.documentElement.classList.contains('cu-ready'), null, { timeout: 1000 });
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('#only')!).visibility)).toBe('visible');
      expect(await page.evaluate(() => document.querySelectorAll('[data-cu]').length)).toBe(0);
    });
  }

  test.describe('sound', () => {
    const audioRequests = (page: Page) => {
      const urls: string[] = [];
      page.on('request', (r) => {
        if (/\/src\/audio\/index/.test(r.url())) urls.push(r.url());
      });
      return urls;
    };

    test('sound: false never requests the audio chunk', async ({ page }) => {
      const urls = audioRequests(page);
      await open(page, 'long.html');
      await page.evaluate(() => {
        const w = window as any;
        w.run = w.curchestra({ seed: 1, speed: 8, sound: false }).page();
      });
      await page.waitForTimeout(500);
      expect(urls).toEqual([]);
    });

    test('a first click creates exactly one AudioContext and the build completes', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await open(page, 'long.html');
      await page.evaluate(() => {
        const w = window as any;
        w.ctxs = 0;
        const Orig = w.AudioContext ?? w.webkitAudioContext;
        const Counted = function (this: unknown, ...args: unknown[]) {
          w.ctxs++;
          return new Orig(...args);
        } as unknown;
        w.AudioContext = Counted;
        w.finished = false;
        w.run = w.curchestra({ seed: 1, speed: 8, sound: { volume: 0.4 } }).page();
        w.run.done.then(() => (w.finished = true));
      });
      await page.mouse.click(50, 50);
      await expect.poll(() => page.evaluate(() => (window as any).ctxs), { timeout: 5000 }).toBe(1);
      await page.evaluate(() => (window as any).run.finish());
      await page.waitForFunction(() => (window as any).finished === true);
      expect(errors).toEqual([]);
    });

    test('sound: { volume } loads the audio chunk', async ({ page }) => {
      const urls = audioRequests(page);
      await open(page, 'long.html');
      await page.evaluate(() => {
        const w = window as any;
        w.run = w.curchestra({ seed: 1, speed: 8, sound: { volume: 0.4 } }).page();
      });
      await expect.poll(() => urls.length, { timeout: 5000 }).toBeGreaterThan(0);
    });
  });
});
