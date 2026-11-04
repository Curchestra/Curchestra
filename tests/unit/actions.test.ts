import { describe, expect, it } from 'vitest';
import { createAction, typingTimeline, type Action, type ActionCtx } from '../../src/actions';
import { createRng } from '../../src/motion/rng';
import type { Cursor, CursorShape, Deco, Fx, Piece, RevealOp, Task, TaskType } from '../../src/types';

const effects = { guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true, rulers: true, snap: true, grow: true };
const rect = { x: 100, y: 50, w: 200.4, h: 100.6 };

const el = (text = '') => ({ textContent: text }) as unknown as Element;
function piece(kind: Piece['kind'], text = '', over: Partial<Piece> = {}): Piece {
  return { id: 1, el: el(text), kind, rect, parent: null, sig: 's', textLen: text.length, rtl: false, ...over };
}
const task = (type: TaskType): Task => ({ id: 1, type, piece: 1, y: 0, x: 0, deps: [], dependents: [], pending: 0, state: 'active' });
const ctx = (over: Partial<ActionCtx> = {}): ActionCtx => ({
  rect, lines: [], viewport: { w: 1000, h: 800 }, rng: createRng(7), speed: 1, effects, color: '#f00', ...over,
});
const cursor = (): Cursor => ({
  id: 0, name: 'a', color: '#f00', x: 0, y: 0, sx: { x: 0, v: 0 }, sy: { x: 0, v: 0 },
  shape: 'arrow', press: 0, angle: 0, task: 1, phase: 'work', idleFor: 0, seedPhase: 0, alpha: 1,
});

interface Frame {
  t: number;
  x: number;
  y: number;
  shape: CursorShape;
  decos: Deco[];
  ops: RevealOp[];
  fx: Fx[];
}

/** Play an action frame by frame (60 fps) from its start point, then finish it. */
function play(a: Action, c: ActionCtx) {
  const cur = cursor();
  cur.x = a.start.x;
  cur.y = a.start.y;
  cur.shape = a.shape;
  const frames: Frame[] = [];
  for (let t = 0; ; t += 1 / 60) {
    const out = { decos: [] as Deco[], ops: [] as RevealOp[], fx: [] as Fx[] };
    a.update(Math.min(t, a.duration), c, cur, out);
    frames.push({ t, x: cur.x, y: cur.y, shape: cur.shape, ...out });
    if (t >= a.duration) break;
  }
  const end = { decos: [] as Deco[], ops: [] as RevealOp[], fx: [] as Fx[] };
  a.finish(c, end);
  const all = <K extends 'decos' | 'ops' | 'fx'>(k: K) => frames.flatMap((f) => f[k]) as Frame[K];
  return { frames, end, ops: all('ops'), fx: all('fx'), decos: all('decos'), shapes: new Set(frames.map((f) => f.shape)) };
}

const sels = (ds: Deco[]) => ds.filter((d): d is Extract<Deco, { t: 'sel' }> => d.t === 'sel');

describe('box', () => {
  it('crosshair drag-out from the top-left: press, selection with handles and a size badge, dashed ruler lines', () => {
    const a = createAction(task('box'), piece('box'), ctx());
    expect(a.start).toEqual({ x: 100, y: 50 });
    expect(a.shape).toBe('cross');
    const p = play(a, ctx());
    expect(p.fx[0]).toEqual({ k: 'press' });
    const mid = p.frames.find((f) => sels(f.decos).some((s) => s.r.w > 60 && s.r.w < 140))!;
    const s = sels(mid.decos)[0];
    expect(s.handles).toBe(true);
    expect(s.rulerLines).toBe(true);
    expect(s.badge).toBe(`${Math.round(s.r.w)} × ${Math.round(s.r.h)}`);
    // the cursor is the drag handle: it sits at the box's bottom-right while dragging
    expect(mid.x).toBeCloseTo(s.r.x + s.r.w, 5);
  });

  it('the real element appears after the drag (fade 180) with one place note; arrow afterwards', () => {
    const p = play(createAction(task('box'), piece('box'), ctx()), ctx());
    const fades = p.ops.filter((o) => o.op === 'fade');
    expect(fades).toHaveLength(1);
    expect(fades[0]).toMatchObject({ ms: 180 });
    expect(p.fx.filter((f) => f.k === 'place')).toEqual([{ k: 'place', kind: 'box', r: rect }]);
    expect(p.frames[p.frames.length - 1].shape).toBe('arrow');
    expect(p.end.ops).toEqual([{ op: 'show', el: expect.anything() }]);
  });

  it('no badge without sizeBadge', () => {
    const c = ctx({ effects: { ...effects, sizeBadge: false } });
    const p = play(createAction(task('box'), piece('box'), c), c);
    expect(sels(p.decos).every((s) => s.badge === undefined)).toBe(true);
  });

  it('a box bigger than the screen: the drag stops short of the edge, then the box grows to size', () => {
    const big = { x: 100, y: 100, w: 2000, h: 1500 };
    const c = ctx({ rect: big });
    const p = play(createAction(task('box'), piece('box'), c), c);
    expect(Math.max(...p.frames.map((f) => f.x))).toBeLessThanOrEqual(1000);
    const widest = Math.max(...sels(p.decos).map((s) => s.r.w));
    expect(widest).toBeCloseTo(2000, 0);
  });

  it('speed 2 roughly halves the routine', () => {
    const one = createAction(task('box'), piece('box'), ctx());
    const two = createAction(task('box'), piece('box'), ctx({ speed: 2 }));
    expect(two.duration).toBeLessThan(one.duration * 0.6);
    expect(two.duration).toBeGreaterThan(one.duration * 0.4);
  });

  it('images: a gray placeholder while dragging, fade 260, a media note', () => {
    const p = play(createAction(task('media'), piece('media'), ctx()), ctx());
    expect(p.decos.some((d) => d.t === 'media')).toBe(true);
    expect(p.ops.find((o) => o.op === 'fade')).toMatchObject({ ms: 260 });
    expect(p.fx.find((f) => f.k === 'place')).toMatchObject({ kind: 'media' });
  });
});

