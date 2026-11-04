import { describe, expect, it } from 'vitest';
import { createScheduler } from '../../src/scheduler/buckets';
import { crewTarget } from '../../src/scheduler/crew';
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

  it('picks the nearest band first', () => {
    const g = graphOf([[50], [250], [450]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(260, 0, 1000)).toBe(1);
    expect(s.pick(260, 0, 1000)).toBe(2); // bands 0 and 4 tie at d=2; y=450 is nearer
  });

  it('searches both sides at equal distance, then picks by priority', () => {
    const g = graphOf([[150], [350]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(260, 0, 1000)).toBe(1); // bands 1 and 3 tie at d=1; y=350 is nearer
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

  it('handles negative y and distant cursors', () => {
    const g = graphOf([[-250], [5000]]);
    const s = createScheduler(g, 100);
    s.add(ids(g));
    expect(s.pick(4000, 0, 100)).toBe(1);
    expect(s.pick(4000, 0, 100)).toBe(0);
  });
});

describe('crewTarget', () => {
  it('sizes from backlog and scroll speed, clamped', () => {
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 40, scrollSpeed: 0 })).toBe(16);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 0, scrollSpeed: 3000 })).toBe(26);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 9999, scrollSpeed: 99999 })).toBe(30);
    expect(crewTarget({ min: 6, max: 30, backlogInRange: 0, scrollSpeed: 0 })).toBe(6);
  });
});
