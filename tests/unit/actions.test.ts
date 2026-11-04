import { describe, expect, it } from 'vitest';
import { createAction, type ActionCtx } from '../../src/actions';
import { applyOps } from '../../src/reveal/reveal';
import { typingDelays } from '../../src/motion/timing';
import { createRng } from '../../src/motion/rng';
import type { Cursor, Deco, Piece, RevealOp, Task, TaskType } from '../../src/types';

const effects = { guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true };
const rect = { x: 100, y: 50, w: 200.4, h: 100.6 };

function el(text = '') {
  return { textContent: text } as unknown as Element;
}
function piece(kind: Piece['kind'], text = '', over: Partial<Piece> = {}): Piece {
  return { id: 1, el: el(text), kind, rect, parent: null, sig: 's', textLen: text.length, rtl: false, ...over };
}
function task(type: TaskType): Task {
  return { id: 1, type, piece: 1, y: 0, x: 0, deps: [], dependents: [], pending: 0, state: 'active' };
}
function ctx(over: Partial<ActionCtx> = {}): ActionCtx {
  return { rect, lines: [], viewport: { w: 1000, h: 800 }, rng: createRng(7), speed: 1, effects, color: '#f00', ...over };
}
function cursor(): Cursor {
  return {
    id: 0, name: 'a', color: '#f00', x: 0, y: 0, sx: { x: 0, v: 0 }, sy: { x: 0, v: 0 },
    shape: 'arrow', press: 0, task: 1, phase: 'work', idleFor: 0, seedPhase: 0, alpha: 1,
  };
}
function run(a: ReturnType<typeof createAction>, t: number, c: ActionCtx, cur = cursor()) {
  const out = { decos: [] as Deco[], ops: [] as RevealOp[] };
  a.update(t, c, cur, out);
  return { out, cur };
}

describe('box', () => {
  it('starts at top-left with cross shape', () => {
    const a = createAction(task('box'), piece('box'), ctx());
    expect(a.start).toEqual({ x: 100, y: 50 });
    expect(a.shape).toBe('cross');
    expect(a.duration).toBeCloseTo(0.55);
  });
  it('halfway drag gives about half-size outline and integer badge', () => {
    const c = ctx();
    const a = createAction(task('box'), piece('box'), c);
    const { out, cur } = run(a, 0.275, c);
    const o = out.decos.find((d) => d.t === 'outline') as Extract<Deco, { t: 'outline' }>;
    expect(o.r.w).toBeCloseTo(rect.w / 2, 1);
    expect(o.r.h).toBeCloseTo(rect.h / 2, 1);
    expect(o.color).toBe('#f00');
    const b = out.decos.find((d) => d.t === 'badge') as Extract<Deco, { t: 'badge' }>;
    expect(b.text).toBe(`${Math.round(o.r.w)}×${Math.round(o.r.h)}`);
    expect(b.text).toMatch(/^\d+×\d+$/);
    expect(cur.x).toBeCloseTo(100 + rect.w / 2, 1);
    expect(cur.press).toBe(1);
  });
  it('no badge without sizeBadge', () => {
    const c = ctx({ effects: { ...effects, sizeBadge: false } });
    const { out } = run(createAction(task('box'), piece('box'), c), 0.2, c);
    expect(out.decos.some((d) => d.t === 'badge')).toBe(false);
  });
  it('finish fades 180ms', () => {
    const p = piece('box');
    const out = { ops: [] as RevealOp[] };
    createAction(task('box'), p, ctx()).finish(ctx(), out);
    expect(out.ops).toEqual([{ op: 'fade', el: p.el, ms: 180 }]);
  });
  it('speed 2 halves duration; t clamps', () => {
    const c = ctx({ speed: 2 });
    const a = createAction(task('box'), piece('box'), c);
    expect(a.duration).toBeCloseTo(0.275);
    const { out } = run(a, 99, c);
    const o = out.decos.find((d) => d.t === 'outline') as Extract<Deco, { t: 'outline' }>;
    expect(o.r.w).toBeCloseTo(rect.w);
  });
});

