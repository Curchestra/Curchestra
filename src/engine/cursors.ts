import type { Action, ActionCtx } from '../actions/index';
import { spring } from '../motion/ease';
import type { Config, Cursor, Pt, Rect } from '../types';
import type { Area } from './area';

/** R19: orchestra-themed default crew. */
export const DEFAULT_NAMES = ['Alto', 'Bass', 'Cello', 'Drum', 'Flute', 'Harp', 'Oboe', 'Piano', 'Sax', 'Tuba', 'Viola', 'Horn'];
export const DEFAULT_COLORS = [
  '#E5484D', '#F76B15', '#FFB224', '#30A46C', '#12A594', '#0090FF',
  '#3E63DD', '#8E4EC6', '#D6409F', '#E54666', '#46A758', '#00A2C7',
];

/** How far outside the viewport cursors spawn and exit. */
const SPAWN_OUT = 32;
const EXIT_OUT = 48;
const GONE = 30;
const SUBSTEP = 1 / 120;

/** Engine-side state for one cursor. */
export interface Crew {
  c: Cursor;
  /** area of the current task, or the last one worked in */
  area: Area | null;
  action: Action | null;
  ctx: ActionCtx;
  /** seconds into the work phase */
  t: number;
  /** action.start relative to the task rect at creation, so travel follows the live element */
  off: Pt;
  /** next keystroke index (plugins) */
  key: number;
  /** where the cursor became free */
  home: Pt;
  exit: Pt | null;
}

export function makeCrew(
  id: number,
  n: number,
  agents: Config['agents'],
  seedPhase: number,
  at: Pt,
  rng: () => number,
  effects: Config['effects'],
): Crew {
  const names = agents.names?.length ? agents.names : DEFAULT_NAMES;
  const colors = agents.colors?.length ? agents.colors : DEFAULT_COLORS;
  const color = colors[n % colors.length];
  const c: Cursor = {
    id,
    name: names[n % names.length],
    color,
    x: at.x,
    y: at.y,
    sx: { x: at.x, v: 0 },
    sy: { x: at.y, v: 0 },
    shape: 'arrow',
    press: 0,
    task: null,
    phase: 'enter',
    idleFor: 0,
    seedPhase,
    alpha: 1,
  };
  const ctx: ActionCtx = {
    rect: { x: 0, y: 0, w: 0, h: 0 },
    lines: [],
    viewport: { w: 0, h: 0 },
    rng,
    speed: 1,
    effects,
    color,
  };
  return { c, area: null, action: null, ctx, t: 0, off: { x: 0, y: 0 }, key: 0, home: { ...at }, exit: null };
}

/** A point `out` px beyond the viewport edge nearest to `p`. */
export function edgePoint(p: Pt, vp: { w: number; h: number }, out = SPAWN_OUT): Pt {
  const cx = Math.min(Math.max(p.x, 0), vp.w);
  const cy = Math.min(Math.max(p.y, 0), vp.h);
  const l = p.x;
  const r = vp.w - p.x;
  const t = p.y;
  const b = vp.h - p.y;
  const m = Math.min(l, r, t, b);
  if (m === l) return { x: -out, y: cy };
  if (m === r) return { x: vp.w + out, y: cy };
  if (m === t) return { x: cx, y: -out };
  return { x: cx, y: vp.h + out };
}

export const exitPoint = (p: Pt, vp: { w: number; h: number }): Pt => edgePoint(p, vp, EXIT_OUT);

export function offscreen(c: Cursor, vp: { w: number; h: number }): boolean {
  return c.x < -GONE || c.y < -GONE || c.x > vp.w + GONE || c.y > vp.h + GONE;
}

export function inside(c: Cursor, vp: { w: number; h: number }): boolean {
  return c.x >= 0 && c.y >= 0 && c.x <= vp.w && c.y <= vp.h;
}

/** Spring the cursor toward (tx, ty), substepped for stability at high speed. */
export function springTo(c: Cursor, tx: number, ty: number, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    spring(c.sx, tx, h);
    spring(c.sy, ty, h);
  }
  c.x = c.sx.x;
  c.y = c.sy.x;
}

/** Keep the springs on the cursor after an action moved it directly. */
export function syncSprings(c: Cursor, dt: number): void {
  c.sx.v = dt > 0 ? (c.x - c.sx.x) / dt : 0;
  c.sy.v = dt > 0 ? (c.y - c.sy.x) / dt : 0;
  c.sx.x = c.x;
  c.sy.x = c.y;
}

export function moving(c: Cursor): boolean {
  return Math.abs(c.sx.v) >= 0.5 || Math.abs(c.sy.v) >= 0.5;
}

export function distToRect(p: Pt, r: Rect): number {
  const dx = p.x < r.x ? r.x - p.x : p.x > r.x + r.w ? p.x - r.x - r.w : 0;
  const dy = p.y < r.y ? r.y - p.y : p.y > r.y + r.h ? p.y - r.y - r.h : 0;
  return Math.hypot(dx, dy);
}
