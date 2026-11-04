/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import { clamp } from '../motion/ease';

/** Crew size: +1 per 50 px/s of scroll and per 3 pieces on screen. */
export function crewTarget(o: { min: number; max: number; backlogInRange: number; scrollSpeed: number }): number {
  return clamp(o.min + Math.floor(o.scrollSpeed / 50) + Math.floor(o.backlogInRange / 3), o.min, o.max);
}

/** Action timings are divided by this: 2.1 at rest, up to 3.2 with scroll speed and backlog. */
export function tempoFor(scrollSpeed: number, backlog: number, crew: number): number {
  return clamp(2.1 + scrollSpeed / 1800 + (backlog / Math.max(1, crew)) * 0.3, 2.1, 3.2);
}