describe('media', () => {
  it('uses media deco and fade 260', () => {
    const c = ctx();
    const p = piece('media');
    const a = createAction(task('media'), p, c);
    const { out } = run(a, 0.3, c);
    expect(out.decos.some((d) => d.t === 'media')).toBe(true);
    expect(out.decos.some((d) => d.t === 'outline')).toBe(false);
    const o = { ops: [] as RevealOp[] };
    a.finish(c, o);
    expect(o.ops).toEqual([{ op: 'fade', el: p.el, ms: 260 }]);
  });
});

describe('line', () => {
  it('traces the perimeter with a pen', () => {
    const c = ctx();
    const a = createAction(task('line'), piece('line'), c);
    expect(a.shape).toBe('pen');
    expect(a.duration).toBeCloseTo(0.7);
    const end = run(a, 0.7, c);
    const path = end.out.decos.find((d) => d.t === 'path') as Extract<Deco, { t: 'path' }>;
    expect(path.pts[0]).toEqual({ x: 100, y: 50 });
    expect(path.pts.length).toBeGreaterThanOrEqual(5);
    const last = path.pts[path.pts.length - 1];
    expect(last.x).toBeCloseTo(100);
    expect(last.y).toBeCloseTo(50);
    const early = run(a, 0.01, c);
    const p2 = early.out.decos.find((d) => d.t === 'path') as Extract<Deco, { t: 'path' }>;
    expect(p2.pts.length).toBe(2);
    const o = { ops: [] as RevealOp[] };
    a.finish(c, o);
    expect(o.ops[0]).toMatchObject({ op: 'fade', ms: 180 });
  });
});

describe('text', () => {
  const lines = [
    { x: 100, y: 50, w: 100, h: 20 },
    { x: 100, y: 70, w: 100, h: 20 },
  ];
  it('duration equals summed typing delays and keystrokes accumulate', () => {
    const c = ctx({ lines });
    const a = createAction(task('text'), piece('text', 'Hello world'), c);
    const sum = typingDelays('Hello world', createRng(7), 1).reduce((x, y) => x + y, 0);
    expect(a.duration).toBeCloseTo(sum / 1000, 9);
    expect(a.shape).toBe('ibeam');
    expect(a.keystrokes!.length).toBe(11);
    expect(a.keystrokes![10]).toBeCloseTo(a.duration, 9);
  });
  it('clip progress is monotonic 0 to 1, elRect set, caret present', () => {
    const c = ctx({ lines });
    const a = createAction(task('text'), piece('text', 'Hello world'), c);
    const ps: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const { out } = run(a, (a.duration * i) / 20, c);
      const clip = out.ops.find((o) => o.op === 'clip') as Extract<RevealOp, { op: 'clip' }>;
      expect(clip.elRect).toEqual(rect);
      expect(out.decos.some((d) => d.t === 'caret')).toBe(true);
      ps.push(clip.progress);
    }
    expect(ps[0]).toBe(0);
    expect(ps[20]).toBe(1);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
  });
  it('caret follows width distribution across lines', () => {
    const c = ctx({ lines });
    const a = createAction(task('text'), piece('text', 'Hello world'), c);
    const { out } = run(a, a.duration, c);
    const caret = out.decos.find((d) => d.t === 'caret') as Extract<Deco, { t: 'caret' }>;
    expect(caret.x).toBeCloseTo(200);
    expect(caret.y).toBe(70);
    expect(caret.h).toBe(20);
  });
  it('rtl is passed through and caret mirrors', () => {
    const c = ctx({ lines });
    const a = createAction(task('text'), piece('text', 'Hello world', { rtl: true }), c);
    const { out } = run(a, a.duration * 0.25, c);
    const clip = out.ops.find((o) => o.op === 'clip') as Extract<RevealOp, { op: 'clip' }>;
    expect(clip.rtl).toBe(true);
    const caret = out.decos.find((d) => d.t === 'caret') as Extract<Deco, { t: 'caret' }>;
    expect(caret.x).toBeLessThan(200);
    expect(caret.x).toBeGreaterThan(100);
  });
  it('finish unclips and shows', () => {
    const p = piece('text', 'Hi');
    const o = { ops: [] as RevealOp[] };
    createAction(task('text'), p, ctx({ lines })).finish(ctx(), o);
    expect(o.ops).toEqual([{ op: 'unclip', el: p.el }, { op: 'show', el: p.el }]);
  });
  it('typing:false emits no clip ops, 0.3s arrow, fade 220', () => {
    const c = ctx({ lines, effects: { ...effects, typing: false } });
    const p = piece('text', 'Hello');
    const a = createAction(task('text'), p, c);
    expect(a.shape).toBe('arrow');
    expect(a.duration).toBeCloseTo(0.3);
    const { out } = run(a, 0.15, c);
    expect(out.ops.some((o) => o.op === 'clip')).toBe(false);
    const o = { ops: [] as RevealOp[] };
    a.finish(c, o);
    expect(o.ops).toEqual([{ op: 'fade', el: p.el, ms: 220 }]);
  });
  it('very long text caps duration at 6s (and 6s/speed)', () => {
    const long = 'Lorem, ipsum. dolor; sit: amet! '.repeat(200);
    const a = createAction(task('text'), piece('text', long, { textLen: 5000 }), ctx({ lines }));
    expect(a.duration).toBeLessThanOrEqual(6);
    const b = createAction(task('text'), piece('text', long, { textLen: 5000 }), ctx({ lines, speed: 2 }));
    expect(b.duration).toBeLessThanOrEqual(3);
    expect(a.keystrokes!.length).toBeLessThanOrEqual(120);
  });
});

