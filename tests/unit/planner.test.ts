import { describe, expect, it } from 'vitest';
import { completeTask, plan } from '../../src/planner/plan';
import type { Config, Piece, PieceKind } from '../../src/types';

const fx = (o: Partial<Config['effects']> = {}): Config['effects'] => ({
  guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true, ...o,
});

let n = 0;
function mk(p: Partial<Piece> & { kind?: PieceKind }): Piece {
  return {
    id: n++, el: {} as Element, kind: 'box', rect: { x: 0, y: 0, w: 100, h: 50 },
    parent: null, sig: 's', textLen: 0, rtl: false, ...p,
  };
}
const reset = () => { n = 0; };

describe('plan', () => {
  it('child depends on parent', () => {
    reset();
    const a = mk({}); const b = mk({ parent: a.id, sig: 'x' });
    const { graph, ready } = plan([a, b], fx());
    const ta = graph.pieceTask.get(a.id)!; const tb = graph.pieceTask.get(b.id)!;
    expect(graph.tasks[tb].deps).toEqual([ta]);
    expect(graph.tasks[ta].dependents).toEqual([tb]);
    expect(graph.tasks[tb].pending).toBe(1);
    expect(ready).toEqual([ta]);
  });

  it('4 equal siblings give 1 box + 3 dups', () => {
    reset();
    const p = mk({ sig: 'p' });
    const kids = [0, 1, 2, 3].map((i) => mk({ parent: p.id, sig: 'card', rect: { x: i * 10, y: 0, w: 100, h: 50 } }));
    const { graph } = plan([p, ...kids], fx());
    const first = graph.pieceTask.get(kids[0].id)!;
    expect(graph.tasks[first].type).toBe('box');
    for (const k of kids.slice(1)) {
      const t = graph.tasks[graph.pieceTask.get(k.id)!];
      expect(t.type).toBe('dup');
      expect(t.original).toBe(first);
      expect(t.deps).toContain(first);
    }
  });

  it('no dups when duplicate effect off', () => {
    reset();
    const p = mk({ sig: 'p' });
    const kids = [0, 1, 2].map(() => mk({ parent: p.id, sig: 'card' }));
    const { graph } = plan([p, ...kids], fx({ duplicate: false }));
    expect(graph.tasks.some((t) => t.type === 'dup')).toBe(false);
  });

  it('30% wider sibling prevents dups', () => {
    reset();
    const p = mk({ sig: 'p' });
    const kids = [100, 100, 130].map((w) => mk({ parent: p.id, sig: 'card', rect: { x: 0, y: 0, w, h: 50 } }));
    const { graph } = plan([p, ...kids], fx());
    expect(graph.tasks.some((t) => t.type === 'dup')).toBe(false);
  });

  it('3 texts at same x get one guide they depend on', () => {
    reset();
    const ts = [0, 1, 2].map((i) => mk({ kind: 'text', sig: 't' + i, rect: { x: 100, y: 40 - i * 10, w: 50, h: 10 } }));
    const { graph, ready } = plan(ts, fx());
    const guides = graph.tasks.filter((t) => t.type === 'guide');
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ piece: null, x: 100, y: 20, deps: [] });
    for (const t of ts) expect(graph.tasks[graph.pieceTask.get(t.id)!].deps).toEqual([guides[0].id]);
    expect(ready).toEqual([guides[0].id]);
  });

  it('no guide when guides off', () => {
    reset();
    const ts = [0, 1, 2].map((i) => mk({ kind: 'text', sig: 't' + i, rect: { x: 100, y: i, w: 50, h: 10 } }));
    const { graph } = plan(ts, fx({ guides: false }));
    expect(graph.tasks.some((t) => t.type === 'guide')).toBe(false);
  });

  it('text dups do not count toward guides', () => {
    reset();
    const p = mk({ sig: 'p' });
    const ts = [0, 1, 2].map(() => mk({ parent: p.id, kind: 'text', sig: 'same', rect: { x: 100, y: 0, w: 50, h: 10 } }));
    const { graph } = plan([p, ...ts], fx());
    expect(graph.tasks.some((t) => t.type === 'guide')).toBe(false);
  });

  it('text depends on parent and guide, deduped', () => {
    reset();
    const p = mk({ sig: 'p' });
    const ts = [0, 1, 2].map((i) => mk({ parent: p.id, kind: 'text', sig: 't' + i, rect: { x: 100, y: i, w: 50, h: 10 } }));
    const { graph } = plan([p, ...ts], fx());
    const g = graph.tasks.find((t) => t.type === 'guide')!;
    const t0 = graph.tasks[graph.pieceTask.get(ts[0].id)!];
    expect(t0.deps.sort()).toEqual([graph.pieceTask.get(p.id)!, g.id].sort());
    expect(t0.pending).toBe(2);
  });

  it('pen off turns line into box', () => {
    reset();
    const l = mk({ kind: 'line' });
    expect(plan([l], fx()).graph.tasks[0].type).toBe('line');
    expect(plan([l], fx({ pen: false })).graph.tasks[0].type).toBe('box');
  });

  it('completeTask readies children only when all deps are done', () => {
    reset();
    const p = mk({ sig: 'p' });
    const ts = [0, 1, 2].map((i) => mk({ parent: p.id, kind: 'text', sig: 't' + i, rect: { x: 100, y: i, w: 50, h: 10 } }));
    const { graph, ready } = plan([p, ...ts], fx());
    const tp = graph.pieceTask.get(p.id)!;
    const g = graph.tasks.find((t) => t.type === 'guide')!.id;
    const texts = ts.map((t) => graph.pieceTask.get(t.id)!);
    expect(ready.sort()).toEqual([tp, g].sort());
    expect(completeTask(graph, tp)).toEqual([]);
    expect(graph.tasks[texts[0]].state).toBe('wait');
    expect(completeTask(graph, g).sort()).toEqual(texts.sort());
    expect(graph.tasks[texts[0]].state).toBe('ready');
  });
});
