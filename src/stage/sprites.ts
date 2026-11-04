/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { CursorShape, Pt } from '../types';

/** Shapes use a 24-unit grid drawn at SPRITE_PX. */
export const GRID = 24;
export const SPRITE_PX = 22;
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

/** Horizontal double arrow (resize); `rot` turns it 90° for the vertical one. */
function double(rot: boolean): number[] {
  const h = [2.5, 12, 7, 7.5, 7, 10.4, 17, 10.4, 17, 7.5, 21.5, 12, 17, 16.5, 17, 13.6, 7, 13.6, 7, 16.5];
  if (!rot) return h;
  const out: number[] = [];
  for (let i = 0; i < h.length; i += 2) out.push(24 - h[i + 1], h[i]);
  return out;
}

const PEN = [3, 21, 5, 13.5, 15.5, 3, 21, 8.5, 10.5, 19];

const hots: Record<CursorShape, Pt> = {
  arrow: { x: 3, y: 2 },
  cross: { x: 12, y: 12 },
  ibeam: { x: 12, y: 12 },
  pen: { x: 3, y: 21 },
  'pen-add': { x: 3, y: 21 },
  dup: { x: 2, y: 2 },
  ew: { x: 12, y: 12 },
  ns: { x: 12, y: 12 },
};

export function hotOf(shape: CursorShape): Pt {
  return hots[shape];
}

const paths = new Map<CursorShape, Path2D>();

export function cursorPath(shape: CursorShape): { path: Path2D; hot: Pt } {
  let path = paths.get(shape);
  if (!path) {
    path = buildPath(shape);
    paths.set(shape, path);
  }
  return { path, hot: hots[shape] };
}

function buildPath(shape: CursorShape): Path2D {
  switch (shape) {
    case 'arrow':
      return poly(arrow(3, 2, 1));
    case 'cross':
      return poly([10.8, 3, 13.2, 3, 13.2, 10.8, 21, 10.8, 21, 13.2, 13.2, 13.2, 13.2, 21, 10.8, 21, 10.8, 13.2, 3, 13.2, 3, 10.8, 10.8, 10.8]);
    case 'ibeam':
      return poly([7, 3, 17, 3, 17, 5, 13, 5, 13, 19, 17, 19, 17, 21, 7, 21, 7, 19, 11, 19, 11, 5, 7, 5]);
    case 'pen':
    case 'pen-add':
      return poly(PEN);
    case 'ew':
    case 'ns':
      return poly(double(shape === 'ns'));
    case 'dup': {
      const p = new Path2D();
      p.addPath(poly(arrow(7.5, 7.5, 0.75)));
      p.addPath(poly(arrow(2, 2, 0.75)));
      return p;
    }
  }
}

const cache = new Map<string, CanvasImageSource>();

export function getSprite(shape: CursorShape, color: string, dpr: number, doc?: Document): CanvasImageSource {
  const key = `${shape}|${color}|${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = Math.ceil(SPRITE_PX * dpr);
  let cv: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(px, px);
  else if (doc) {
    cv = doc.createElement('canvas');
    cv.width = px;
    cv.height = px;
  } else throw new Error('getSprite: OffscreenCanvas unavailable and no document given');
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const k = SPRITE_SCALE;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const { path } = cursorPath(shape);
  ctx.lineJoin = 'round';
  // outline and shadow, then the body
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 2 * dpr;
  ctx.shadowOffsetY = 0.6 * dpr;
  ctx.lineWidth = (OUTLINE * 2) / k; // outer half of a centered stroke is OUTLINE css px
  ctx.strokeStyle = '#fff';
  ctx.stroke(path);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = color;
  ctx.fill(path);
  if (shape === 'pen-add') {
    // pen "add point" plus
    const plus = new Path2D('M19 15.5 V22.5 M15.5 19 H22.5');
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#fff';
    ctx.stroke(plus);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#1E1E1E';
    ctx.stroke(plus);
  }
  cache.set(key, cv);
  return cv;
}
