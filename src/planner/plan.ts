import type { Config, Piece, Task, TaskGraph, TaskType } from '../types';

const REPEAT_TOLERANCE = 0.1;
const MIN_REPEATS = 3;
const MIN_GUIDE_TEXTS = 3;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * REPEAT_TOLERANCE;
}

function addDep(task: Task, dep: number): void {
  if (!task.deps.includes(dep)) task.deps.push(dep);
}

export function plan(
  pieces: Piece[],
  effects: Config['effects'],
): { graph: TaskGraph; ready: number[] } {
  const tasks: Task[] = [];
  const pieceTask = new Map<number, number>();

  // Rule 1: one task per piece.
  for (const p of pieces) {
    const type: TaskType = p.kind === 'line' && !effects.pen ? 'box' : p.kind;
    const id = tasks.length;
    pieceTask.set(p.id, id);
    tasks.push({
      id, type, piece: p.id, y: p.rect.y, x: p.rect.x,
      deps: [], dependents: [], pending: 0, state: 'wait',
    });
  }

  // Rule 2: depend on the parent piece's task.
  for (const p of pieces) {
    if (p.parent === null) continue;
    const parentTask = pieceTask.get(p.parent);
    if (parentTask !== undefined) addDep(tasks[pieceTask.get(p.id)!], parentTask);
  }

  // Rule 3: repeats among siblings (same parent, same sig).
  if (effects.duplicate) {
    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const key = `${p.parent === null ? '' : p.parent}|${p.sig}`;
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    for (const g of groups.values()) {
      if (g.length < MIN_REPEATS) continue;
      const first = g[0];
      const matches = g.filter(
        (p) => p === first || (near(p.rect.w, first.rect.w) && near(p.rect.h, first.rect.h)),
      );
      if (matches.length < MIN_REPEATS) continue;
      const original = pieceTask.get(first.id)!;
      for (let i = 1; i < matches.length; i++) {
        const t = tasks[pieceTask.get(matches[i].id)!];
        t.type = 'dup';
        t.original = original;
        addDep(t, original);
      }
    }
  }

  // Rule 4: guides over text tasks sharing an x (after dup conversion).
  if (effects.guides) {
    const byX = new Map<number, Task[]>();
    for (const p of pieces) {
      const t = tasks[pieceTask.get(p.id)!];
      if (t.type !== 'text') continue;
      const x = Math.round(p.rect.x);
      const g = byX.get(x);
      if (g) g.push(t);
      else byX.set(x, [t]);
    }
    for (const [x, group] of byX) {
      if (group.length < MIN_GUIDE_TEXTS) continue;
      let y = Infinity;
      for (const t of group) if (t.y < y) y = t.y;
      const id = tasks.length;
      tasks.push({
        id, type: 'guide', piece: null, y, x,
        deps: [], dependents: [], pending: 0, state: 'wait',
      });
      for (const t of group) addDep(t, id);
    }
  }

  // Rule 5: counters, adjacency, ready set.
  const ready: number[] = [];
  for (const t of tasks) {
    t.pending = t.deps.length;
    for (const d of t.deps) tasks[d].dependents.push(t.id);
    if (t.pending === 0) {
      t.state = 'ready';
      ready.push(t.id);
    }
  }

  return { graph: { tasks, pieceTask }, ready };
}

export function completeTask(graph: TaskGraph, id: number): number[] {
  const task = graph.tasks[id];
  task.state = 'done';
  const ready: number[] = [];
  for (const d of task.dependents) {
    const dep = graph.tasks[d];
    if (--dep.pending === 0) {
      dep.state = 'ready';
      ready.push(d);
    }
  }
  return ready;
}
