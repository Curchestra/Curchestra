import { describe, expect, it } from 'vitest';
import { plan } from '../../src/planner/plan';
import type { Config, Piece } from '../../src/types';

const fx: Config['effects'] = { guides: true, duplicate: true, pen: true, sizeBadge: true, typing: true };

describe('planner perf', () => {
  it('2000-piece chain plans in < 20ms', () => {
    const ps: Piece[] = [];
    for (let i = 0; i < 2000; i++) {
      ps.push({ id: i, el: {} as Element, kind: 'box', rect: { x: 0, y: 0, w: 100, h: 50 }, parent: i ? i - 1 : null, sig: 's' + i, textLen: 0, rtl: false });
    }
    plan(ps, fx);
    const t0 = performance.now();
    const { graph } = plan(ps, fx);
    expect(performance.now() - t0).toBeLessThan(20);
    expect(graph.tasks).toHaveLength(2000);
  });
});
