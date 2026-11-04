import { completeTask, plan } from '../planner/plan';
import { markArea } from '../reveal/reveal';
import { scan } from '../scanner/scan';
import { createScheduler } from '../scheduler/buckets';
import type { Config, Host, Mode, Piece, Rect, Run, Scheduler, TaskGraph } from '../types';

/** Per-area build state: its own pieces, graph and scheduler. */
export interface Area {
  root: Element;
  cfg: Config;
  mode: Mode;
  pieces: Piece[];
  graph: TaskGraph;
  sched: Scheduler;
  /** tasks not yet done */
  left: number;
  done: boolean;
  run: Run;
  resolve: () => void;
  /** live viewport rect of the root, refreshed in the read phase */
  rect: Rect;
  /** tasks completed silently by pruning; they may still sit in the scheduler queue */
  pruned: Set<number>;
}

export function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Text line boxes: non-empty client rects, rects whose tops are within 2 px merged into one line. */
export function readLines(range: Range, el: Element, out: Rect[]): Rect[] {
  range.selectNodeContents(el);
  const list = range.getClientRects();
  out.length = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.width <= 0) continue;
    let line: Rect | undefined;
    for (const l of out) {
      if (Math.abs(l.y - r.top) <= 2) {
        line = l;
        break;
      }
    }
    if (!line) {
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      continue;
    }
    const x0 = Math.min(line.x, r.left);
    const y0 = Math.min(line.y, r.top);
    line.w = Math.max(line.x + line.w, r.right) - x0;
    line.h = Math.max(line.y + line.h, r.bottom) - y0;
    line.x = x0;
    line.y = y0;
  }
  return out;
}

/** Drop pieces inside already-active inner areas (R17) and renumber the rest. */
function dropInner(pieces: Piece[], inner: Element[]): Piece[] {
  if (inner.length === 0) return pieces;
  const ids = new Map<number, number>();
  const out: Piece[] = [];
  for (const p of pieces) {
    if (inner.some((r) => r.contains(p.el))) continue;
    ids.set(p.id, out.length);
    const parent = p.parent === null ? null : (ids.get(p.parent) ?? null);
    out.push({ ...p, id: out.length, parent });
  }
  return out;
}

/** scan → plan → markArea → scheduler.add(ready). `run` is attached by the engine. */
export function buildArea(
  host: Host,
  root: Element,
  cfg: Config,
  mode: Mode,
  inner: Element[],
): Omit<Area, 'run' | 'resolve'> {
  const pieces = dropInner(scan(host, root, { skip: cfg.skip, maxTasks: cfg.maxTasks }), inner);
  const { graph, ready } = plan(pieces, cfg.effects);
  const rect = readRect(root);
  markArea(root, pieces.map((p) => p.el));
  const sched = createScheduler(graph, host.viewport().h);
  sched.add(ready);
  return { root, cfg, mode, pieces, graph, sched, left: graph.tasks.length, done: false, rect, pruned: new Set() };
}

/** Marks a task done once; returns newly ready ids (empty when it was already done). */
export function finishTask(area: Area, id: number): number[] {
  if (area.graph.tasks[id].state === 'done') return [];
  area.left--;
  return completeTask(area.graph, id);
}