describe('dup', () => {
  const orig = { x: 10, y: 20, w: 40, h: 20 };
  it('starts at orig center and moves ghost to rect', () => {
    const c = ctx({ origRect: orig });
    const a = createAction(task('dup'), piece('box'), c);
    expect(a.start).toEqual({ x: 30, y: 30 });
    expect(a.shape).toBe('dup');
    expect(a.duration).toBeCloseTo(0.6);
    const { out, cur } = run(a, 0.6, c);
    const g = out.decos.find((d) => d.t === 'ghost') as Extract<Deco, { t: 'ghost' }>;
    expect(g.r).toEqual(rect);
    expect(cur.x).toBeCloseTo(rect.x + rect.w / 2);
    expect(cur.y).toBeCloseTo(rect.y + rect.h / 2);
    const p = piece('box');
    const o = { ops: [] as RevealOp[] };
    createAction(task('dup'), p, c).finish(c, o);
    expect(o.ops).toEqual([{ op: 'fade', el: p.el, ms: 160 }]);
  });
});

describe('guide', () => {
  it('drags the cursor down and emits guide deco; finish has no ops', () => {
    const c = ctx({ guideX: 333 });
    const a = createAction(task('guide'), null, c);
    expect(a.start).toEqual({ x: 333, y: 0 });
    expect(a.shape).toBe('arrow');
    expect(a.duration).toBeCloseTo(0.4);
    const { out, cur } = run(a, 0.4, c);
    expect(out.decos).toEqual([{ t: 'guide', x: 333, color: '#f00' }]);
    expect(cur.x).toBe(333);
    expect(cur.y).toBeCloseTo(400);
    const o = { ops: [] as RevealOp[] };
    a.finish(c, o);
    expect(o.ops).toEqual([]);
  });
});

describe('applyOps elRect (R14)', () => {
  it('does not call getBoundingClientRect when elRect is given', () => {
    const el = {
      style: { clipPath: '' },
      setAttribute() {},
      getBoundingClientRect() {
        throw new Error('layout read');
      },
    } as unknown as Element;
    const r = { x: 0, y: 0, w: 100, h: 20 };
    applyOps([{ op: 'clip', el, lines: [r], progress: 0.5, rtl: false, elRect: r }]);
    expect((el as unknown as HTMLElement).style.clipPath).toContain('polygon');
  });
});
