import { describe, expect, test, vi } from 'vitest';
import { resolveConfig } from '../../src/config/resolve';
import { validate } from '../../src/config/validate';

describe('config', () => {
  test('defaults match spec', () => {
    const c = resolveConfig();
    expect(c.preset).toBe('default');
    expect(c.agents).toEqual({ min: 6, max: 30, showNames: true });
    expect(c.speed).toBe(1);
    expect(c.idle).toEqual({ behavior: 'orbit', after: 1.5, radius: 60, noPointer: 'last-touch' });
    expect(c.effects).toEqual({ guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true });
    expect(c.sound).toBe(false);
    expect([c.theme, c.reducedMotion, c.skipOnClick, c.persist]).toEqual(['auto', 'respect', true, true]);
    expect([c.maxTasks, c.failsafe, c.zIndex]).toEqual([1500, 15000, 2147483000]);
    expect(c.skip).toEqual([]);
  });
  test('presets', () => {
    expect(resolveConfig({ preset: 'calm' })).toMatchObject({ agents: { min: 4, max: 12 }, speed: 0.8, effects: { duplicate: false, pen: false } });
    expect(resolveConfig({ preset: 'frenzy' })).toMatchObject({ agents: { min: 12, max: 48 }, speed: 1.6 });
  });
  test('later layers win, preset under explicit values', () => {
    expect(resolveConfig({ preset: 'calm' }, { speed: 2 }).speed).toBe(2);
    expect(resolveConfig({ idle: { radius: 90 } }).idle).toMatchObject({ radius: 90, behavior: 'orbit' });
    expect(resolveConfig({ skip: ['a'] }, { skip: ['b'] }).skip).toEqual(['b']);
  });
  test('validate warns and drops', () => {
    const warn = vi.fn();
    const out = validate({ speed: -1, idle: { behavior: 'spin' }, bogus: 1 }, warn);
    expect(out).toEqual({ idle: {} });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[1][0]).toBe('[curchestra] idle.behavior: must be one of orbit|flock|wander|leave|hide; using orbit');
  });
  test('agents.min > max is clamped', () => {
    expect(resolveConfig({ agents: { min: 40, max: 10 } }).agents).toMatchObject({ min: 10, max: 10 });
  });
});
