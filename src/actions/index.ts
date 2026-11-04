import { clamp, easeInOutCubic, easeOutCubic } from '../motion/ease';
import type { Config, Cursor, CursorShape, Deco, Fx, Piece, Pt, Rect, RevealOp, Task } from '../types';

/** Cursor routines: each task is a script of moves, clicks, drags, waits and typing, plus overlay and fx. */
export interface ActionCtx {
  /** live viewport rect of the task element */
  rect: Rect;
  /** live text line rects, text tasks only */
  lines: Rect[];
  /** dup: live rect of the original */
  origRect?: Rect;
  /** dup: the original's text, when the copy is retyped */
  origText?: string;
  /** guide task: live viewport x of the guide */
  guideX?: number;
  /** text task: live viewport x of the guide it snaps onto */
  snapX?: number;
  viewport: { w: number; h: number };
  rng: () => number;
  speed: number;
  effects: Config['effects'];
  color: string;
}

export interface Out {
  decos: Deco[];
  ops: RevealOp[];
  fx: Fx[];
}

export interface Action {
  /** where the cursor goes first */
  start: Pt;
  shape: CursorShape;
  /** seconds */
  duration: number;
  /** needs the rulers */
  rulers?: boolean;
  update(t: number, ctx: ActionCtx, cursor: Cursor, out: Out): void;
  finish(ctx: ActionCtx, out: Out): void;
}

// ---- runner

interface St {
  c: ActionCtx;
  cur: Cursor;
  out: Out;
  /** cursor position when the current step began */
  from: Pt;
}

interface Step {
  d: number;
  /** once, when the step begins */
  enter?: (s: St) => void;
  /** every frame while the step runs, k in 0..1 */
  run?: (k: number, s: St) => void;
}

/** Overlay kept on screen between steps. */
type Overlay = ((s: St) => Deco[]) | null;

function runner(steps: Step[], overlay: { ov: Overlay }) {
  const ends: number[] = [];
  let acc = 0;
  for (const s of steps) ends.push((acc += s.d));
  let entered = -1;
  let from: Pt = { x: 0, y: 0 };
  return {
    duration: acc,
    update(t: number, c: ActionCtx, cur: Cursor, out: Out): void {
      let j = 0;
      while (j < steps.length - 1 && t >= ends[j]) j++;
      const st: St = { c, cur, out, from };
      // a finished step still gets its final frame
      if (j > entered && entered >= 0) steps[entered].run?.(1, st);
      for (let i = entered + 1; i <= j; i++) {
        from = st.from = { x: cur.x, y: cur.y };
        steps[i].enter?.(st);
        if (i < j) steps[i].run?.(1, st);
      }
      entered = Math.max(entered, j);
      const begin = j ? ends[j - 1] : 0;
      const step = steps[j];
      if (step) step.run?.(step.d > 0 ? clamp((t - begin) / step.d, 0, 1) : 1, st);
      if (overlay.ov) out.decos.push(...overlay.ov(st));
    },
  };
}

// ---- building blocks

const rand = (rng: () => number, a: number, b: number) => a + rng() * (b - a);
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const size = (r: Rect) => `${Math.round(r.w)} × ${Math.round(r.h)}`;

/** Travel time grows with √distance. */
const moveDur = (d: number, speed: number) => clamp(0.12 + Math.sqrt(d) * 0.021, 0.14, 0.9) / speed;

interface MoveOpts {
  /** extra speed multiplier */
  speed?: number;
  /** a drag: straight, eased in and out */
  drag?: boolean;
  /** sideways bend as a fraction of the distance (default: random 4–14%) */
  bend?: number;
  /** after each step of the move */
  onStep?: (s: St) => void;
}

