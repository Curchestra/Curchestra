import type { Config, IdleCtx, Pt } from '../types';

const TAU = Math.PI * 2;
const INSET = 20;

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

function around(center: Pt, flock: boolean, radius: number, ctx: IdleCtx): Pt {
  const s = ctx.seedPhase;
  const r = flock ? radius * 0.5 * (0.5 + s) : radius * (0.7 + 0.6 * s);
  const speed = (0.6 + 0.8 * s) * (s < 0.5 ? 1 : -1) * (flock ? 0.3 : 1);
  const th = TAU * s + ctx.time * speed;
  return { x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) };
}

export function idleTarget(
  behavior: Config['idle']['behavior'],
  noPointer: Config['idle']['noPointer'],
  radius: number,
  ctx: IdleCtx,
): Pt | 'leave' | 'hide' | 'stay' {
  if (behavior === 'leave') return 'leave';
  if (behavior === 'hide') return 'hide';
  if (behavior === 'wander') return wander(ctx);
  const flock = behavior === 'flock';
  if (ctx.pointer) return around(ctx.pointer, flock, radius, ctx);
  if (noPointer === 'stay') return 'stay';
  if (noPointer === 'last-touch' && ctx.lastTouch) return around(ctx.lastTouch, flock, radius, ctx);
  return wander(ctx);
}
