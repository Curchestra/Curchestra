import type { Cursor, Deco, Host, Rect, Stage } from '../types';
import { cursorPath, getSprite, SPRITE_PX, SPRITE_SCALE } from './sprites';

const PAD = 2;
const TAG_FONT = '600 12px system-ui, sans-serif';
const BADGE_FONT = '600 11px system-ui, sans-serif';

const NEUTRAL = {
  light: { fill: '#ECECEC', glyph: '#B8B8B8' },
  dark: { fill: '#2B2B2B', glyph: '#5A5A5A' },
};

export function createStage(host: Host, zIndex: number, theme: 'light' | 'dark'): Stage {
  const el = host.doc.createElement('canvas');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${zIndex}`;
  host.doc.documentElement.appendChild(el);
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  let dpr = 1;
  let prev: Rect | null = null;

  function resize(): void {
    const vp = host.viewport();
    dpr = host.dpr();
    el.width = Math.max(1, Math.round(vp.w * dpr));
    el.height = Math.max(1, Math.round(vp.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    prev = null;
  }
  resize();

  function textWidth(font: string, text: string): number {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function pill(r: Rect, color: string, font: string, text: string): void {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, r.x + r.h / 2 - 2, r.y + r.h / 2 + 0.5);
  }

  function tagRect(c: Cursor): Rect {
    return { x: c.x + 14, y: c.y + 18, w: textWidth(TAG_FONT, c.name) + 16, h: 20 };
  }

  function badgeRect(d: Extract<Deco, { t: 'badge' }>): Rect {
    return { x: d.x, y: d.y, w: textWidth(BADGE_FONT, d.text) + 14, h: 18 };
  }

  function union(a: Rect | null, b: Rect): Rect {
    if (!a) return { ...b };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function decoBounds(d: Deco, vh: number): Rect {
    switch (d.t) {
      case 'outline':
      case 'ghost':
      case 'media':
        return d.r;
      case 'badge':
        return badgeRect(d);
      case 'caret':
        return { x: d.x - 1, y: d.y, w: 2, h: d.h };
      case 'guide':
        return { x: d.x - 1, y: 0, w: 2, h: vh };
      case 'path': {
        let r: Rect | null = null;
        for (const p of d.pts) r = union(r, { x: p.x, y: p.y, w: 0, h: 0 });
        return r ?? { x: 0, y: 0, w: 0, h: 0 };
      }
    }
  }

  function drawDeco(d: Deco, vh: number): void {
    ctx.globalAlpha = 1;
    switch (d.t) {
      case 'outline':
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(d.r.x + 0.5, d.r.y + 0.5, d.r.w - 1, d.r.h - 1);
        break;
      case 'badge':
        pill(badgeRect(d), d.color, BADGE_FONT, d.text);
        break;
      case 'caret':
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 1, d.y, 2, d.h);
        break;
      case 'guide':
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 0.5, 0, 1, vh);
        break;
      case 'path':
        if (d.pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i].x, d.pts[i].y);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        break;
      case 'ghost':
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = d.color;
        ctx.fillRect(d.r.x, d.r.y, d.r.w, d.r.h);
        ctx.globalAlpha = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(d.r.x + 0.5, d.r.y + 0.5, d.r.w - 1, d.r.h - 1);
        ctx.setLineDash([]);
        break;
      case 'media': {
        const n = NEUTRAL[theme];
        const { x, y, w, h } = d.r;
        ctx.fillStyle = n.fill;
        ctx.fillRect(x, y, w, h);
        const s = Math.min(w, h, 48) * 0.5;
        if (s >= 8) {
          const cx = x + w / 2;
          const cy = y + h / 2;
          ctx.fillStyle = n.glyph;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy + s * 0.6);
          ctx.lineTo(cx - s * 0.3, cy - s * 0.2);
          ctx.lineTo(cx + s * 0.1, cy + s * 0.3);
          ctx.lineTo(cx + s * 0.4, cy - s * 0.05);
          ctx.lineTo(cx + s, cy + s * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + s * 0.45, cy - s * 0.5, s * 0.17, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }

  function draw(cursors: Cursor[], decos: Deco[], showNames: boolean): void {
    const vp = host.viewport();
    const live = cursors.filter((c) => c.phase !== 'hidden' && c.alpha > 0);
    let cur: Rect | null = null;
    for (const d of decos) cur = union(cur, decoBounds(d, vp.h));
    for (const c of live) {
      const { hot } = cursorPath(c.shape);
      cur = union(cur, { x: c.x - hot.x * SPRITE_SCALE, y: c.y - hot.y * SPRITE_SCALE, w: SPRITE_PX, h: SPRITE_PX });
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

    for (const d of decos) drawDeco(d, vp.h);
    for (const c of live) {
      const { hot } = cursorPath(c.shape);
      const s = 1 - c.press * 0.12;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.translate(c.x, c.y);
      ctx.scale(s, s);
      ctx.drawImage(getSprite(c.shape, c.color, dpr), -hot.x * SPRITE_SCALE, -hot.y * SPRITE_SCALE, SPRITE_PX, SPRITE_PX);
      ctx.restore();
    }
    if (showNames) {
      for (const c of live) {
        if (!c.name) continue;
        ctx.globalAlpha = c.alpha;
        pill(tagRect(c), c.color, TAG_FONT, c.name);
      }
    }
    ctx.globalAlpha = 1;
  }

  function destroy(): void {
    el.remove();
  }

  return { draw, resize, destroy, el };
}
