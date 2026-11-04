import { describe, expect, it } from 'vitest';
import { idlePlan } from '../../src/idle/idle';
import type { IdleCtx } from '../../src/types';

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

describe('idlePlan', () => {
  it('orbit flows around the pointer (liquid, not tight)', () => {
    expect(idlePlan('orbit', 'wander', base())).toEqual({ kind: 'flow', center: { x: 400, y: 300 }, tight: false });
  });

  it('flock flows around the pointer as a tight cluster', () => {
    expect(idlePlan('flock', 'wander', base())).toEqual({ kind: 'flow', center: { x: 400, y: 300 }, tight: true });
  });

  it('no pointer: last-touch flows around the last tap', () => {
    const c = base({ pointer: null, lastTouch: { x: 200, y: 210 } });
    expect(idlePlan('orbit', 'last-touch', c)).toEqual({ kind: 'flow', center: { x: 200, y: 210 }, tight: false });
    expect(idlePlan('flock', 'last-touch', c)).toEqual({ kind: 'flow', center: { x: 200, y: 210 }, tight: true });
  });

  it('no pointer: stay holds still', () => {
    expect(idlePlan('orbit', 'stay', base({ pointer: null, lastTouch: { x: 1, y: 1 } }))).toEqual({ kind: 'stay' });
  });

  it('no pointer, last-touch with no tap yet: flows around a point drifting across the viewport', () => {
    const at = (time: number) => {
      const p = idlePlan('orbit', 'last-touch', base({ pointer: null, lastTouch: null, time }));
      expect(p.kind).toBe('flow');
      return p.kind === 'flow' ? p.center : { x: 0, y: 0 };
    };
    const a = at(0);
    const b = at(4);
    expect(a).not.toEqual(b);
    for (const c of [a, b, at(9), at(20)]) {
      expect(c.x).toBeGreaterThanOrEqual(800 * 0.22);
      expect(c.x).toBeLessThanOrEqual(800 * 0.78);
      expect(c.y).toBeGreaterThanOrEqual(600 * 0.25);
      expect(c.y).toBeLessThanOrEqual(600 * 0.75);
    }
  });

  it('no pointer: wander drifts inside the area', () => {
    for (const np of ['wander'] as const) {
      const p = idlePlan('orbit', np, base({ pointer: null, lastTouch: null, time: 5 }));
      expect(p.kind).toBe('point');
      if (p.kind !== 'point') continue;
      expect(p.at.x).toBeGreaterThanOrEqual(20);
      expect(p.at.x).toBeLessThanOrEqual(780);
      expect(p.at.y).toBeGreaterThanOrEqual(20);
      expect(p.at.y).toBeLessThanOrEqual(580);
    }
  });

  it('wander stays inside the inset areaRect and differs per cursor', () => {
    const area = { x: 100, y: 50, w: 300, h: 200 };
    for (let i = 0; i < 500; i++) {
      const p = idlePlan('wander', 'stay', base({ areaRect: area, time: i * 0.9, seedPhase: (i % 7) / 7 }));
      if (p.kind !== 'point') throw new Error('expected point');
      expect(p.at.x).toBeGreaterThanOrEqual(120 - 1e-9);
      expect(p.at.x).toBeLessThanOrEqual(380 + 1e-9);
      expect(p.at.y).toBeGreaterThanOrEqual(70 - 1e-9);
      expect(p.at.y).toBeLessThanOrEqual(230 + 1e-9);
    }
    const a = idlePlan('wander', 'stay', base({ seedPhase: 0.2 }));
    const b = idlePlan('wander', 'stay', base({ seedPhase: 0.7 }));
    expect(a).not.toEqual(b);
  });

  it('wander uses the center for a dimension smaller than 40px', () => {
    const p = idlePlan('wander', 'stay', base({ areaRect: { x: 10, y: 10, w: 30, h: 500 }, time: 7 }));
    expect(p.kind === 'point' && p.at.x).toBe(25);
  });

  it('leave and hide, with or without a pointer', () => {
    expect(idlePlan('leave', 'stay', base())).toEqual({ kind: 'leave' });
    expect(idlePlan('hide', 'stay', base({ pointer: null }))).toEqual({ kind: 'hide' });
    expect(idlePlan('leave', 'wander', base({ pointer: null }))).toEqual({ kind: 'leave' });
  });
});
