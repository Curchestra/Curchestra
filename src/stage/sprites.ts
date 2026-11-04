import type { CursorShape, Pt } from '../types';

/** Cursor shapes live on a 24-unit grid; sprites render that grid at SPRITE_PX CSS px. */
export const GRID = 24;
export const SPRITE_PX = 28;
export const SPRITE_SCALE = SPRITE_PX / GRID;
const OUTLINE = 1.5;

function poly(pts: number[]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.closePath();
  return p;
}

/** Classic pointer with its tip at (ox, oy), scaled by s. */
function arrow(ox: number, oy: number, s: number): number[] {
  const base = [0, 0, 0, 17, 4.5, 12.8, 7.8, 19.5, 10.6, 18.2, 7.4, 11.6, 13.5, 11.6];
  const out: number[] = [];
  for (let i = 0; i < base.length; i += 2) out.push(ox + base[i] * s, oy + base[i + 1] * s);
  return out;
}

const hots: Record<CursorShape, Pt> = {
  arrow: { x: 3, y: 2 },
  cross: { x: 12, y: 12 },
  ibeam: { x: 12, y: 12 },
  pen: { x: 3, y: 21 },
  dup: { x: 2, y: 2 },
};

export function cursorPath(shape: CursorShape): { path: Path2D; hot: Pt } {
  const hot = hots[shape];
  switch (shape) {
    case 'arrow':
      return { path: poly(arrow(3, 2, 1)), hot };
    case 'cross':
      return {
        path: poly([10.8, 3, 13.2, 3, 13.2, 10.8, 21, 10.8, 21, 13.2, 13.2, 13.2, 13.2, 21, 10.8, 21, 10.8, 13.2, 3, 13.2, 3, 10.8, 10.8, 10.8]),
        hot,
      };
    case 'ibeam':
      return {
        path: poly([7, 3, 17, 3, 17, 5, 13, 5, 13, 19, 17, 19, 17, 21, 7, 21, 7, 19, 11, 19, 11, 5, 7, 5]),
        hot,
      };
    case 'pen':
      return { path: poly([3, 21, 5, 13.5, 15.5, 3, 21, 8.5, 10.5, 19]), hot };
    case 'dup': {
      const p = new Path2D();
      p.addPath(poly(arrow(7.5, 7.5, 0.75)));
      p.addPath(poly(arrow(2, 2, 0.75)));
      return { path: p, hot };
    }
  }
}

const cache = new Map<string, CanvasImageSource>();

export function getSprite(shape: CursorShape, color: string, dpr: number): CanvasImageSource {
  const key = `${shape}|${color}|${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = Math.ceil(SPRITE_PX * dpr);
  const cv: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(px, px)
      : Object.assign(document.createElement('canvas'), { width: px, height: px });
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const k = SPRITE_SCALE;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const { path } = cursorPath(shape);
  ctx.lineJoin = 'round';
  ctx.lineWidth = (OUTLINE * 2) / k; // outer half of a centered stroke is OUTLINE css px
  ctx.strokeStyle = '#fff';
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  cache.set(key, cv);
  return cv;
}
