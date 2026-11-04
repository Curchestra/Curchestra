export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Semi-implicit Euler spring step; mutates `s`. */
export function spring(s: { x: number; v: number }, target: number, dt: number, k = 170, c = 26): void {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}
