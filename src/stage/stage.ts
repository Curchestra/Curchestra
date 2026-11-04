/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { Cursor, Deco, Host, Pt, Rect, RulerState, Stage } from '../types';
import { getSprite, hotOf, SPRITE_PX, SPRITE_SCALE } from './sprites';

const PAD = 2;
const FONT = 'system-ui,-apple-system,"Segoe UI",sans-serif';
const TAG_FONT = `600 12px ${FONT}`;
const BADGE_FONT = `600 11px ${FONT}`;
const RULER_FONT = `500 9px ${FONT}`;
/** selection blue and guide red */
export const BLUE = '#0D99FF';
export const RED = '#F24822';
/** ruler thickness, px */
export const RULER = 20;
const RULER_BG = '#2C2C2C';
const RULER_EDGE = '#3A3A3A';
const RULER_TICK = '#5E5E5E';
const RULER_TEXT = '#8C8C8C';

const NEUTRAL = {
  light: { fill: '#D9D9D9', glyph: '#8A8A8A' },
  dark: { fill: '#3A3A3A', glyph: '#7A7A7A' },
};

export function createStage(host: Host, zIndex: number, theme: 'light' | 'dark'): Stage {
  const el = host.doc.createElement('canvas');
  el.setAttribute('aria-hidden', 'true');
  // own view-transition layer, so transitions do not freeze and cross-fade the cursors
  el.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:${zIndex};view-transition-name:curchestra-stage`;
  const vt = host.doc.createElement('style');
  vt.textContent =
    '::view-transition-old(curchestra-stage){display:none}' +
    '::view-transition-group(curchestra-stage),::view-transition-new(curchestra-stage){animation:none}';
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  let dpr = 1;
  let prev: Rect | null = null;

  function resize(): void {
    const vp = host.viewport();
    dpr = host.dpr();
    // match the backing store (100vw would include scrollbars)
    el.style.width = `${vp.w}px`;
    el.style.height = `${vp.h}px`;
    el.width = Math.max(1, Math.round(vp.w * dpr));
    el.height = Math.max(1, Math.round(vp.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    prev = null;
  }
  resize();
  // attach only once it works
  host.doc.documentElement.appendChild(el);
  host.doc.head?.appendChild(vt);

  const widths = new Map<string, number>();
  function textWidth(font: string, text: string): number {
    const key = font + '|' + text;
    let w = widths.get(key);
    if (w === undefined) {
      if (widths.size > 512) widths.clear();
      ctx.font = font;
      w = ctx.measureText(text).width;
      widths.set(key, w);
    }
    return w;
  }

  function label(r: Rect, bg: string, font: string, text: string, radius: number): void {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    ctx.textAlign = 'start';
  }

  function tagRect(c: Cursor): Rect {
    return { x: c.x + 12, y: c.y + 16, w: textWidth(TAG_FONT, c.name) + 16, h: 20 };
  }

  /** small square-ish badge centered under (cx, top) */
  function badgeRect(text: string, cx: number, top: number): Rect {
    const w = textWidth(BADGE_FONT, text) + 8;
    return { x: cx - w / 2, y: top, w, h: 16 };
  }

  function union(a: Rect | null, b: Rect): Rect {
    if (!a) return { ...b };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  const ptsRect = (pts: Pt[]): Rect => {
    let r: Rect | null = null;
    for (const p of pts) r = union(r, { x: p.x - 5, y: p.y - 5, w: 10, h: 10 });
    return r ?? { x: 0, y: 0, w: 0, h: 0 };
  };

  function decoBounds(d: Deco, vp: { w: number; h: number }, rt: number): Rect {
    switch (d.t) {
      case 'sel': {
        let r: Rect = { x: d.r.x - 5, y: d.r.y - 5, w: d.r.w + 10, h: d.r.h + 10 };
        if (d.badge) r = union(r, badgeRect(d.badge, d.r.x + d.r.w / 2, d.r.y + d.r.h + 8));
        if (d.rulerLines && rt > 0.05) r = union(r, { x: 0, y: 0, w: d.r.x + d.r.w, h: d.r.y + d.r.h });
        return r;
      }
      case 'measure':
        return union(ptsRect([d.a, d.b]), badgeRect(d.label, (d.a.x + d.b.x) / 2, Math.max(d.a.y, d.b.y) + 8));
      case 'pen':
        return ptsRect(d.tail ? [...d.pts, d.tail] : d.pts);
      case 'hilite':
      case 'media':
        return d.r;
      case 'caret':
        return { x: d.x - 1, y: d.y, w: 2, h: d.h };
      case 'guide':
        return { x: d.x - 6, y: 0, w: 12 + (d.drag ? 40 : 0), h: vp.h };
    }
  }

  function selection(d: Extract<Deco, { t: 'sel' }>, rt: number): void {
    const { x, y, w, h } = d.r;
    const col = d.red ? RED : BLUE;
    ctx.lineWidth = 1;
    ctx.strokeStyle = col;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(0, Math.round(w) - 1), Math.max(0, Math.round(h) - 1));
    if (d.rulerLines && rt > 0.05) {
      ctx.globalAlpha = rt;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(RULER, y + h / 2);
      ctx.lineTo(x, y + h / 2);
      ctx.moveTo(x + w / 2, RULER);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (d.handles) {
      for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(hx - 3.5, hy - 3.5, 7, 7);
        ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
      }
    }
    if (d.badge && w > 0) label(badgeRect(d.badge, x + w / 2, y + h + 8), col, BADGE_FONT, d.badge, 2);
  }

  function drawDeco(d: Deco, vp: { w: number; h: number }, rt: number): void {
    ctx.globalAlpha = 1;
    switch (d.t) {
      case 'sel':
        selection(d, rt);
        break;
      case 'measure': {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(d.a.x, d.a.y);
        ctx.lineTo(d.b.x, d.b.y);
        ctx.stroke();
        const horiz = Math.abs(d.a.y - d.b.y) < 0.5;
        const cx = horiz ? (d.a.x + d.b.x) / 2 : d.a.x + 18;
        const top = horiz ? d.a.y + 8 : (d.a.y + d.b.y) / 2 - 8;
        label(badgeRect(d.label, cx, top), RED, BADGE_FONT, d.label, 2);
        break;
      }
      case 'pen': {
        const all = d.tail ? [...d.pts, d.tail] : d.pts;
        if (all.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(all[0].x, all[0].y);
          for (let i = 1; i < all.length; i++) ctx.lineTo(all[i].x, all[i].y);
          if (d.closed) ctx.closePath();
          ctx.strokeStyle = BLUE;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
        ctx.lineWidth = 1.5;
        for (const p of d.pts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = BLUE;
          ctx.stroke();
        }
        break;
      }
      case 'hilite':
        ctx.fillStyle = 'rgba(13,153,255,.28)';
        ctx.fillRect(d.r.x, d.r.y, d.r.w, d.r.h);
        break;
      case 'caret':
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 1, d.y, 2, d.h);
        break;
      case 'guide': {
        const f = d.flash ?? 0;
        if (f > 0) {
          ctx.shadowColor = RED;
          ctx.shadowBlur = 2 + f * 3;
        }
        ctx.fillStyle = RED;
        const w = 1 + f;
        ctx.fillRect(Math.round(d.x) - w / 2, 0, w, vp.h);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        break;
      }
      case 'media': {
        const n = NEUTRAL[theme];
        const { x, y, w, h } = d.r;
        ctx.fillStyle = n.fill;
        ctx.fillRect(x, y, w, h);
        const s = Math.min(w, h, 44) * 0.5;
        if (s >= 8) {
          // an image icon: frame, sun and hills
          const cx = x + w / 2;
          const cy = y + h / 2;
          ctx.strokeStyle = n.glyph;
          ctx.lineWidth = 1.6;
          ctx.lineJoin = 'round';
          ctx.strokeRect(cx - s * 0.75, cy - s * 0.6, s * 1.5, s * 1.2);
          ctx.beginPath();
          ctx.arc(cx - s * 0.25, cy - s * 0.15, s * 0.15, 0, Math.PI * 2);
          ctx.moveTo(cx - s * 0.65, cy + s * 0.45);
          ctx.lineTo(cx - s * 0.15, cy + s * 0.05);
          ctx.lineTo(cx + s * 0.15, cy + s * 0.3);
          ctx.lineTo(cx + s * 0.4, cy + s * 0.1);
          ctx.lineTo(cx + s * 0.7, cy + s * 0.4);
          ctx.stroke();
        }
        break;
      }
    }
  }

  /** Top and left rulers with selection spans and dragged guides. */
  function drawRulers(decos: Deco[], vp: { w: number; h: number }, r: RulerState): void {
    const off = (r.t - 1) * RULER;
    ctx.save();
    ctx.translate(0, off);
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, vp.w, RULER);
    ctx.fillStyle = RULER_EDGE;
    ctx.fillRect(0, RULER - 1, vp.w, 1);
    ctx.restore();
    ctx.save();
    ctx.translate(off, 0);
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, RULER, vp.h);
    ctx.fillStyle = RULER_EDGE;
    ctx.fillRect(RULER - 1, 0, 1, vp.h);
    ctx.restore();

    ctx.font = RULER_FONT;
    ctx.textBaseline = 'alphabetic';
    // selection spans first, so ticks draw over them
    for (const d of decos) {
      if (d.t !== 'sel' || !d.handles || d.red) continue;
      ctx.fillStyle = 'rgba(13,153,255,.22)';
      ctx.fillRect(d.r.x, off, d.r.w, RULER);
      ctx.fillRect(off, d.r.y, RULER, d.r.h);
    }
    const step = 100;
    ctx.strokeStyle = RULER_TICK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = Math.floor(r.sx / step) * step; c - r.sx < vp.w; c += step / 2) {
      const x = Math.round(c - r.sx) + 0.5;
      const major = c % step === 0;
      ctx.moveTo(x, off + (major ? 13 : 16));
      ctx.lineTo(x, off + RULER);
    }
    for (let c = Math.floor(r.sy / step) * step; c - r.sy < vp.h; c += step / 2) {
      const y = Math.round(c - r.sy) + 0.5;
      const major = c % step === 0;
      ctx.moveTo(off + (major ? 13 : 16), y);
      ctx.lineTo(off + RULER, y);
    }
    ctx.stroke();
    ctx.fillStyle = RULER_TEXT;
    for (let c = Math.floor(r.sx / step) * step; c - r.sx < vp.w; c += step) ctx.fillText(String(c), c - r.sx + 3, off + 11);
    for (let c = Math.floor(r.sy / step) * step; c - r.sy < vp.h; c += step) {
      const y = c - r.sy - 3;
      ctx.save();
      ctx.translate(off + 11, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(c), 0, 0);
      ctx.restore();
    }
    for (const d of decos) {
      if (d.t === 'sel' && d.handles && !d.red) {
        ctx.fillStyle = BLUE;
        ctx.fillText(String(Math.round(d.r.x + r.sx)), d.r.x + 3, off + 11);
      } else if (d.t === 'guide' && d.drag) {
        ctx.fillStyle = RED;
        ctx.fillRect(Math.round(d.x), off, 1, RULER);
        ctx.fillText(String(Math.round(d.label ?? d.x + r.sx)), d.x + 4, off + 11);
      }
    }
    ctx.globalAlpha = r.t;
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.globalAlpha = 1;
  }

  function draw(cursors: Cursor[], decos: Deco[], showNames: boolean, vp: { w: number; h: number }, rulers?: RulerState): void {
    const live = cursors.filter((c) => c.phase !== 'hidden' && c.alpha > 0);
    const rt = rulers?.t ?? 0;
    let cur: Rect | null = null;
    for (const d of decos) cur = union(cur, decoBounds(d, vp, rt));
    if (rt > 0.001) {
      cur = union(cur, { x: 0, y: 0, w: vp.w, h: RULER });
      cur = union(cur, { x: 0, y: 0, w: RULER, h: vp.h });
    }
    for (const c of live) {
      const hot = hotOf(c.shape);
      if (c.angle) {
        // rotated about the hotspot
        const r = SPRITE_PX * 1.42;
        cur = union(cur, { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 });
      } else cur = union(cur, { x: c.x - hot.x * SPRITE_SCALE, y: c.y - hot.y * SPRITE_SCALE, w: SPRITE_PX, h: SPRITE_PX });
      if (showNames && c.name) cur = union(cur, tagRect(c));
    }
    if (cur) {
      const x0 = Math.max(0, Math.floor(cur.x - PAD));
      const y0 = Math.max(0, Math.floor(cur.y - PAD));
      const x1 = Math.min(vp.w, Math.ceil(cur.x + cur.w + PAD));
      const y1 = Math.min(vp.h, Math.ceil(cur.y + cur.h + PAD));
      cur = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }
    const dirty = cur && prev ? union(prev, cur) : (cur ?? prev);
    if (dirty) {
      ctx.globalAlpha = 1;
      ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
    }
    prev = cur;
    if (!cur) return;

    for (const d of decos) drawDeco(d, vp, rt);
    if (rulers && rt > 0.001) drawRulers(decos, vp, rulers);
    for (const c of live) {
      const hot = hotOf(c.shape);
      const s = 1 - c.press * 0.12;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.translate(c.x, c.y);
      if (c.angle) ctx.rotate((c.angle * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.drawImage(getSprite(c.shape, c.color, dpr, host.doc), -hot.x * SPRITE_SCALE, -hot.y * SPRITE_SCALE, SPRITE_PX, SPRITE_PX);
      ctx.restore();
    }
    if (showNames) {
      for (const c of live) {
        if (!c.name) continue;
        ctx.globalAlpha = c.alpha;
        label(tagRect(c), c.color, TAG_FONT, c.name, 10);
      }
    }
    ctx.globalAlpha = 1;
  }

  function destroy(): void {
    el.remove();
    vt.remove();
  }

  return { draw, resize, destroy, el };
}
