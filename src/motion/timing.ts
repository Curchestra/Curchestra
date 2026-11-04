/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import { clamp } from './ease';

/** Seconds to travel `distPx` at the given speed multiplier. */
export function travelTime(distPx: number, speed: number): number {
  return clamp(0.18 + distPx / 1400, 0.18, 0.9) / speed;
}

/** Per-character typing delays in ms. Jitter applies to the base only; extras are added after. */
export function typingDelays(text: string, rng: () => number, speed: number): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let d = 38 * (0.6 + rng() * 0.8);
    if (ch === ' ') d += 25;
    else if (',.;:!?'.includes(ch)) d += 90;
    out.push(d / speed);
  }
  return out;
}
