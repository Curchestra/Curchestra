import { clamp, easeInOutCubic } from '../motion/ease';
import { typingDelays } from '../motion/timing';
import type { Config, Cursor, CursorShape, Deco, Piece, Pt, Rect, RevealOp, Task } from '../types';

export interface ActionCtx {
  /** live viewport rect of the task element, refreshed each frame */
  rect: Rect;
  /** live text line rects, text tasks only */
  lines: Rect[];
  /** dup: live rect of the original */
  origRect?: Rect;
  guideX?: number;
  viewport: { w: number; h: number };
  rng: () => number;
  speed: number;
  effects: Config['effects'];
  color: string;
}

export interface Action {
  /** where the cursor goes first */
  start: Pt;
  shape: CursorShape;
  /** seconds */
  duration: number;
  update(t: number, ctx: ActionCtx, cursor: Cursor, out: { decos: Deco[]; ops: RevealOp[] }): void;
  finish(ctx: ActionCtx, out: { ops: RevealOp[] }): void;
  /** second offsets, for audio */
  keystrokes?: number[];
}

const MAX_CHARS = 120;
const MAX_TYPE_S = 6;

const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const prog = (t: number, d: number) => (d > 0 ? clamp(t / d, 0, 1) : 1);

function fadeOnFinish(piece: Piece | null, ms: number): Action['finish'] {
  return (_c, out) => {
    if (piece) out.ops.push({ op: 'fade', el: piece.el, ms });
  };
}

function dragAction(piece: Piece | null, ctx: ActionCtx, media: boolean): Action {
  const duration = 0.55 / ctx.speed;
  return {
    start: { x: ctx.rect.x, y: ctx.rect.y },
    shape: 'cross',
    duration,
    update(t, c, cursor, out) {
      const e = easeInOutCubic(prog(t, duration));
      const r = { x: c.rect.x, y: c.rect.y, w: c.rect.w * e, h: c.rect.h * e };
      cursor.x = r.x + r.w;
      cursor.y = r.y + r.h;
      cursor.shape = 'cross';
      cursor.press = t < duration ? 1 : 0;
      out.decos.push(media ? { t: 'media', r } : { t: 'outline', r, color: c.color });
      if (c.effects.sizeBadge) {
        out.decos.push({
          t: 'badge',
          x: cursor.x,
          y: cursor.y,
          text: `${Math.round(r.w)}×${Math.round(r.h)}`,
          color: c.color,
        });
      }
    },
    finish: fadeOnFinish(piece, media ? 260 : 180),
  };
}

function lineAction(piece: Piece | null, ctx: ActionCtx): Action {
  const duration = 0.7 / ctx.speed;
  return {
    start: { x: ctx.rect.x, y: ctx.rect.y },
    shape: 'pen',
    duration,
    update(t, c, cursor, out) {
      const { x, y, w, h } = c.rect;
      const corners: Pt[] = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ];
      const sides = [w, h, w, h];
      const total = 2 * (w + h);
      const d = prog(t, duration) * total;
      const pts: Pt[] = [corners[0]];
      let acc = 0;
      let cur: Pt = corners[0];
      for (let i = 0; i < 4; i++) {
        if (d >= acc + sides[i]) {
          acc += sides[i];
          cur = corners[i + 1];
          pts.push(cur);
        } else {
          const f = sides[i] > 0 ? (d - acc) / sides[i] : 0;
          cur = {
            x: corners[i].x + (corners[i + 1].x - corners[i].x) * f,
            y: corners[i].y + (corners[i + 1].y - corners[i].y) * f,
          };
          pts.push(cur);
          break;
        }
      }
      cursor.x = cur.x;
      cursor.y = cur.y;
      cursor.shape = 'pen';
      cursor.press = 0;
      out.decos.push({ t: 'path', pts, color: c.color });
    },
    finish: fadeOnFinish(piece, 180),
  };
}

function caretAt(lines: Rect[], progress: number, rtl: boolean): { x: number; y: number; h: number } {
  const total = lines.reduce((a, l) => a + l.w, 0);
  const covered = clamp(progress, 0, 1) * total;
  let start = 0;
  let l = lines[0];
  for (const cand of lines) {
    l = cand;
    if (covered <= start + cand.w) break;
    start += cand.w;
  }
  const frac = l.w > 0 ? clamp((covered - start) / l.w, 0, 1) : 0;
  return { x: rtl ? l.x + l.w * (1 - frac) : l.x + l.w * frac, y: l.y, h: l.h };
}

