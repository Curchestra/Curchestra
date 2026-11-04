import { describe, expect, it } from 'vitest';
import { createScheduler } from '../../src/scheduler/buckets';
import { crewTarget, tempoFor } from '../../src/scheduler/crew';
import type { Task, TaskGraph, TaskType } from '../../src/types';

function graphOf(specs: Array<[number, TaskType?]>): TaskGraph {
  const tasks: Task[] = specs.map(([y, type], id) => ({
    id,
    type: type ?? 'box',
    piece: null,
    y,
    x: 0,
    deps: [],
    dependents: [],
    pending: 0,
    state: 'ready',
  }));
  return { tasks, pieceTask: new Map() };
}
const ids = (g: TaskGraph) => g.tasks.map((t) => t.id);

describe('scheduler', () => {
  it('a zero band height (0 px tall viewport or iframe) still picks every task', () => {
    const g = graphOf([[0], [40], [300]]);
    const s = createScheduler(g, 0);
    s.add(ids(g));
    expect(s.inRange(0, 0, 0)).toBeGreaterThan(0);
    const got = [s.pick(0, 0, 0), s.pick(0, 0, 0), s.pick(0, 0, 0)];
    expect(got.sort()).toEqual([0, 1, 2]);
    expect(s.size()).toBe(0);
  });

  it('on screen builds top-down, leaning toward the cursor', () => {
    const g = graphOf([[50], [250], [450]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(260, 0, 1000)).toBe(0); // 50*0.6 + 210*0.4 = 114 beats 150 + 4 = 154
    expect(s.pick(260, 0, 1000)).toBe(1);
    expect(s.pick(260, 0, 1000)).toBe(2);
  });

  it('on screen stays top-down even with the cursor right next to a lower piece', () => {
    const g = graphOf([[300], [340]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(340, 0, 1000)).toBe(0);
  });

  it('nothing below the frontier (the furthest the visitor has seen) is picked', () => {
    const g = graphOf([[100], [900], [1500]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(100, 0, 800, 800)).toBe(0);
    expect(s.pick(100, 0, 800, 800)).toBeNull();
    // scrolled to 600..1400 then back up: 900 was seen, 1500 still was not
    expect(s.pick(100, 0, 800, 1400)).toBe(1);
    expect(s.pick(100, 0, 800, 1400)).toBeNull();
    expect(s.size()).toBe(1);
  });

  it('guide beats a closer box in the same band', () => {
    const g = graphOf([[205], [290, 'guide']]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(200, 0, 1000)).toBe(1);
  });

  it('on-screen beats off-screen in the same band', () => {
    const g = graphOf([[101], [160]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    // view starts at 150: task 1 on-screen, task 0 off-screen but closer to cursor
    expect(s.pick(100, 150, 1000)).toBe(1);
  });

  it('returns null on empty and never returns a task twice', () => {
    const g = graphOf([[10], [20]]);
    const s = createScheduler(g, 100);
    expect(s.pick(0, 0, 100)).toBeNull();
    s.add(ids(g));
    const a = s.pick(0, 0, 100);
    const b = s.pick(0, 0, 100);
    expect(new Set([a, b]).size).toBe(2);
    expect(s.pick(0, 0, 100)).toBeNull();
    expect(s.size()).toBe(0);
    expect(g.tasks[a!].state).toBe('active');
  });

  it('inRange counts only bands overlapping the margin-expanded view', () => {
    const g = graphOf([[50], [150], [550], [950]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.inRange(500, 600, 0)).toBe(1);
    expect(s.inRange(500, 600, 400)).toBe(3); // [100,1000] -> bands 1..10
    expect(s.size()).toBe(4);
  });

  it('work scrolled past comes before work below the view', () => {
    const g = graphOf([[-250], [5000]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(4000, 0, 100)).toBe(0);
    expect(s.pick(4000, 0, 100)).toBe(1);
  });
});

describe('crewTarget', () => {
  it('sizes from backlog and scroll speed, clamped', () => {
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 40, scrollSpeed: 0 })).toBe(19);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 0, scrollSpeed: 500 })).toBe(16);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 0, scrollSpeed: 3000 })).toBe(30);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 9999, scrollSpeed: 99999 })).toBe(30);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 0, scrollSpeed: 0 })).toBe(6);
  });
});

describe('tempoFor', () => {
  it('2.1 at rest, a little faster with scroll speed and work per cursor, capped at 3.2', () => {
    expect(tempoFor(0, 0, 6)).toBe(2.1);
    expect(tempoFor(900, 0, 6)).toBeCloseTo(2.6);
    expect(tempoFor(0, 12, 6)).toBeCloseTo(2.7);
    expect(tempoFor(99999, 999, 1)).toBe(3.2);
    expect(tempoFor(0, 5, 0)).toBe(3.2); // no crew yet: never divides by zero
  });
});
