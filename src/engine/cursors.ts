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
/** seconds to fade in at a section edge */
const FADE_IN_S = 0.3;
/** px before a section exit point over which a leaving cursor fades out */
const FADE_OUT_PX = 48;

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
  /** leaving through a section edge, which may be on screen: fade out on the way (R33) */
  fadeOut: boolean;
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
  return { c, area: null, action: null, ctx, t: 0, off: { x: 0, y: 0 }, key: 0, home: { ...at }, exit: null, fadeOut: false };
}

/** A point `out` px beyond the edge of `r` nearest to `p`. */
export function edgePoint(p: Pt, r: Rect, out = SPAWN_OUT): Pt {
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const cx = Math.min(Math.max(p.x, r.x), x1);
  const cy = Math.min(Math.max(p.y, r.y), y1);
  const l = p.x - r.x;
  const rt = x1 - p.x;
  const t = p.y - r.y;
  const b = y1 - p.y;
  const m = Math.min(l, rt, t, b);
  if (m === l) return { x: r.x - out, y: cy };
  if (m === rt) return { x: x1 + out, y: cy };
  if (m === t) return { x: cx, y: r.y - out };
  return { x: cx, y: y1 + out };
}

/** R33: section areas confine entry and exit to their live rect; page and transition use the viewport. */
export function confineRect(area: Area | null, vp: { w: number; h: number }): Rect {
  return area?.mode === 'section' ? area.rect : { x: 0, y: 0, w: vp.w, h: vp.h };
}

/** Place a new cursor just outside the edge nearest its first task; at a section edge it fades in. */
export function spawnAt(k: Crew, vp: { w: number; h: number }): void {
  const at = edgePoint({ x: k.ctx.rect.x + k.off.x, y: k.ctx.rect.y + k.off.y }, confineRect(k.area, vp));
  k.c.x = k.c.sx.x = at.x;
  k.c.y = k.c.sy.x = at.y;
  k.home = at;
  if (k.area?.mode === 'section') k.c.alpha = 0;
}

export function fadeIn(c: Cursor, dt: number): void {
  if (c.alpha < 1) c.alpha = Math.min(1, c.alpha + dt / FADE_IN_S);
}

/** Start leaving through the nearest edge of the cursor's confinement rect. */
export function sendOut(k: Crew, vp: { w: number; h: number }): void {
  k.c.phase = 'leave';
  k.exit = edgePoint(k.c, confineRect(k.area, vp), EXIT_OUT);
  k.fadeOut = k.area?.mode === 'section';
}

/** Move a leaving cursor toward its exit; returns true once it is gone. */
export function leaveStep(k: Crew, dt: number, vp: { w: number; h: number }): boolean {
  const c = k.c;
  const e = k.exit!;
  springTo(c, e.x, e.y, dt);
  if (k.fadeOut) c.alpha = Math.min(c.alpha, Math.hypot(e.x - c.x, e.y - c.y) / FADE_OUT_PX);
  return offscreen(c, vp) || (k.fadeOut && c.alpha < 0.02);
}

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
