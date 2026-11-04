import { clamp } from '../motion/ease';

export function crewTarget(o: { min: number; max: number; backlogInRange: number; scrollSpeed: number }): number {
  return clamp(o.min + Math.ceil(o.backlogInRange / 4) + Math.floor((o.scrollSpeed / 600) * 4), o.min, o.max);
}
