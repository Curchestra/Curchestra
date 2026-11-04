import type { Scheduler, TaskGraph } from '../types';

/** px above the view that still count as on screen */
const LOOK_UP = 40;
/** top-down order outweighs closeness to the cursor */
const TOP_W = 0.6;
const NEAR_W = 0.4;

/** tier order: on-screen guide, on-screen, above the view, below the view */
const T_GUIDE = 0;
const T_VIEW = 1;
const T_ABOVE = 2;
const T_BELOW = 3;

export function createScheduler(graph: TaskGraph, bandH: number): Scheduler {
  const buckets = new Map<number, number[]>();
  let count = 0;
  let minBand = Infinity;
  let maxBand = -Infinity;
  // guard 0 px viewports
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

  interface Best { band: number; idx: number; tier: number; score: number }

  /** On screen top-down first, then above the view, then below; nothing below `limit`. */
  function consider(list: number[], band: number, cur: number, top: number, bot: number, limit: number, best: Best): void {
    for (let i = 0; i < list.length; i++) {
      const t = graph.tasks[list[i]];
      if (t.y > limit) continue;
      const near = Math.abs(t.y - cur) * NEAR_W;
      let tier: number;
      let score: number;
      if (t.y >= top && t.y <= bot) {
        tier = t.type === 'guide' ? T_GUIDE : T_VIEW;
        score = (t.y - top) * TOP_W + near;
      } else if (t.y < top) {
        tier = T_ABOVE;
        score = (top - t.y) * TOP_W + near;
      } else {
        tier = T_BELOW;
        score = (t.y - bot) * TOP_W + near;
      }
      if (best.idx < 0 || tier < best.tier || (tier === best.tier && score < best.score)) {
        best.band = band;
        best.idx = i;
        best.tier = tier;
        best.score = score;
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

    pick(cursorDocY, viewTop, viewBot, limit = Infinity) {
      if (count === 0) return null;
      const top = viewTop - LOOK_UP;
      const best: Best = { band: 0, idx: -1, tier: 99, score: 0 };
      const scan = (b: number) => {
        const list = buckets.get(b);
        if (list) consider(list, b, cursorDocY, top, viewBot, limit, best);
      };
      // 1. bands overlapping the view
      const b0 = Math.max(bandOf(top), minBand);
      const b1 = Math.min(bandOf(viewBot), maxBand);
      for (let b = b0; b <= b1; b++) scan(b);
      // 2. nearest band above
      if (best.tier > T_ABOVE) {
        for (let b = Math.min(bandOf(top) - 1, maxBand); b >= minBand && best.tier > T_ABOVE; b--) scan(b);
      }
      // 3. below, down to `limit`
      if (best.idx < 0) {
        const end = Math.min(maxBand, Number.isFinite(limit) ? bandOf(limit) : maxBand);
        for (let b = Math.max(bandOf(viewBot) + 1, minBand); b <= end && best.idx < 0; b++) scan(b);
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
