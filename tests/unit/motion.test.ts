import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/motion/rng';
import { easeInOutCubic, easeOutCubic, spring, clamp } from '../../src/motion/ease';
import { travelTime, typingDelays } from '../../src/motion/timing';

describe('createRng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const sa = Array.from({ length: 100 }, a);
    const sb = Array.from({ length: 100 }, b);
    const sc = Array.from({ length: 100 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('easing', () => {
  it('easeInOutCubic hits its anchors', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(1)).toBe(1);
  });
  it('easeOutCubic hits its anchors', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('spring', () => {
  it('settles on the target', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 60; i++) spring(s, 100, 1 / 60);
    expect(Math.abs(s.x - 100)).toBeLessThan(1);
    expect(Math.abs(s.v)).toBeLessThan(5);
  });
});

describe('travelTime', () => {
  it('clamps and scales by speed', () => {
    expect(travelTime(0, 1)).toBeCloseTo(0.18, 10);
    expect(travelTime(1e6, 1)).toBeCloseTo(0.9, 10);
    expect(travelTime(700, 2)).toBeCloseTo(0.34, 10);
  });
});

describe('typingDelays', () => {
  it('adds extras for spaces and punctuation after jitter', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = typingDelays('a b.', createRng(seed), 1);
      expect(d).toHaveLength(4);
      expect(d[0]).toBeGreaterThanOrEqual(0.6 * 38);
      expect(d[0]).toBeLessThanOrEqual(1.4 * 38);
      expect(d[1]).toBeGreaterThanOrEqual(0.6 * 38 + 25);
      expect(d[1]).toBeLessThanOrEqual(1.4 * 38 + 25);
      expect(d[3]).toBeGreaterThanOrEqual(0.6 * 38 + 90);
      expect(d[3]).toBeLessThanOrEqual(1.4 * 38 + 90);
    }
  });
  it('divides by speed', () => {
    const a = typingDelays('abc', createRng(7), 1);
    const b = typingDelays('abc', createRng(7), 2);
    b.forEach((v, i) => expect(v).toBeCloseTo(a[i] / 2, 10));
  });
});