describe('line (borders)', () => {
  it('pen-add clicks the first corner, the pen clicks each corner, leaving vertices, then the path closes', () => {
    const a = createAction(task('line'), piece('line'), ctx());
    expect(a.shape).toBe('pen-add');
    const p = play(a, ctx());
    expect(p.shapes.has('pen-add')).toBe(true);
    expect(p.shapes.has('pen')).toBe(true);
    expect(p.fx.filter((f) => f.k === 'press')).toHaveLength(5);
    const pens = p.decos.filter((d): d is Extract<Deco, { t: 'pen' }> => d.t === 'pen');
    expect(Math.max(...pens.map((d) => d.pts.length))).toBe(4);
    expect(pens.some((d) => d.closed)).toBe(true);
    expect(p.ops.filter((o) => o.op === 'fade')).toHaveLength(1);
    expect(p.fx.find((f) => f.k === 'place')).toMatchObject({ kind: 'line' });
  });
});

describe('text', () => {
  const lines = [{ x: 100, y: 50, w: 200, h: 20 }];

  it('short text: a click, then the I-beam types it with key fx for every character', () => {
    const c = ctx({ lines, rect: { x: 100, y: 50, w: 100, h: 20 } });
    const p = play(createAction(task('text'), piece('text', 'Hello there'), c), c);
    expect(p.fx[0]).toEqual({ k: 'press' });
    expect(p.shapes.has('ibeam')).toBe(true);
    const keys = p.fx.filter((f): f is Extract<Fx, { k: 'key' }> => f.k === 'key');
    expect(keys.reduce((n, f) => n + f.n, 0)).toBe('Hello there'.length);
    expect(keys.some((f) => f.space)).toBe(true);
    const clips = p.ops.filter((o): o is Extract<RevealOp, { op: 'clip' }> => o.op === 'clip').map((o) => o.progress);
    for (let i = 1; i < clips.length; i++) expect(clips[i]).toBeGreaterThanOrEqual(clips[i - 1]);
    expect(clips[0]).toBe(0);
    expect(clips[clips.length - 1]).toBe(1);
    expect(p.decos.some((d) => d.t === 'caret')).toBe(true);
    expect(p.end.ops.map((o) => o.op)).toEqual(['unclip', 'show', 'xform']);
  });

  it('a wide text block: drag out a text box with handles and a size badge first', () => {
    const wide = { x: 100, y: 50, w: 420, h: 60 };
    const c = ctx({ rect: wide, lines: [{ ...wide, h: 20 }, { x: 100, y: 70, w: 400, h: 20 }] });
    const p = play(createAction(task('text'), piece('text', 'A longer paragraph of words'), c), c);
    const boxes = sels(p.decos).filter((s) => s.handles && s.badge);
    expect(boxes.length).toBeGreaterThan(0);
    expect(Math.max(...boxes.map((s) => s.r.w))).toBeCloseTo(420, 0);
  });

  it('rtl text is clipped from the right', () => {
    const c = ctx({ lines, rect: { x: 100, y: 50, w: 100, h: 20 } });
    const p = play(createAction(task('text'), piece('text', 'שלום', { rtl: true }), c), c);
    expect(p.ops.some((o) => o.op === 'clip' && o.rtl)).toBe(true);
  });

  it('headings are typed small and grow to size in steps, with grow fx', () => {
    const c = ctx({ lines, rect: { x: 100, y: 50, w: 100, h: 60 } });
    const p = play(createAction(task('text'), piece('text', 'Title', { fs: 48 }), c), c);
    const scales = p.ops.filter((o): o is Extract<RevealOp, { op: 'xform' }> => o.op === 'xform').map((o) => o.s);
    expect(scales[0]).toBeCloseTo(18 / 48, 3);
    expect(scales).toContain(24 / 48);
    expect(scales[scales.length - 1]).toBe(1);
    expect(p.fx.filter((f) => f.k === 'grow').length).toBe([24, 32, 40].length + 1);
  });

  it('text on a guide starts off it, is dragged on, snaps once with a red flash', () => {
    const c = ctx({ lines, rect: { x: 100, y: 50, w: 100, h: 20 }, snapX: 100 });
    const p = play(createAction(task('text'), piece('text', 'Snap me'), c), c);
    const xf = p.ops.filter((o): o is Extract<RevealOp, { op: 'xform' }> => o.op === 'xform');
    expect(xf[0].dx).toBeGreaterThanOrEqual(28);
    expect(xf[xf.length - 1]).toMatchObject({ dx: 0, dy: 0, s: 1 });
    expect(p.fx.filter((f) => f.k === 'snap')).toHaveLength(1);
    expect(p.decos.some((d) => d.t === 'guide' && (d.flash ?? 0) > 0)).toBe(true);
  });

  it('typing:false just fades the text in', () => {
    const c = ctx({ effects: { ...effects, typing: false } });
    const p = play(createAction(task('text'), piece('text', 'hi'), c), c);
    expect(p.ops.some((o) => o.op === 'clip')).toBe(false);
    expect(p.ops.find((o) => o.op === 'fade')).toMatchObject({ ms: 220 });
  });
});