/** Move to a live target; `est` sizes the step, the real start is read when it begins. */
function move(rng: () => number, est: Pt, to: (s: St) => Pt, estTo: Pt, speed: number, o: MoveOpts = {}): Step {
  const d = dist(est, estTo);
  const side = rng() < 0.5 ? -1 : 1;
  const bend = o.bend ?? side * rand(rng, 0.04, 0.14);
  return {
    d: d < 0.5 ? 0 : moveDur(d, speed * (o.speed ?? 1)),
    run(k, s) {
      const p = to(s);
      const e = o.drag ? easeInOutCubic(k) : easeOutCubic(k);
      const dx = p.x - s.from.x;
      const dy = p.y - s.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.sin(Math.PI * e) * bend * Math.min(len, 600);
      s.cur.x = s.from.x + dx * e - (dy / len) * off;
      s.cur.y = s.from.y + dy * e + (dx / len) * off;
      o.onStep?.(s);
    },
  };
}

const wait = (d: number, speed: number, enter?: (s: St) => void): Step => ({ d: d / speed, enter });

/** Press, then a short beat. */
const click = (speed: number, then?: (s: St) => void): Step => ({
  d: 0.07 / speed,
  enter(s) {
    s.cur.press = 1;
    s.out.fx.push({ k: 'press' });
    then?.(s);
  },
});

const shape = (sh: CursorShape): Step => ({ d: 0, enter: (s) => void (s.cur.shape = sh) });

function fade(el: Element | null, ms: number, kind: Extract<Fx, { k: 'place' }>['kind']): (s: St) => void {
  return (s) => {
    if (el) s.out.ops.push({ op: 'fade', el, ms });
    s.out.fx.push({ k: 'place', kind, r: s.c.rect });
  };
}

/** Drag end, kept on screen for huge boxes. */
function dragEnd(r: Rect, vp: { w: number; h: number }): Pt {
  const x = r.x + r.w > vp.w - 16 ? Math.max(r.x + Math.min(r.w, 40), vp.w - 30) : r.x + r.w;
  const y = r.y + r.h > vp.h - 16 ? Math.max(r.y + Math.min(r.h, 40), vp.h - 40) : r.y + r.h;
  return { x: Math.min(x, r.x + r.w), y: Math.min(y, r.y + r.h) };
}

/** Spacing between two boxes, measured where they overlap. */
function spacing(a: Rect, b: Rect): Deco | null {
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (oy > 0) {
    const y = Math.max(a.y, b.y) + oy / 2;
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    const gap = r.x - (l.x + l.w);
    if (gap > 0) return { t: 'measure', a: { x: l.x + l.w, y }, b: { x: r.x, y }, label: String(Math.round(gap)) };
  } else if (ox > 0) {
    const x = Math.max(a.x, b.x) + ox / 2;
    const [t, bt] = a.y < b.y ? [a, b] : [b, a];
    const gap = bt.y - (t.y + t.h);
    if (gap > 0) return { t: 'measure', a: { x, y: t.y + t.h }, b: { x, y: bt.y }, label: String(Math.round(gap)) };
  }
  return null;
}

