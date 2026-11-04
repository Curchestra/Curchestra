import { describe, expect, test, vi } from 'vitest';

describe('ssr (no window)', () => {
  test('importing the entry has no side effects and throws nothing', async () => {
    expect(typeof window).toBe('undefined');
    const mod = await import('../../src/index');
    expect(typeof mod.curchestra).toBe('function');
  });

  test('every method is a no-op; runs are already done', async () => {
    const { curchestra } = await import('../../src/index');
    const orchestra = curchestra({ speed: 2 });
    const page = orchestra.page();
    await expect(page.done).resolves.toBeUndefined();
    page.finish();
    page.cancel();
    await expect(orchestra.section('#x').done).resolves.toBeUndefined();
    const off = orchestra.on('complete', () => {});
    expect(typeof off).toBe('function');
    off();
    orchestra.pause();
    orchestra.resume();
    orchestra.finish();
    orchestra.destroy();
  });

  test('transition awaits update() exactly once', async () => {
    const { curchestra } = await import('../../src/index');
    const update = vi.fn(async () => {});
    await curchestra().transition(update, { root: '#app' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('transition propagates an update() error', async () => {
    const { curchestra } = await import('../../src/index');
    await expect(
      curchestra().transition(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
