import { describe, expect, it } from 'vitest';
import { idleTarget } from '../../src/idle/idle';
import type { IdleCtx, Pt } from '../../src/types';

const base = (o: Partial<IdleCtx> = {}): IdleCtx => ({
  pointer: { x: 400, y: 300 },
  lastTouch: null,
  home: { x: 10, y: 10 },
  areaRect: { x: 0, y: 0, w: 800, h: 600 },
  viewport: { w: 800, h: 600 },
  time: 0,
  seedPhase: 0.3,
  ...o,
});
const pt = (v: unknown): Pt => v as Pt;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

describe('idleTarget', () => {
  it('orbit keeps distance within [0.7r, 1.3r] of the pointer', () => {
    for (let s = 0; s <= 1; s += 0.1) {
      for (let t = 0; t < 20; t += 1.7) {
        const c = base({ seedPhase: s, time: t });
        const d = dist(pt(idleTarget('orbit', 'wander', 100, c)), c.pointer!);
        expect(d).toBeGreaterThanOrEqual(70 - 1e-9);
        expect(d).toBeLessThanOrEqual(130 + 1e-9);
      }
    }
  });

  it('different seedPhase gives different points', () => {
    const a = pt(idleTarget('orbit', 'wander', 100, base({ seedPhase: 0.2 })));
    const b = pt(idleTarget('orbit', 'wander', 100, base({ seedPhase: 0.7 })));
    expect(dist(a, b)).toBeGreaterThan(1);
  });

  it('orbit moves over time', () => {
    const a = pt(idleTarget('orbit', 'wander', 100, base({ time: 0 })));
    const b = pt(idleTarget('orbit', 'wander', 100, base({ time: 1 })));
    expect(dist(a, b)).toBeGreaterThan(1);
  });

  it('flock uses a tighter, slower orbit', () => {
    const c = base({ seedPhase: 0.5, time: 3 });
    const d = dist(pt(idleTarget('flock', 'wander', 100, c)), c.pointer!);
    expect(d).toBeCloseTo(100 * 0.5 * (0.5 + 0.5), 6);
    const o0 = pt(idleTarget('orbit', 'wander', 100, base({ seedPhase: 0.2, time: 0 })));
    const o1 = pt(idleTarget('orbit', 'wander', 100, base({ seedPhase: 0.2, time: 1 })));
    const f0 = pt(idleTarget('flock', 'wander', 100, base({ seedPhase: 0.2, time: 0 })));
    const f1 = pt(idleTarget('flock', 'wander', 100, base({ seedPhase: 0.2, time: 1 })));
    const ang = (p: Pt) => Math.atan2(p.y - 300, p.x - 400);
    expect(Math.abs(ang(f1) - ang(f0))).toBeLessThan(Math.abs(ang(o1) - ang(o0)));
  });

  it('no pointer: stay / wander / last-touch', () => {
    const c = base({ pointer: null, lastTouch: { x: 200, y: 200 } });
    expect(idleTarget('orbit', 'stay', 100, c)).toBe('stay');
    const w = pt(idleTarget('orbit', 'wander', 100, c));
    expect(w.x).toBeGreaterThanOrEqual(20);
    expect(w.x).toBeLessThanOrEqual(780);
    const lt = pt(idleTarget('orbit', 'last-touch', 100, c));
    const d = dist(lt, c.lastTouch!);
    expect(d).toBeGreaterThanOrEqual(70 - 1e-9);
    expect(d).toBeLessThanOrEqual(130 + 1e-9);
  });

  it('last-touch with null lastTouch falls back to a point inside areaRect', () => {
    const p = pt(idleTarget('flock', 'last-touch', 100, base({ pointer: null, lastTouch: null, time: 5 })));
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(800);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(600);
  });

  it('wander stays inside the inset areaRect', () => {
    const area = { x: 100, y: 50, w: 300, h: 200 };
    for (let i = 0; i < 500; i++) {
      const p = pt(idleTarget('wander', 'stay', 100, base({ areaRect: area, time: i * 0.9, seedPhase: (i % 7) / 7 })));
      expect(p.x).toBeGreaterThanOrEqual(120 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(380 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(70 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(230 + 1e-9);
    }
  });

  it('wander uses the center for a dimension smaller than 40px', () => {
    const p = pt(idleTarget('wander', 'stay', 100, base({ areaRect: { x: 10, y: 10, w: 30, h: 500 }, time: 7 })));
    expect(p.x).toBe(25);
  });

  it('leave and hide return strings, with or without a pointer', () => {
    expect(idleTarget('leave', 'stay', 100, base())).toBe('leave');
    expect(idleTarget('hide', 'stay', 100, base({ pointer: null }))).toBe('hide');
    expect(idleTarget('leave', 'wander', 100, base({ pointer: null }))).toBe('leave');
  });
});