function linesBox(lines: Rect[], fallback: Rect): Rect {
  if (!lines.length) return fallback;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of lines) {
    x0 = Math.min(x0, l.x);
    y0 = Math.min(y0, l.y);
    x1 = Math.max(x1, l.x + l.w);
    y1 = Math.max(y1, l.y + l.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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

/** Human-like typing times; returns cumulative seconds per char. */
export function typingTimeline(text: string, rng: () => number, speed: number): number[] {
  const n = Math.max(1, text.length);
  const k = clamp(70 / n, 0.06, 1);
  const out: number[] = [];
  let acc = 0;
  for (const ch of text) {
    let d = rand(rng, 0.012, 0.04);
    if (ch === ' ') d += rand(rng, 0, 0.03);
    if (ch === '\n') d += 0.1;
    if (rng() < 0.025) d += rand(rng, 0.08, 0.2);
    acc += (d * k) / speed;
    out.push(acc);
  }
  return out;
}

/** Transform we last applied, to read rects back without it. */
interface Xf {
  dx: number;
  dy: number;
  s: number;
}
const base = (r: Rect, x: Xf): Rect => ({ x: r.x - x.dx, y: r.y - x.dy, w: r.w / x.s, h: r.h / x.s });
function setXf(s: St, el: Element, x: Xf, dx: number, dy: number, sc: number): void {
  x.dx = dx;
  x.dy = dy;
  x.s = sc;
  s.out.ops.push({ op: 'xform', el, dx, dy, s: sc });
}

/** Reveal `el` as it is typed, with a caret and key fx. */
function typing(
  el: Element, text: string, rtl: boolean, rng: () => number, speed: number, x: Xf, sel?: Overlay, box = false,
): Step {
  const cum = typingTimeline(text, rng, speed);
  const total = cum[cum.length - 1] ?? 0;
  let shown = 0;
  return {
    d: total,
    run(k, s) {
      const t = k * total;
      let i = shown;
      while (i < cum.length && cum[i] <= t + 1e-9) i++;
      if (i > shown) {
        const chunk = text.slice(shown, i);
        s.out.fx.push({ k: 'key', n: i - shown, space: /\s/.test(chunk) });
        s.cur.press = Math.max(s.cur.press, 0.55);
        shown = i;
      }
      const r = s.c.rect;
      const lines = (s.c.lines.length ? s.c.lines : [r]).map((l) => ({
        x: r.x + (l.x - r.x) / x.s,
        y: r.y + (l.y - r.y) / x.s,
        w: l.w / x.s,
        h: l.h / x.s,
      }));
      const elRect = { x: r.x, y: r.y, w: r.w / x.s, h: r.h / x.s };
      const progress = cum.length ? shown / cum.length : 1;
      s.out.ops.push({ op: 'clip', el, lines, progress, rtl, elRect, box });
      const live = s.c.lines.length ? s.c.lines : [r];
      const caret = caretAt(live, progress, rtl);
      s.out.decos.push({ t: 'caret', x: caret.x, y: caret.y, h: caret.h, color: s.c.color });
      if (sel) s.out.decos.push(...sel(s));
    },
  };
}

// ---- routines

/** Boxes and images: drag out a selection, then show the element. */
function boxAction(piece: Piece | null, ctx: ActionCtx, media: boolean): Action {
  const { rng, speed } = ctx;
  const r0 = ctx.rect;
  const start = { x: r0.x, y: r0.y };
  const end0 = dragEnd(r0, ctx.viewport);
  const el = piece?.el ?? null;
  let drawn: Rect = { x: r0.x, y: r0.y, w: 0, h: 0 };
  let full = false;
  const o: { ov: Overlay } = { ov: null };
  const live = (s: St): Rect => (full ? s.c.rect : drawn);
  const sel = (s: St, badge: boolean): Deco[] => {
    const r = live(s);
    const out: Deco[] = [];
    if (media && !full) out.push({ t: 'media', r });
    out.push({ t: 'sel', r, handles: true, badge: badge && s.c.effects.sizeBadge ? size(r) : undefined, rulerLines: true });
    return out;
  };
  const clamped = end0.x < r0.x + r0.w - 0.5 || end0.y < r0.y + r0.h - 0.5;
  const steps: Step[] = [
    shape('cross'),
    click(speed, () => (o.ov = (s) => sel(s, true))),
    move(rng, start, (s) => dragEnd(s.c.rect, s.c.viewport), end0, speed, {
      speed: 0.75,
      drag: true,
      bend: 0,
      onStep(s) {
        s.cur.press = 1;
        const r = s.c.rect;
        drawn = { x: r.x, y: r.y, w: Math.max(0, s.cur.x - r.x), h: Math.max(0, s.cur.y - r.y) };
      },
    }),
  ];
  if (clamped) {
    let w0 = 0;
    let h0 = 0;
    steps.push({
      d: 0.5 / speed,
      enter: () => {
        w0 = drawn.w;
        h0 = drawn.h;
      },
      run(k, s) {
        const e = easeOutCubic(k);
        const r = s.c.rect;
        drawn = { x: r.x, y: r.y, w: w0 + (r.w - w0) * e, h: h0 + (r.h - h0) * e };
      },
    });
  }
  steps.push(
    {
      d: rand(rng, 0.18, 0.3) / speed,
      enter: (s) => {
        full = true;
        s.cur.shape = 'arrow';
      },
    },
    wait(media ? 0.5 : 0.35, speed, fade(el, media ? 260 : 180, media ? 'media' : 'box')),
  );
  const r = runner(steps, o);
  return {
    start,
    shape: 'cross',
    duration: r.duration,
    update: r.update,
    finish(_c, out) {
      if (el) out.ops.push({ op: 'show', el });
    },
  };
}

/** Borders: the pen clicks each corner. */
function lineAction(piece: Piece | null, ctx: ActionCtx): Action {
  const { rng, speed } = ctx;
  const r0 = ctx.rect;
  const corner = (r: Rect, i: number): Pt =>
    [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }][i % 4];
  let placed = 0;
  let closed = false;
  const o: { ov: Overlay } = { ov: null };
  const steps: Step[] = [
    shape('pen-add'),
    click(speed, () => {
      placed = 1;
      o.ov = (st) => {
        const pts: Pt[] = [];
        for (let i = 0; i < placed; i++) pts.push(corner(st.c.rect, i));
        return [{ t: 'pen', pts, tail: closed ? undefined : { x: st.cur.x, y: st.cur.y }, closed }];
      };
    }),
    shape('pen'),
  ];
  for (let i = 1; i <= 4; i++) {
    steps.push(
      move(rng, corner(r0, i - 1), (s) => corner(s.c.rect, i), corner(r0, i), speed, { bend: rand(rng, -0.03, 0.03) }),
      click(speed, () => {
        if (i < 4) placed = i + 1;
        else closed = true;
      }),
      wait(rand(rng, 0.04, 0.12), speed),
    );
  }
  const away = { x: rand(rng, 14, 30), y: rand(rng, 10, 24) };
  steps.push(
    move(rng, corner(r0, 0), (s) => ({ x: corner(s.c.rect, 0).x + away.x, y: corner(s.c.rect, 0).y + away.y }), { x: r0.x + away.x, y: r0.y + away.y }, speed, { speed: 1.4 }),
    wait(0.3, speed, (s) => {
      s.cur.shape = 'arrow';
      fade(piece?.el ?? null, 180, 'line')(s);
    }),
  );
  const r = runner(steps, o);
  return {
    start: corner(r0, 0),
    shape: 'pen-add',
    duration: r.duration,
    update: r.update,
    finish(_c, out) {
      if (piece) out.ops.push({ op: 'show', el: piece.el });
    },
  };
}

const GROW_STEPS = [24, 32, 40, 48, 56, 64, 72, 88, 104];
const SNAP_PX = 9;

/** Text: click or drag a text box, type, grow headings, snap to a guide. */
function textAction(piece: Piece | null, ctx: ActionCtx): Action {
  const { rng, speed, effects } = ctx;
  const r0 = linesBox(ctx.lines, ctx.rect);
  // boxed text drags from the panel corner
  const start = piece?.boxed && effects.typing ? { x: ctx.rect.x, y: ctx.rect.y } : { x: r0.x, y: r0.y };
  if (!piece || !effects.typing) {
    const steps = [shape('arrow'), wait(0.3, speed, fade(piece?.el ?? null, 220, 'text'))];
    const r = runner(steps, { ov: null });
    return { start, shape: 'arrow', duration: r.duration, update: r.update, finish() {} };
  }
  const el = piece.el;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || ' ';
  const fs = piece.fs ?? 16;
  const boxed = !!piece.boxed;
  const lineH = boxed ? ctx.rect.h : Math.min(r0.h, ctx.lines[0]?.h ?? r0.h);
  const x: Xf = { dx: 0, dy: 0, s: 1 };
  const grow = effects.grow && fs >= 24;
  const snap = effects.snap && ctx.snapX !== undefined;
  const off = snap ? { x: rand(rng, 28, 64), y: rand(rng, -8, 8) } : { x: 0, y: 0 };
  const scale0 = grow ? Math.min(1, 18 / fs) : 1;
  const o: { ov: Overlay } = { ov: null };
  const bounds = (s: St) => base(boxed ? s.c.rect : linesBox(s.c.lines, s.c.rect), { dx: 0, dy: 0, s: 1 });
  const small = r0.w < 140 && ctx.lines.length <= 1;
  const steps: Step[] = [shape('cross')];

  if (small) steps.push(click(speed));
  else {
    const p0 = boxed ? ctx.rect : r0;
    let ghost: Rect = { x: p0.x, y: p0.y, w: 0, h: 0 };
    steps.push(
      click(speed, () => {
        o.ov = () => [{ t: 'sel', r: ghost, handles: true, badge: effects.sizeBadge ? size(ghost) : undefined, rulerLines: true }];
      }),
      move(rng, start, (s) => ({ x: s.c.rect.x + p0.w, y: s.c.rect.y + lineH }), { x: p0.x + p0.w, y: p0.y + lineH }, speed, {
        speed: 0.9,
        drag: true,
        bend: 0,
        onStep(s) {
          s.cur.press = 1;
          ghost = { x: s.c.rect.x, y: s.c.rect.y, w: Math.max(0, s.cur.x - s.c.rect.x), h: Math.max(0, s.cur.y - s.c.rect.y) };
        },
      }),
    );
  }

  const nudge = { x: rand(rng, -30, 10), y: rand(rng, 10, 30) };
  steps.push(
    {
      d: 0,
      enter(s) {
        s.cur.shape = 'ibeam';
        o.ov = (st) => [{ t: 'sel', r: bounds(st) }];
        if (scale0 !== 1 || off.x || off.y) setXf(s, el, x, off.x, off.y, scale0);
        s.out.ops.push({ op: 'clip', el, lines: [], progress: 0, rtl: piece.rtl, elRect: s.c.rect, box: boxed });
      },
    },
    move(rng, { x: r0.x + r0.w, y: r0.y + lineH }, (s) => ({ x: s.from.x + nudge.x, y: s.from.y + nudge.y }), { x: r0.x + r0.w + nudge.x, y: r0.y + lineH + nudge.y }, speed, { speed: 1.5 }),
    typing(el, text, piece.rtl, rng, speed, x, undefined, boxed),
    wait(0.12, speed),
    {
      d: 0,
      enter(s) {
        s.out.ops.push({ op: 'unclip', el }, { op: 'show', el });
        s.out.fx.push({ k: 'place', kind: 'text', r: s.c.rect });
        s.cur.shape = 'arrow';
        o.ov = (st) => [{ t: 'sel', r: bounds(st), handles: true }];
      },
    },
  );

  if (grow) {
    const sizes = [...GROW_STEPS.filter((v) => v < fs && v > 18), fs];
    sizes.forEach((v, i) => {
      steps.push(wait(0.06, speed, (s) => {
        setXf(s, el, x, x.dx, x.dy, v / fs);
        s.out.fx.push({ k: 'grow', step: i });
      }));
    });
    steps.push(wait(0.15, speed));
  }

  if (snap) {
    // drag onto the guide; snaps within 9px
    let flash = 0;
    let snapped = false;
    const grab = { x: Math.min(r0.w * 0.4, 60) + rand(rng, -6, 6), y: Math.min(r0.h * 0.5, 22) };
    const home = (s: St): Pt => {
      const b = base(s.c.rect, x);
      return { x: b.x + grab.x, y: b.y + grab.y };
    };
    const near = { x: -rand(rng, 2, 5), y: rand(rng, -3, 3) };
    const drag = (s: St) => {
      const h = home(s);
      let dx = s.cur.x - h.x;
      const dy = s.cur.y - h.y;
      if (Math.abs(dx) < SNAP_PX) {
        if (dx !== 0 && !snapped) {
          snapped = true;
          flash = 1;
          s.out.fx.push({ k: 'snap' });
        }
        dx = 0;
      }
      setXf(s, el, x, dx, dy, x.s);
    };
    const glow = (s: St): Deco[] =>
      flash > 0 && s.c.snapX !== undefined ? [{ t: 'guide', x: s.c.snapX, color: s.c.color, flash }] : [];
    steps.push(
      move(rng, { x: r0.x, y: r0.y }, (s) => ({ x: home(s).x + x.dx, y: home(s).y + x.dy }), { x: r0.x + off.x, y: r0.y + off.y }, speed),
      {
        d: 0,
        enter(s) {
          s.cur.press = 1;
          s.out.fx.push({ k: 'press' });
          const prev = o.ov;
          o.ov = (st) => [...(prev ? prev(st) : []), ...glow(st)];
        },
      },
      move(rng, { x: r0.x + off.x, y: r0.y }, (s) => ({ x: home(s).x + near.x, y: home(s).y + near.y }), { x: r0.x, y: r0.y }, speed, {
        speed: 0.6,
        drag: true,
        onStep: drag,
      }),
      wait(0.1, speed),
      move(rng, { x: r0.x, y: r0.y }, home, { x: r0.x, y: r0.y }, speed, { speed: 2, onStep: drag }),
      {
        d: 0.25 / speed,
        enter: (s) => setXf(s, el, x, 0, 0, 1),
        run: (k) => void (flash = 1 - k),
      },
    );
  } else steps.push(wait(0.2, speed));

  const r = runner(steps, o);
  return {
    start,
    shape: 'cross',
    duration: r.duration,
    update: r.update,
    finish(_c, out) {
      out.ops.push({ op: 'unclip', el }, { op: 'show', el }, { op: 'xform', el, dx: 0, dy: 0, s: 1 });
    },
  };
}

/** Guides: drag a guide out of the ruler. */
function guideAction(ctx: ActionCtx): Action {
  const { rng, speed } = ctx;
  const ry = ctx.viewport.h * (0.45 + rand(rng, -0.15, 0.15));
  const start = { x: 10, y: ry };
  const gx0 = ctx.guideX ?? 0;
  let dragging = false;
  const o: { ov: Overlay } = {
    ov: (s) => (dragging ? [{ t: 'guide', x: s.cur.x, color: s.c.color, drag: true }] : []),
  };
  const steps: Step[] = [
    shape('arrow'),
    wait(0.3, speed),
    {
      d: 0,
      enter(s) {
        s.cur.press = 1;
        s.out.fx.push({ k: 'press' });
        s.cur.shape = 'ew';
        dragging = true;
      },
    },
    move(rng, start, (s) => ({ x: s.c.guideX ?? gx0, y: ry + 40 }), { x: gx0, y: ry + 40 }, speed, { speed: 0.55, drag: true }),
    wait(0.25, speed, (s) => {
      dragging = false;
      s.cur.shape = 'arrow';
      s.out.fx.push({ k: 'place', kind: 'guide', r: { x: s.cur.x, y: s.cur.y, w: 1, h: 1 } });
    }),
  ];
  const r = runner(steps, o);
  return { start, shape: 'arrow', duration: r.duration, rulers: true, update: r.update, finish() {} };
}

/** Duplicates: alt-drag a copy of the original, retype it if its text differs. */
function dupAction(piece: Piece | null, ctx: ActionCtx): Action {
  const { rng, speed } = ctx;
  const o0 = ctx.origRect ?? ctx.rect;
  const d0 = ctx.rect;
  const grab = { x: Math.min(o0.w * 0.45, 70) + rand(rng, -8, 8), y: Math.min(o0.h * 0.45, 30) + rand(rng, -4, 4) };
  const start = { x: o0.x + grab.x, y: o0.y + grab.y };
  const x: Xf = { dx: 0, dy: 0, s: 1 };
  const el = piece?.el ?? null;
  const orig = (s: St) => s.c.origRect ?? s.c.rect;
  const copy = (s: St) => base(s.c.rect, x);
  const o: { ov: Overlay } = { ov: null };
  const steps: Step[] = [
    shape('arrow'),
    click(speed, () => {
      o.ov = (s) => [{ t: 'sel', r: orig(s), handles: true, badge: s.c.effects.sizeBadge ? size(orig(s)) : undefined }];
    }),
    wait(rand(rng, 0.15, 0.3), speed),
    shape('dup'),
    wait(0.12, speed),
    {
      d: 0,
      enter(s) {
        s.cur.press = 1;
        s.out.fx.push({ k: 'press' });
        if (el) {
          const a = orig(s);
          const b = copy(s);
          s.out.ops.push({ op: 'show', el });
          setXf(s, el, x, a.x - b.x, a.y - b.y, 1);
        }
        o.ov = (st) => {
          const a = orig(st);
          const now = st.c.rect;
          const sp = spacing(a, now);
          return [{ t: 'sel', r: a, red: true }, { t: 'sel', r: now, red: true }, ...(sp ? [sp] : [])];
        };
      },
    },
    move(rng, start, (s) => {
      const a = orig(s);
      const b = copy(s);
      return { x: a.x + grab.x + (b.x - a.x), y: a.y + grab.y + (b.y - a.y) };
    }, { x: d0.x + grab.x, y: d0.y + grab.y }, speed, {
      speed: 0.6,
      drag: true,
      onStep(s) {
        s.cur.press = 1;
        if (!el) return;
        const a = orig(s);
        const b = copy(s);
        const g = { x: a.x + grab.x, y: a.y + grab.y };
        setXf(s, el, x, a.x - b.x + (s.cur.x - g.x), a.y - b.y + (s.cur.y - g.y), 1);
      },
    }),
    {
      d: 0.1 / speed,
      enter(s) {
        if (el) setXf(s, el, x, 0, 0, 1);
        s.out.fx.push({ k: 'place', kind: 'dup', r: s.c.rect });
        s.cur.shape = 'arrow';
        o.ov = (st) => [{ t: 'sel', r: st.c.rect, handles: true, badge: st.c.effects.sizeBadge ? size(st.c.rect) : undefined }];
      },
    },
    wait(0.35, speed),
  ];

  // different text: select all and retype
  const own = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (el && piece?.kind === 'text' && ctx.effects.typing && ctx.origText !== undefined && own && own !== ctx.origText.trim()) {
    const at = { x: Math.min(d0.w * 0.5, 50) + rand(rng, -5, 5), y: Math.min(d0.h, 20) * 0.55 };
    let hl = false;
    steps.push(
      move(rng, start, (s) => ({ x: s.c.rect.x + at.x, y: s.c.rect.y + at.y }), { x: d0.x + at.x, y: d0.y + at.y }, speed),
      click(speed),
      wait(0.08, speed),
      click(speed, (s) => {
        hl = true;
        s.cur.shape = 'ibeam';
        o.ov = (st) => [{ t: 'sel', r: st.c.rect }, ...(hl ? [{ t: 'hilite', r: linesBox(st.c.lines, st.c.rect) } as Deco] : [])];
      }),
      wait(rand(rng, 0.2, 0.35), speed, () => void (hl = false)),
      typing(el, own, piece.rtl, rng, speed, x),
      wait(0.12, speed, (s) => {
        s.out.ops.push({ op: 'unclip', el });
        s.cur.shape = 'arrow';
        o.ov = (st) => [{ t: 'sel', r: st.c.rect, handles: true }];
      }),
      wait(0.3, speed),
    );
  }

  const r = runner(steps, o);
  return {
    start,
    shape: 'arrow',
    duration: r.duration,
    update: r.update,
    finish(_c, out) {
      if (el) out.ops.push({ op: 'unclip', el }, { op: 'show', el }, { op: 'xform', el, dx: 0, dy: 0, s: 1 });
    },
  };
}

export function createAction(task: Task, piece: Piece | null, ctx: ActionCtx): Action {
  let a: Action;
  switch (task.type) {
    case 'box':
      a = boxAction(piece, ctx, false);
      break;
    case 'media':
      a = boxAction(piece, ctx, true);
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
    case 'guide':
      a = guideAction(ctx);
      break;
  }
  const inner = a.update;
  a.update = (t, c, cursor, out) => inner(clamp(t, 0, a.duration), c, cursor, out);
  return a;
}