describe('typingTimeline', () => {
  it('is deterministic and long texts type proportionally faster per character', () => {
    const a = typingTimeline('hello world', createRng(1), 1);
    expect(a).toEqual(typingTimeline('hello world', createRng(1), 1));
    const short = typingTimeline('x'.repeat(20), createRng(2), 1);
    const long = typingTimeline('x'.repeat(400), createRng(2), 1);
    expect(long[long.length - 1] / 400).toBeLessThan(short[short.length - 1] / 20);
    expect(long[long.length - 1]).toBeLessThan(4);
  });
});

describe('guide', () => {
  it('needs the rulers, grabs the ruler with the resize cursor and drags the guide out', () => {
    const c = ctx({ guideX: 420 });
    const a = createAction({ ...task('guide'), piece: null }, null, c);
    expect(a.rulers).toBe(true);
    expect(a.start.x).toBe(10);
    const p = play(a, c);
    expect(p.shapes.has('ew')).toBe(true);
    expect(p.decos.some((d) => d.t === 'guide' && d.drag)).toBe(true);
    expect(p.frames[p.frames.length - 1].x).toBeCloseTo(420, 3);
    expect(p.fx.find((f) => f.k === 'place')).toMatchObject({ kind: 'guide' });
    expect(p.ops).toEqual([]);
  });
});

describe('dup', () => {
  const orig = { x: 100, y: 50, w: 120, h: 40 };
  const copyR = { x: 260, y: 50, w: 120, h: 40 };

  it('selects the original, alt-drags the real copy over with red boxes and the spacing, then lands it', () => {
    const c = ctx({ rect: copyR, origRect: orig });
    const a = createAction(task('dup'), piece('box'), c);
    expect(a.start.x).toBeGreaterThan(orig.x);
    expect(a.start.x).toBeLessThan(orig.x + orig.w);
    const p = play(a, c);
    expect(p.shapes.has('dup')).toBe(true);
    const xf = p.ops.filter((o): o is Extract<RevealOp, { op: 'xform' }> => o.op === 'xform');
    expect(xf[0].dx).toBeCloseTo(orig.x - copyR.x, 5);
    expect(xf[xf.length - 1]).toMatchObject({ dx: 0, dy: 0, s: 1 });
    expect(sels(p.decos).some((s) => s.red)).toBe(true);
    expect(p.decos.some((d) => d.t === 'measure')).toBe(true);
    expect(p.fx.find((f) => f.k === 'place')).toMatchObject({ kind: 'dup' });
  });

  it('a copied label with different words is selected and retyped', () => {
    const c = ctx({ rect: copyR, origRect: orig, origText: 'Product', lines: [{ ...copyR, h: 20 }] });
    const p = play(createAction(task('dup'), piece('text', 'Agents'), c), c);
    expect(p.decos.some((d) => d.t === 'hilite')).toBe(true);
    expect(p.fx.filter((f) => f.k === 'key').reduce((n, f) => n + (f as { n: number }).n, 0)).toBe('Agents'.length);
  });

  it('same words: no retype', () => {
    const c = ctx({ rect: copyR, origRect: orig, origText: 'Agents', lines: [{ ...copyR, h: 20 }] });
    const p = play(createAction(task('dup'), piece('text', 'Agents'), c), c);
    expect(p.decos.some((d) => d.t === 'hilite')).toBe(false);
    expect(p.fx.some((f) => f.k === 'key')).toBe(false);
  });
});
