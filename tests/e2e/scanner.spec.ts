import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, name: string) => {
  await page.goto(`/fixtures/${name}.html`);
  await page.waitForFunction(() => (window as any).cuReady === true);
};

// Runs scan on the body and returns plain-data pieces (DOM ids instead of elements).
type Out = {
  id: number;
  kind: string;
  parent: number | null;
  sig: string;
  rtl: boolean;
  textLen: number;
  domId: string;
  tag: string;
  rect: { x: number; y: number; w: number; h: number };
};
const scanBody = (page: Page, opts: { skip?: string[]; maxTasks?: number } = {}): Promise<Out[]> =>
  page.evaluate((o) => {
    const cu = (window as any).cu;
    const ps = cu.scan(cu.browserHost(), document.body, { skip: o.skip ?? [], maxTasks: o.maxTasks ?? 5000 });
    return ps.map((p: any) => ({
      id: p.id,
      kind: p.kind,
      parent: p.parent,
      sig: p.sig,
      rtl: p.rtl,
      textLen: p.textLen,
      domId: p.el.id,
      tag: p.el.localName,
      rect: p.rect,
    }));
  }, opts);

test.describe('landing', () => {
  test.beforeEach(async ({ page }) => open(page, 'landing'));

  test('six equal-sig card boxes, ids are indices', async ({ page }) => {
    const ps = await scanBody(page);
    const cards = ps.filter((p) => p.kind === 'box' && p.sig === 'div.card');
    expect(cards).toHaveLength(6);
    expect(ps.map((p) => p.id)).toEqual(ps.map((_, i) => i));
  });

  test('cookie bar yields no piece', async ({ page }) => {
    const ps = await scanBody(page);
    expect(ps.find((p) => p.domId === 'cookie')).toBeUndefined();
    expect(ps.some((p) => p.tag === 'button')).toBe(false);
  });

  test('shadow host is one media piece', async ({ page }) => {
    const ps = await scanBody(page);
    const shadow = ps.filter((p) => p.domId === 'shadow');
    expect(shadow).toHaveLength(1);
    expect(shadow[0].kind).toBe('media');
  });

  test('rtl paragraph is flagged', async ({ page }) => {
    const ps = await scanBody(page);
    const rtl = ps.find((p) => p.domId === 'rtl')!;
    expect(rtl.kind).toBe('text');
    expect(rtl.rtl).toBe(true);
    expect(ps.find((p) => p.tag === 'h1')!.rtl).toBe(false);
  });

  test('transparent wrapper is not a piece; child parents to hero', async ({ page }) => {
    const ps = await scanBody(page);
    const hero = ps.find((p) => p.domId === 'hero')!;
    expect(hero.kind).toBe('box');
    expect(ps.some((p) => p.sig === 'div.wrap')).toBe(false);
    expect(ps.find((p) => p.tag === 'h1')!.parent).toBe(hero.id);
  });

  test('quote is a line, columns share x, images are media, nav is a box', async ({ page }) => {
    const ps = await scanBody(page);
    expect(ps.find((p) => p.domId === 'quote')!.kind).toBe('line');
    const cols = ps.filter((p) => p.kind === 'text' && p.rect.w === 480);
    expect(cols.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cols.map((c) => c.rect.x)).size).toBe(1);
    expect(ps.filter((p) => p.tag === 'img').every((p) => p.kind === 'media')).toBe(true);
    expect(ps.find((p) => p.domId === 'nav')!.kind).toBe('box');
  });

  test('rects are document coords and the walk is read-only', async ({ page }) => {
    const before = await page.evaluate(() => document.body.innerHTML);
    await page.evaluate(() => window.scrollTo(0, 300));
    const ps = await scanBody(page);
    const quote = ps.find((p) => p.domId === 'quote')!;
    const docY = await page.$eval('#quote', (e) => e.getBoundingClientRect().top + window.scrollY);
    expect(quote.rect.y).toBeCloseTo(docY, 0);
    expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  });

  test('skip selector and maxTasks', async ({ page }) => {
    const ps = await scanBody(page, { skip: ['#cards'] });
    expect(ps.some((p) => p.sig === 'div.card')).toBe(false);
    const few = await scanBody(page, { maxTasks: 3 });
    expect(few).toHaveLength(3);
  });
});

test.describe('big', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/fixtures/big.html');
    await page.waitForFunction(() => (window as any).cuReady === true && (window as any).bigReady === true);
  });

  test('maxTasks 1500 returns exactly 1500 without touching the DOM', async ({ page }) => {
    const before = await page.evaluate(() => document.body.innerHTML);
    const ps = await scanBody(page, { maxTasks: 1500 });
    expect(ps).toHaveLength(1500);
    expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
  });

  test('scan takes under 40 ms', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timing budget is asserted in chromium only');
    const ms = await page.evaluate(() => {
      const cu = (window as any).cu;
      const host = cu.browserHost();
      const run = () => cu.scan(host, document.body, { skip: [], maxTasks: 1500 });
      run();
      const t0 = performance.now();
      run();
      return performance.now() - t0;
    });
    expect(ms).toBeLessThan(40);
  });
});
