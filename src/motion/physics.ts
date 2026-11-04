/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { Pt } from '../types';
import { clamp, easeOutCubic } from './ease';

/** How one cursor moves; about a quarter are quick. Seeded. */
export interface Personality {
  quick: boolean;
  /** flow speed, px/s */
  speed: number;
  /** steering force, px/s² */
  push: number;
  /** swirl strength */
  spin: number;
  /** -1..1 curl direction */
  curl: number;
  /** 0..1 lane in the flow */
  lane: number;
}

export function personality(rng: () => number): Personality {
  const quick = rng() < 0.25;
  const r = (a: number, b: number) => a + rng() * (b - a);
  return {
    quick,
    speed: quick ? r(950, 1450) : r(320, 760),
    push: quick ? r(3200, 5600) : r(800, 1900),
    spin: quick ? r(2.1, 3.3) : r(0.9, 1.9),
    curl: r(-1, 1),
    lane: rng(),
  };
}

/** A curved trip toward a moving target. */
export interface Arc {
  from: Pt;
  /** sideways bend at mid-trip, px */
  bend: number;
  /** seconds */
  dur: number;
  /** elapsed, s */
  t: number;
}

const ARC_MIN_S = 0.15;
const ARC_MAX_S = 0.9;
const BEND_CAP_PX = 600;

export function planArc(from: Pt, to: Pt, rng: () => number, speed: number, quick: boolean): Arc {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const side = rng() < 0.5 ? -1 : 1;
  const bend = side * (0.04 + rng() * 0.1) * Math.min(dist, BEND_CAP_PX);
  const dur = (clamp(0.13 + Math.sqrt(dist) * 0.02, ARC_MIN_S, ARC_MAX_S) / Math.max(0.05, speed)) * (quick ? 0.8 : 1);
  return { from: { x: from.x, y: from.y }, bend, dur, t: 0 };
}

/** share of a trip spent accelerating from rest */
const RAMP = 0.15;

/** Position on the arc: short run-up, fast cruise, soft landing on `to`. */
export function arcPoint(a: Arc, to: Pt): Pt {
  const u = clamp(a.t / a.dur, 0, 1);
  const w = (u < RAMP ? (u * u) / (2 * RAMP) : u - RAMP / 2) / (1 - RAMP / 2);
  const e = easeOutCubic(w);
  const dx = to.x - a.from.x;
  const dy = to.y - a.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.sin(Math.PI * e) * a.bend;
  return { x: a.from.x + dx * e - (dy / len) * off, y: a.from.y + dy * e + (dx / len) * off };
}

/** Arrow tip angle when upright. */
const TIP_DEG = -135;
const MAX_LEAN = 16;

/** 'align' points along motion, 'lean' tilts into it, 'rest' settles upright. */
export function steerAngle(angle: number, vx: number, vy: number, dt: number, mode: 'align' | 'lean' | 'rest'): number {
  if (mode === 'rest') {
    const a = angle * (1 - Math.min(1, dt * 10));
    return Math.abs(a) < 0.5 ? 0 : a;
  }
  let target: number;
  if (mode === 'lean') target = clamp(vx / 45, -MAX_LEAN, MAX_LEAN);
  else {
    if (Math.hypot(vx, vy) < 30) return angle;
    target = (Math.atan2(vy, vx) * 180) / Math.PI - TIP_DEG;
  }
  const diff = ((((target - angle) % 360) + 540) % 360) - 180;
  const next = angle + diff * Math.min(1, dt * 8);
  return next > 360 || next < -360 ? next % 360 : next;
}