function textAction(piece: Piece | null, ctx: ActionCtx): Action {
  const first = (ctx.lines[0] ?? ctx.rect) as Rect;
  const start = { x: first.x, y: first.y + first.h / 2 };
  if (!piece || !ctx.effects.typing) {
    return {
      start,
      shape: 'arrow',
      duration: 0.3 / ctx.speed,
      update() {},
      finish: fadeOnFinish(piece, 220),
    };
  }
  const el = piece.el;
  let text = (el.textContent ?? '').trim().slice(0, MAX_CHARS);
  if (!text) text = 'x'.repeat(Math.max(1, Math.min(piece.textLen, MAX_CHARS)));
  const delays = typingDelays(text, ctx.rng, ctx.speed);
  const sum = delays.reduce((a, b) => a + b, 0);
  const cap = (MAX_TYPE_S * 1000) / ctx.speed;
  const k = sum > cap ? cap / sum : 1;
  const cum: number[] = [];
  let acc = 0;
  for (const d of delays) {
    acc += d * k;
    cum.push(acc);
  }
  const duration = acc / 1000;
  const rtl = piece.rtl;
  return {
    start,
    shape: 'ibeam',
    duration,
    keystrokes: cum.map((c) => c / 1000),
    update(t, c, cursor, out) {
      const ms = clamp(t, 0, duration) * 1000;
      let typed = 0;
      while (typed < cum.length && cum[typed] <= ms + 1e-9) typed++;
      const progress = typed / cum.length;
      const lines = c.lines.length ? c.lines : [c.rect];
      out.ops.push({ op: 'clip', el, lines, progress, rtl, elRect: c.rect });
      const caret = caretAt(lines, progress, rtl);
      out.decos.push({ t: 'caret', x: caret.x, y: caret.y, h: caret.h, color: c.color });
      cursor.x = caret.x;
      cursor.y = caret.y + caret.h / 2;
      cursor.shape = 'ibeam';
      cursor.press = 0;
    },
    finish(_c, out) {
      out.ops.push({ op: 'unclip', el }, { op: 'show', el });
    },
  };
}

function dupAction(piece: Piece | null, ctx: ActionCtx): Action {
  const duration = 0.6 / ctx.speed;
  const from0 = ctx.origRect ?? ctx.rect;
  return {
    start: center(from0),
    shape: 'dup',
    duration,
    update(t, c, cursor, out) {
      const e = easeInOutCubic(prog(t, duration));
      const a = c.origRect ?? c.rect;
      const b = c.rect;
      const r = {
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
        w: a.w + (b.w - a.w) * e,
        h: a.h + (b.h - a.h) * e,
      };
      const m = center(r);
      cursor.x = m.x;
      cursor.y = m.y;
      cursor.shape = 'dup';
      cursor.press = 0;
      out.decos.push({ t: 'ghost', r, color: c.color });
    },
    finish: fadeOnFinish(piece, 160),
  };
}

function guideAction(ctx: ActionCtx): Action {
  const duration = 0.4 / ctx.speed;
  const gx = ctx.guideX ?? 0;
  return {
    start: { x: gx, y: 0 },
    shape: 'arrow',
    duration,
    update(t, c, cursor, out) {
      const x = c.guideX ?? gx;
      cursor.x = x;
      cursor.y = c.viewport.h * 0.5 * easeInOutCubic(prog(t, duration));
      cursor.shape = 'arrow';
      cursor.press = 0;
      out.decos.push({ t: 'guide', x, color: c.color });
    },
    finish() {},
  };
}

export function createAction(task: Task, piece: Piece | null, ctx: ActionCtx): Action {
  let a: Action;
  switch (task.type) {
    case 'box':
      a = dragAction(piece, ctx, false);
      break;
    case 'media':
      a = dragAction(piece, ctx, true);
      break;
    case 'line':
      a = lineAction(piece, ctx);
      break;
    case 'text':
      a = textAction(piece, ctx);
      break;
    case 'dup':
      a = dupAction(piece, ctx);
      break;
    default:
      a = guideAction(ctx);
  }
  const inner = a.update;
  a.update = (t, c, cursor, out) => inner(clamp(t, 0, a.duration), c, cursor, out);
  return a;
}
