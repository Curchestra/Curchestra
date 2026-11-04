import { describe, expect, it } from 'vitest';
import { createFlow, flowStep, type FlowAgent } from '../../src/idle/liquid';
import { personality } from '../../src/motion/physics';
import { createRng } from '../../src/motion/rng';

const center = { x: 500, y: 400 };

function crew(n: number, seed = 1): FlowAgent[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => ({
    pos: { x: 100 + (i % 6) * 140, y: 100 + Math.floor(i / 6) * 120 },
    vel: { x: 0, y: 0 },
    p: personality(rng),
  }));
}

function run(agents: FlowAgent[], secs: number, opts: { pointer?: boolean; radius?: number; tight?: boolean } = {}) {
  const st = createFlow();
  const dt = 1 / 60;
  const ptr = opts.pointer === false ? null : center;
  for (let i = 0; i < secs * 60; i++) flowStep(st, agents, center, ptr, opts.radius ?? 120, !!opts.tight, i * dt, dt);
  return st;
}

const d = (a: { x: number; y: number }) => Math.hypot(a.x - center.x, a.y - center.y);

describe('liquid orbit', () => {
  it('gathers the crew into a ring around the pointer, not onto it', () => {
    const agents = crew(24);
    run(agents, 6);
    const ds = agents.map((a) => d(a.pos));
    const mean = ds.reduce((s, v) => s + v, 0) / ds.length;
    expect(mean).toBeGreaterThan(120 * 0.55);
    expect(mean).toBeLessThan(120 * 1.7);
    for (const v of ds) expect(v).toBeLessThan(120 * 2.6);
  });

  it('is not a rigid circle: distances spread out (petals and lanes)', () => {
    const agents = crew(24);
    run(agents, 6);
    const ds = agents.map((a) => d(a.pos));
    const mean = ds.reduce((s, v) => s + v, 0) / ds.length;
    const sd = Math.sqrt(ds.reduce((s, v) => s + (v - mean) ** 2, 0) / ds.length);
    expect(sd).toBeGreaterThan(6);
  });

  it('keeps flowing around the center (tangential motion)', () => {
    const agents = crew(16);
    run(agents, 5);
    let tang = 0;
    for (const a of agents) {
      const rx = a.pos.x - center.x;
      const ry = a.pos.y - center.y;
      const r = Math.hypot(rx, ry) || 1;
      tang += Math.abs((-ry * a.vel.x + rx * a.vel.y) / r);
    }
    expect(tang / agents.length).toBeGreaterThan(40);
  });

  it('the ring breathes: its size changes over time', () => {
    const agents = crew(24);
    const st = createFlow();
    const dt = 1 / 60;
    const means: number[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      flowStep(st, agents, center, center, 120, false, i * dt, dt);
      if (i > 60 * 4 && i % 30 === 0) means.push(agents.reduce((s, a) => s + d(a.pos), 0) / agents.length);
    }
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(8);
  });

  it('nobody stays inside the pointer bubble', () => {
    const agents = crew(30);
    const st = createFlow();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      flowStep(st, agents, center, center, 120, false, i * dt, dt);
      if (i > 60) for (const a of agents) expect(d(a.pos)).toBeGreaterThanOrEqual(46 - 1e-6);
    }
  });

  it('a fast pointer flick scatters cursors outward', () => {
    const agents = crew(20);
    const st = createFlow();
    const dt = 1 / 60;
    let t = 0;
    for (let i = 0; i < 60 * 5; i++, t += dt) flowStep(st, agents, center, center, 120, false, t, dt);
    const before = agents.map((a) => ({ ...a.pos }));
    const p = { ...center };
    let moved = 0;
    for (let i = 0; i < 12; i++, t += dt) {
      p.x += 40;
      flowStep(st, agents, center, p, 120, false, t, dt);
    }
    for (let i = 0; i < agents.length; i++) moved += Math.hypot(agents[i].pos.x - before[i].x, agents[i].pos.y - before[i].y);
    expect(moved / agents.length).toBeGreaterThan(10);
  });

  it('speed stays within each cursor’s limit', () => {
    const agents = crew(24);
    const st = createFlow();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 4; i++) {
      flowStep(st, agents, center, null, 120, false, i * dt, dt);
      for (const a of agents) expect(Math.hypot(a.vel.x, a.vel.y)).toBeLessThanOrEqual(a.p.speed * 4.5 + 1e-6);
    }
  });

  it('tight (flock) packs closer than orbit', () => {
    const o = crew(20);
    const f = crew(20);
    run(o, 6);
    run(f, 6, { tight: true });
    const mean = (xs: FlowAgent[]) => xs.reduce((s, a) => s + d(a.pos), 0) / xs.length;
    expect(mean(f)).toBeLessThan(mean(o));
  });

  it('is deterministic', () => {
    const a = crew(12, 9);
    const b = crew(12, 9);
    run(a, 3);
    run(b, 3);
    expect(a.map((x) => x.pos)).toEqual(b.map((x) => x.pos));
  });

  it('nearby cursors flow together (velocity alignment)', () => {
    const rng = createRng(5);
    const pair: FlowAgent[] = [
      { pos: { x: 700, y: 400 }, vel: { x: 0, y: 400 }, p: personality(rng) },
      { pos: { x: 740, y: 400 }, vel: { x: 0, y: -400 }, p: personality(rng) },
    ];
    const solo: FlowAgent[] = [{ pos: { x: 740, y: 400 }, vel: { x: 0, y: -400 }, p: pair[1].p }];
    const st1 = createFlow();
    const st2 = createFlow();
    flowStep(st1, pair, center, null, 120, false, 0, 1 / 60);
    flowStep(st2, solo, center, null, 120, false, 0, 1 / 60);
    // the neighbour moving the other way pulls the second cursor's velocity toward its own
    expect(pair[1].vel.y).toBeGreaterThan(solo[0].vel.y);
  });
});
