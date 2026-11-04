import type { Config, IdleCtx, Pt } from '../types';

const TAU = Math.PI * 2;
const INSET = 20;

/** What an idle cursor does next. */
export type IdlePlan =
  | { kind: 'flow'; center: Pt; tight: boolean }
  | { kind: 'point'; at: Pt }
  | { kind: 'stay' }
  | { kind: 'leave' }
  | { kind: 'hide' };

function wander(ctx: IdleCtx): Pt {
  const { areaRect: a, time, seedPhase: s } = ctx;
  const axis = (pos: number, size: number, freq: number, phase: number): number => {
    if (size < INSET * 2) return pos + size / 2;
    return pos + INSET + (size - INSET * 2) * (0.5 + 0.5 * Math.sin(time * freq + phase));
  };
  return {
    x: axis(a.x, a.w, 0.31 + 0.2 * s, TAU * s),
    y: axis(a.y, a.h, 0.23 + 0.17 * s, Math.PI * s),
  };
}

/** A slowly drifting center, used when there is no pointer. */
export function driftCenter(vp: { w: number; h: number }, time: number): Pt {
  return { x: vp.w * (0.5 + 0.28 * Math.sin(time * 0.37)), y: vp.h * (0.5 + 0.25 * Math.sin(time * 0.53 + 1)) };
}

export function idlePlan(
  behavior: Config['idle']['behavior'],
  noPointer: Config['idle']['noPointer'],
  ctx: IdleCtx,
): IdlePlan {
  if (behavior === 'leave') return { kind: 'leave' };
  if (behavior === 'hide') return { kind: 'hide' };
  if (behavior === 'wander') return { kind: 'point', at: wander(ctx) };
  const tight = behavior === 'flock';
  if (ctx.pointer) return { kind: 'flow', center: ctx.pointer, tight };
  if (noPointer === 'stay') return { kind: 'stay' };
  if (noPointer === 'last-touch') return { kind: 'flow', center: ctx.lastTouch ?? driftCenter(ctx.viewport, ctx.time), tight };
  return { kind: 'point', at: wander(ctx) };
}
