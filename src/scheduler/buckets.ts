import type { Scheduler, TaskGraph } from '../types';

export function createScheduler(graph: TaskGraph, bandH: number): Scheduler {
  const buckets = new Map<number, number[]>();
  let count = 0;
  let minBand = Infinity;
  let maxBand = -Infinity;
  // A 0 px tall viewport (hidden iframe) would make every band Infinity/NaN and stall pick.
  const h = Math.max(1, bandH);
  const bandOf = (y: number) => Math.floor(y / h);

  function removeBucket(band: number): void {
    buckets.delete(band);
    if (buckets.size === 0) {
      minBand = Infinity;
      maxBand = -Infinity;
      return;
    }
    while (!buckets.has(minBand)) minBand++;
    while (!buckets.has(maxBand)) maxBand--;
  }

  /** Update `best` from `list`: guide > on-screen > nearest |y - cursor|. */
  function scan(
    list: number[],
    band: number,
    cursorDocY: number,
    viewTop: number,
    viewBot: number,
    best: { band: number; idx: number; rank: number; dist: number },
  ): void {
    for (let i = 0; i < list.length; i++) {
      const t = graph.tasks[list[i]];
      const rank = t.type === 'guide' ? 2 : t.y >= viewTop && t.y <= viewBot ? 1 : 0;
      const dist = Math.abs(t.y - cursorDocY);
      if (best.idx < 0 || rank > best.rank || (rank === best.rank && dist < best.dist)) {
        best.band = band;
        best.idx = i;
        best.rank = rank;
        best.dist = dist;
      }
    }
  }

  return {
    add(ids) {
      for (const id of ids) {
        const b = bandOf(graph.tasks[id].y);
        let list = buckets.get(b);
        if (!list) {
          list = [];
          buckets.set(b, list);
          if (b < minBand) minBand = b;
          if (b > maxBand) maxBand = b;
        }
        list.push(id);
        count++;
      }
    },

    pick(cursorDocY, viewTop, viewBot) {
      if (count === 0) return null;
      const cb = bandOf(cursorDocY);
      const maxD = Math.max(cb - minBand, maxBand - cb);
      const best = { band: 0, idx: -1, rank: -1, dist: 0 };
      for (let d = 0; d <= maxD; d++) {
        const lo = buckets.get(cb - d);
        if (lo) scan(lo, cb - d, cursorDocY, viewTop, viewBot, best);
        if (d > 0) {
          const hi = buckets.get(cb + d);
          if (hi) scan(hi, cb + d, cursorDocY, viewTop, viewBot, best);
        }
        if (best.idx >= 0) break;
      }
      if (best.idx < 0) return null;
      const list = buckets.get(best.band)!;
      const id = list[best.idx];
      list[best.idx] = list[list.length - 1];
      list.pop();
      if (list.length === 0) removeBucket(best.band);
      count--;
      graph.tasks[id].state = 'active';
      return id;
    },

    size: () => count,

    inRange(viewTop, viewBot, margin) {
      if (count === 0) return 0;
      const lo = Math.max(bandOf(viewTop - margin), minBand);
      const hi = Math.min(bandOf(viewBot + margin), maxBand);
      let n = 0;
      for (let b = lo; b <= hi; b++) {
        const list = buckets.get(b);
        if (list) n += list.length;
      }
      return n;
    },
  };
}
