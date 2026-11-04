import { describe, expect, it } from 'vitest';
import { createScheduler } from '../../src/scheduler/buckets';
import type { Task, TaskGraph } from '../../src/types';

describe('scheduler perf', () => {
  it('1,000 picks over 5,000 tasks take < 5 ms', () => {
    const make = () => {
      const tasks: Task[] = [];
      for (let i = 0; i < 5000; i++) {
        tasks.push({ id: i, type: 'box', piece: null, y: (i % 100) * 100 + ((i * 37) % 100), x: 0, deps: [], dependents: [], pending: 0, state: 'ready' });
      }
      const g: TaskGraph = { tasks, pieceTask: new Map() };
      const s = createScheduler(g, 100);
      s.add(tasks.map((t) => t.id));
      return s;
    };
    const picks = (s: ReturnType<typeof make>) => {
      for (let i = 0; i < 1000; i++) s.pick((i * 97) % 10000, 0, 800);
    };
    picks(make()); // warm-up: the budget is for a JIT-warm scheduler, as in a running page
    const s = make();
    const t0 = performance.now();
    picks(s);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(s.size()).toBe(4000);
  });
});
