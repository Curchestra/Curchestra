/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { Crew } from '../engine/cursors';
import { clamp } from '../motion/ease';
import { type Personality, arcPoint, planArc } from '../motion/physics';
import type { Pt, Rect } from '../types';

/** Liquid orbit: idle cursors flow around a center and bounce off the pointer. */
export interface FlowAgent {
  /** viewport px, mutated */
  pos: Pt;
  /** px/s, mutated */
  vel: Pt;
  p: Personality;
}

export interface FlowState {
  last: Pt | null;
  /** smoothed pointer velocity, px/s */
  pv: Pt;
}

export function createFlow(): FlowState {
  return { last: null, pv: { x: 0, y: 0 } };
}

/** min distance to the pointer, px */
const BUBBLE = 46;
/** neighbour radius, px */
const NEAR = 90;
const ALIGN = 0.3;
const KICK = 260;
/** forces are tuned for this radius */
const REF_R = 120;

/** Step the flow; true if a cursor bumped the pointer. */
export function flowStep(
  st: FlowState,
  agents: FlowAgent[],
  center: Pt,
  pointer: Pt | null,
  radius: number,
  tight: boolean,
  time: number,
  dt: number,
): boolean {
  if (dt <= 0) return false;
  if (pointer && st.last) {
    const k = Math.min(1, dt * 18);
    st.pv.x += ((pointer.x - st.last.x) / dt - st.pv.x) * k;
    st.pv.y += ((pointer.y - st.last.y) / dt - st.pv.y) * k;
  } else {
    st.pv.x = 0;
    st.pv.y = 0;
  }
  st.last = pointer ? { x: pointer.x, y: pointer.y } : null;

  const n = agents.length;
  const scale = Math.max(0.25, radius / REF_R);
  const R = radius * (tight ? 0.5 : 1) * (1 + 0.18 * Math.sin(time * 0.55));
  const swirl = Math.tanh(Math.cos(time * 0.11) * 3) * (tight ? 0.6 : 1);
  const want = new Float64Array(n * 2);

  for (let i = 0; i < n; i++) {
    const a = agents[i];
    const rx = a.pos.x - center.x;
    const ry = a.pos.y - center.y;
    const d = Math.hypot(rx, ry) || 0.01;
    const nx = rx / d;
    const ny = ry / d;
    const lane = (a.p.lane - 0.5) * R * 0.6;
    const rr = R * (1 + 0.3 * Math.sin(3 * Math.atan2(ry, rx) + time * 0.7)) + lane;
    const tang = 300 * scale * (0.7 + 0.2 * a.p.spin) * swirl;
    const rad = clamp((rr - d) * 4, -2600, 1400);
    const far = clamp((d - rr) / 600, 0, 1);
    const curl = a.p.curl * 400 * far;
    want[i * 2] = -ny * tang + nx * rad - ny * curl;
    want[i * 2 + 1] = nx * tang + ny * rad + nx * curl;
  }

  for (let i = 0; i < n; i++) {
    const a = agents[i];
    let ax = 0;
    let ay = 0;
    let wsum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const q = agents[j];
      const dd = Math.hypot(q.pos.x - a.pos.x, q.pos.y - a.pos.y);
      if (dd > NEAR) continue;
      const w = 1 - dd / NEAR;
      ax += q.vel.x * w;
      ay += q.vel.y * w;
      wsum += w;
    }
    let fx = want[i * 2];
    let fy = want[i * 2 + 1];
    if (wsum > 0) {
      fx = fx * (1 - ALIGN) + (ax / wsum) * ALIGN;
      fy = fy * (1 - ALIGN) + (ay / wsum) * ALIGN;
    }
    const away = Math.max(0, Math.hypot(a.pos.x - center.x, a.pos.y - center.y) - R * 1.5);
    const maxV = a.p.speed * (1.3 + Math.min(3.2, away / 90));
    const fl = Math.hypot(fx, fy);
    if (fl > maxV) {
      fx *= maxV / fl;
      fy *= maxV / fl;
    }
    let gx = (fx - a.vel.x) * 6;
    let gy = (fy - a.vel.y) * 6;
    const maxF = a.p.push * (1.4 + Math.min(5, away / 50));
    const gl = Math.hypot(gx, gy);
    if (gl > maxF) {
      gx *= maxF / gl;
      gy *= maxF / gl;
    }
    a.vel.x += gx * dt;
    a.vel.y += gy * dt;
    a.pos.x += a.vel.x * dt;
    a.pos.y += a.vel.y * dt;
  }

  if (!pointer) return false;
  let touched = false;
  for (const a of agents) {
    const rx = a.pos.x - pointer.x;
    const ry = a.pos.y - pointer.y;
    const d = Math.hypot(rx, ry) || 0.01;
    if (d >= BUBBLE) continue;
    touched = true;
    const nx = rx / d;
    const ny = ry / d;
    a.pos.x = pointer.x + nx * BUBBLE;
    a.pos.y = pointer.y + ny * BUBBLE;
    // bounce off the pointer
    const rel = (a.vel.x - st.pv.x) * nx + (a.vel.y - st.pv.y) * ny;
    if (rel < 0) {
      a.vel.x -= nx * rel * 1.6;
      a.vel.y -= ny * rel * 1.6;
    }
    a.vel.x += nx * KICK;
    a.vel.y += ny * KICK;
  }
  return touched;
}

/** stroll speed relative to a trip */
const WANDER_SPEED = 0.35;

/** Stroll between spots in the visible part of `box`, pausing at each. */
export function wanderStep(
  k: Crew, box: Rect, vp: { w: number; h: number }, sc: Pt, dt: number, tempo: number, rng: () => number,
): void {
  const view = visible(box, vp);
  const c = k.c;
  let w = k.wander;
  // moved by something else: restart from here
  if (w && (w.last.x !== c.x || w.last.y !== c.y)) w = null;
  if (!w) w = k.wander = { at: { x: c.x + sc.x, y: c.y + sc.y }, to: null, arc: null, pause: 0, last: { x: c.x, y: c.y } };
  if (w.to && w.arc) {
    w.arc.t += dt * tempo;
    if (w.arc.t >= w.arc.dur) {
      w.at = w.to;
      w.to = null;
      w.arc = null;
      w.pause = 0.4 + rng();
    } else w.at = arcPoint(w.arc, w.to);
  } else {
    w.pause -= dt;
    const vy = w.at.y - sc.y;
    if (w.pause <= 0 || vy < view.y || vy > view.y + view.h) {
      w.to = { x: sc.x + view.x + view.w * (0.17 + rng() * 0.66), y: sc.y + view.y + view.h * (0.2 + rng() * 0.6) };
      w.arc = planArc(w.at, w.to, rng, WANDER_SPEED, k.p.quick);
    }
  }
  c.x = w.at.x - sc.x;
  c.y = w.at.y - sc.y;
  w.last = { x: c.x, y: c.y };
}

/** Part of `r` in the viewport, or the whole viewport. */
function visible(r: Rect, vp: { w: number; h: number }): Rect {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const w = Math.min(vp.w, r.x + r.w) - x0;
  const h = Math.min(vp.h, r.y + r.h) - y0;
  return w > 0 && h > 0 ? { x: x0, y: y0, w, h } : { x: 0, y: 0, w: vp.w, h: vp.h };
}
