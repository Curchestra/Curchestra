import { describe, expect, it } from 'vitest';
import { arcPoint, personality, planArc, steerAngle } from '../../src/motion/physics';
import { createRng } from '../../src/motion/rng';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('personality', () => {
  it('is deterministic per seed', () => {
    const a = personality(createRng(7));
    const b = personality(createRng(7));
    expect(a).toEqual(b);
  });

  it('about a quarter of the crew is quick, and quick cursors are faster', () => {
    const rng = createRng(3);
    const all = Array.from({ length: 2000 }, () => personality(rng));
    const quick = all.filter((p) => p.quick);
    expect(quick.length / all.length).toBeGreaterThan(0.2);
    expect(quick.length / all.length).toBeLessThan(0.3);
    const calm = all.filter((p) => !p.quick);
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(avg(quick.map((p) => p.speed))).toBeGreaterThan(avg(calm.map((p) => p.speed)) * 1.5);
    for (const p of all) {
      expect(p.curl).toBeGreaterThanOrEqual(-1);
      expect(p.curl).toBeLessThanOrEqual(1);
      expect(p.lane).toBeGreaterThanOrEqual(0);
      expect(p.lane).toBeLessThan(1);
    }
  });
});

describe('arc travel', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 0 };

  it('starts at the origin and lands exactly on the target', () => {
    const arc = planArc(from, to, createRng(1), 1, false);
    expect(dist(arcPoint(arc, to), from)).toBeLessThan(1e-9);
    arc.t = arc.dur;
    expect(dist(arcPoint(arc, to), to)).toBeLessThan(1e-9);
  });

  it('bends sideways mid-flight by 4–14% of the distance', () => {
    for (let s = 1; s <= 20; s++) {
      const arc = planArc(from, to, createRng(s), 1, false);
      arc.t = arc.dur * 0.35;
      const y = Math.abs(arcPoint(arc, to).y);
      expect(y).toBeGreaterThan(0.04 * 400 * 0.5);
      expect(y).toBeLessThanOrEqual(0.14 * 400 + 1e-9);
    }
  });

  it('bends to both sides across seeds', () => {
    const sides = new Set<number>();
    for (let s = 1; s <= 30; s++) {
      const arc = planArc(from, to, createRng(s), 1, false);
      arc.t = arc.dur / 2;
      sides.add(Math.sign(arcPoint(arc, to).y));
    }
    expect(sides).toEqual(new Set([1, -1]));
  });

  it('caps the bend for very long trips', () => {
    const far = { x: 5000, y: 0 };
    for (let s = 1; s <= 20; s++) {
      const arc = planArc(from, far, createRng(s), 1, false);
      arc.t = arc.dur / 2;
      expect(Math.abs(arcPoint(arc, far).y)).toBeLessThanOrEqual(0.14 * 600 + 1e-9);
    }
  });

  it('duration grows with the square root of distance, within 0.15–0.9 s, and scales with speed', () => {
    const d = (len: number, speed = 1, quick = false) => planArc(from, { x: len, y: 0 }, createRng(1), speed, quick).dur;
    expect(d(1)).toBeCloseTo(0.15, 6);
    expect(d(1e6)).toBeCloseTo(0.9, 6);
    expect(d(400)).toBeGreaterThan(d(100));
    expect(d(400) - d(100)).toBeLessThan(d(100) - d(0.01) + 0.2);
    expect(d(400, 2)).toBeCloseTo(d(400) / 2, 6);
    expect(d(400, 1, true)).toBeLessThan(d(400));
  });

  it('starts fast and lands softly', () => {
    const arc = planArc(from, to, createRng(2), 1, false);
    const x = (k: number) => {
      arc.t = arc.dur * k;
      return arcPoint(arc, to).x;
    };
    expect(x(0.2)).toBeGreaterThan(400 * 0.35);
    expect(x(1) - x(0.9)).toBeLessThan(x(0.1) - x(0));
  });

  it('follows a moving target and still lands on it', () => {
    const arc = planArc(from, to, createRng(4), 1, false);
    arc.t = arc.dur;
    const moved = { x: 420, y: 60 };
    expect(dist(arcPoint(arc, moved), moved)).toBeLessThan(1e-9);
  });
});

describe('steerAngle', () => {
  it('align: turns the arrow tip toward the direction of motion', () => {
    let a = 0;
    for (let i = 0; i < 120; i++) a = steerAngle(a, 300, 0, 1 / 60, 'align');
    // arrow tip rests at -135°, so moving right (0°) needs +135°
    expect(a).toBeCloseTo(135, 0);
    let b = 0;
    for (let i = 0; i < 120; i++) b = steerAngle(b, 0, -300, 1 / 60, 'align');
    expect(b).toBeCloseTo(45, 0);
  });

  it('align: keeps the angle when nearly still', () => {
    expect(steerAngle(40, 5, 5, 1 / 60, 'align')).toBe(40);
  });

  it('lean: tilts a little with horizontal speed, never more than 16°', () => {
    let a = 0;
    for (let i = 0; i < 120; i++) a = steerAngle(a, 5000, 0, 1 / 60, 'lean');
    expect(a).toBeCloseTo(16, 0);
    let b = 0;
    for (let i = 0; i < 120; i++) b = steerAngle(b, -200, 0, 1 / 60, 'lean');
    expect(b).toBeLessThan(0);
    expect(b).toBeGreaterThan(-16);
  });

  it('rest: settles back upright', () => {
    let a = 90;
    for (let i = 0; i < 60; i++) a = steerAngle(a, 0, 0, 1 / 60, 'rest');
    expect(a).toBe(0);
  });

  it('wraps the shortest way round', () => {
    const a = steerAngle(170, -300, 300, 1 / 60, 'align');
    // target is 270° ≡ -90°... shortest from 170° is forward through 180°
    expect(a).toBeGreaterThan(170);
  });
});

describe('arcPoint start', () => {
  it('a trip starts from rest: the first 60 Hz frame covers only a sliver, then it speeds up', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 900, y: 0 };
    const arc = { from, bend: 0, dur: 0.36, t: 1 / 60 };
    const first = arcPoint(arc, to).x;
    expect(first).toBeLessThan(900 * 0.03);
    arc.t = 0.36 / 2;
    expect(arcPoint(arc, to).x).toBeGreaterThan(900 * 0.6);
  });

  it('is continuous across the end of the run-up', () => {
    const to = { x: 1000, y: 0 };
    const at = (t: number) => arcPoint({ from: { x: 0, y: 0 }, bend: 0, dur: 1, t }, to).x;
    expect(Math.abs(at(0.1501) - at(0.1499))).toBeLessThan(1);
  });
});

