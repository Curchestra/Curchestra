import { describe, expect, test, vi } from 'vitest';

describe('ssr (no window)', () => {
  test('importing the entry has no side effects and throws nothing', async () => {
    expect(typeof window).toBe('undefined');
    const mod = await import('../../src/index');
    expect(typeof mod.curchestra).toBe('function');
  });

  test('every method is a no-op; runs are already done', async () => {
    const { curchestra } = await import('../../src/index');
    const swarm = curchestra({ speed: 2 });
    const page = swarm.page();
    await expect(page.done).resolves.toBeUndefined();
    page.finish();
    page.cancel();
    await expect(swarm.section('#x').done).resolves.toBeUndefined();
    const off = swarm.on('complete', () => {});
    expect(typeof off).toBe('function');
    off();
    swarm.pause();
    swarm.resume();
    swarm.finish();
    swarm.destroy();
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
