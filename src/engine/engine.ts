import { createAction } from '../actions/index';
import { idleTarget } from '../idle/idle';
import { clamp } from '../motion/ease';
import { createRng } from '../motion/rng';
import { applyOps, installStyles, revealAll, revealArea, unmarkArea } from '../reveal/reveal';
import { crewTarget } from '../scheduler/crew';
import { createStage } from '../stage/stage';
import type {
  Config, Cursor, Deco, Engine, EngineEvent, EnginePlugin, Host, IdleCtx, Mode, Pt, RevealOp, Run,
} from '../types';
import { reportError, attachSafety } from './safety';
import { type Area, buildArea, finishTask, readLines, readRect } from './area';
import {
  type Crew, distToRect, fadeIn, inside, leaveStep, makeCrew, moving, sendOut, spawnAt, springTo, syncSprings,
} from './cursors';

const SPAWN_EVERY = 0.12;
const RETIRE_AFTER = 2.5;
const ARRIVE_PX = 2;
const HIDE_S = 0.4;
const MAX_DT = 0.05;
const STATS_N = 120;
/** px per frame below which a cursor counts as still */
const MOVE_EPS = 0.01;

interface Guide {
  area: Area;
  task: number;
  color: string;
}

export function createEngine(host: Host, config: Config): Engine {
  const win = host.win;
  const doc = host.doc;
  const rng = createRng(config.seed ?? (host.now() | 0));
  const theme =
    config.theme === 'auto'
      ? win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : config.theme;
  /** The stylesheet is installed while any area is building (R32). */
  let disposeStyles: (() => void) | null = null;
  const stage = createStage(host, config.zIndex, theme);
  const range = doc.createRange();

  const areas: Area[] = [];
  const crew: Crew[] = [];
  let cursors: Cursor[] = [];
  const guides: Guide[] = [];
  const plugins: EnginePlugin[] = [];
  const listeners = new Map<EngineEvent, Set<(p?: unknown) => void>>();
  const queued: [EngineEvent, unknown][] = [];
  const decos: Deco[] = [];
  const ops: RevealOp[] = [];
  const frameMs: number[] = [];

  let pointer: Pt | null = null;
  let lastTouch: Pt | null = null;
  let rafId = 0;
  let paused = false;
  let destroyed = false;
  let unlocked = false;
  let inFrame = false;
  let last = -1;
  let time = 0;
  let lastSpawn = -Infinity;
  let spawned = 0;
  let nextId = 1;
  let lastScrollY = host.scroll().y;
  let scrollSpeed = 0;
  let hadAreas = false;
  let working = false;
  let firstMove = false;
  let crewChanged = false;
  let failNext = false;

  // ---- events -------------------------------------------------------------

  /** A throwing listener is logged; the others, and the caller (finish, failsafe), carry on. */
  function fire(e: EngineEvent, p?: unknown): void {
    const set = listeners.get(e);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(p);
      } catch (err) {
        console.error('[curchestra]', err);
      }
    }
  }
  /** Inside a frame events wait until the frame's writes and draw are done. */
  function emit(e: EngineEvent, p?: unknown): void {
    if (inFrame) queued.push([e, p]);
    else fire(e, p);
  }

  // ---- loop control -------------------------------------------------------

  /** Schedule the next frame; at most one rAF is ever pending. */
  function schedule(restart: boolean): void {
    if (rafId || paused || destroyed || host.hidden()) return;
    if (restart) last = -1;
    rafId = host.raf(frame);
  }
  const wake = () => schedule(true);
  function halt(): void {
    if (rafId) host.caf(rafId);
    rafId = 0;
  }

  // ---- areas --------------------------------------------------------------

  function freeCrew(k: Crew): void {
    k.c.task = null;
    k.action = null;
    k.c.phase = 'idle';
    k.c.idleFor = 0;
    k.c.press = 0;
    k.home = { x: k.c.x, y: k.c.y };
  }

  function endArea(a: Area, events: boolean): void {
    if (a.done) return;
    a.done = true;
    areas.splice(areas.indexOf(a), 1);
    for (const k of crew) if (k.area === a && k.c.task !== null) freeCrew(k);
    for (let i = guides.length - 1; i >= 0; i--) if (guides[i].area === a) guides.splice(i, 1);
    // Inside a still-building area the marks keep this subtree visible; otherwise drop them (R32).
    if (areas.some((o) => o.root.contains(a.root))) revealArea(a.root, a.pieces.map((p) => p.el));
    else unmarkArea(a.root, areas.filter((o) => a.root.contains(o.root)).map((o) => o.root));
    if (areas.length === 0 && disposeStyles) {
      disposeStyles();
      disposeStyles = null;
    }
    a.resolve();
    if (events) emit('section:done', a.root);
    if (areas.length === 0 && hadAreas) {
      hadAreas = false;
      if (events) {
        callPlugins((p) => p.onComplete?.());
        emit('complete');
      }
    }
  }

  function areaOf(el: Element): Area | null {
    let best: Area | null = null;
    for (const a of areas) if (a.root.contains(el) && (!best || best.root.contains(a.root))) best = a;
    return best;
  }

  // ---- read helpers -------------------------------------------------------

  function readTask(k: Crew, sc: Pt, vp: { w: number; h: number }): void {
    const a = k.area!;
    const task = a.graph.tasks[k.c.task!];
    const ctx = k.ctx;
    ctx.viewport = vp;
    if (task.type === 'guide') {
      const gx = task.x - sc.x;
      ctx.guideX = gx;
      ctx.rect = { x: gx, y: 0, w: 0, h: vp.h };
      return;
    }
    const piece = a.pieces[task.piece!];
    ctx.rect = readRect(piece.el);
    if (task.type === 'text') readLines(range, piece.el, ctx.lines);
    if (task.type === 'dup' && task.original !== undefined) {
      const orig = a.graph.tasks[task.original];
      if (orig.piece !== null) ctx.origRect = readRect(a.pieces[orig.piece].el);
    }
  }

  /** Give `k` a task from the nearest active area that has one. */
  function assign(k: Crew, at: Pt, sc: Pt, vp: { w: number; h: number }): boolean {
    const order = areas.length === 1 ? areas : [...areas].sort((p, q) => distToRect(at, p.rect) - distToRect(at, q.rect));
    for (const a of order) {
      let id: number | null;
      for (;;) {
        id = a.sched.pick(at.y + sc.y, sc.y, sc.y + vp.h);
        if (id === null) break;
        if (a.pruned.has(id)) continue;
        const pi = a.graph.tasks[id].piece;
        if (pi === null || a.pieces[pi].el.isConnected) break;
        // Its element left the DOM since the last prune: finish it silently.
        a.pruned.add(id);
        a.sched.add(finishTask(a, id));
      }
      if (id === null) continue;
      const task = a.graph.tasks[id];
      k.area = a;
      k.c.task = id;
      k.c.idleFor = 0;
      k.c.alpha = 1;
      k.ctx.speed = a.cfg.speed;
      k.ctx.effects = a.cfg.effects;
      k.ctx.origRect = undefined;
      k.ctx.guideX = undefined;
      readTask(k, sc, vp);
      k.action = createAction(task, task.piece === null ? null : a.pieces[task.piece], k.ctx);
      k.off = { x: k.action.start.x - k.ctx.rect.x, y: k.action.start.y - k.ctx.rect.y };
      k.t = 0;
      k.key = 0;
      k.exit = null;
      return true;
    }
    return false;
  }

  // ---- frame --------------------------------------------------------------

  function frame(): void {
    rafId = 0;
    if (destroyed || paused || host.hidden()) return;
    let more = false;
    let ok = false;
    try {
      inFrame = true;
      more = step();
      ok = true;
    } catch (err) {
      // Never leave the page hidden: log, then reveal everything (events still fire below).
      reportError(host, err);
      engine.finishAll();
      ok = true;
    } finally {
      // Reset even if the body threw, so a later wake() can still schedule.
      inFrame = false;
      const events = queued.splice(0);
      try {
        if (ok) for (const [e, p] of events) fire(e, p);
      } finally {
        // Decided after listeners ran: they may have added areas, paused or destroyed.
        if (more) schedule(false);
      }
    }
  }

  /** One frame body; returns whether the loop should continue. */
  function step(): boolean {
    if (failNext) {
      failNext = false;
      throw new Error('injected frame failure');
    }
    const t0 = host.now();
    const dt = last < 0 ? 1 / 60 : clamp((t0 - last) / 1000, 0, MAX_DT);
    last = t0;
    time += dt;

    // 1. Read
    const sc = host.scroll();
    const vp = host.viewport();
    scrollSpeed = scrollSpeed * 0.8 + (Math.abs(sc.y - lastScrollY) / Math.max(dt, 1e-3)) * 0.2;
    lastScrollY = sc.y;
    for (const a of areas) a.rect = readRect(a.root);
    for (const k of crew) if (k.c.task !== null) readTask(k, sc, vp);

    // 2. Schedule
    let inRange = 0;
    let queuedAll = 0;
    for (const a of areas) {
      inRange += a.sched.inRange(sc.y, sc.y + vp.h, vp.h);
      queuedAll += a.sched.size();
    }
    // Crew bounds: the largest min / max among the active areas (R27); instance config when none.
    let bMin = areas.length ? 0 : config.agents.min;
    let bMax = areas.length ? 0 : config.agents.max;
    for (const a of areas) {
      bMin = Math.max(bMin, a.cfg.agents.min);
      bMax = Math.max(bMax, a.cfg.agents.max);
    }
    const target = crewTarget({ min: bMin, max: bMax, backlogInRange: inRange, scrollSpeed });
    for (const k of crew) {
      if (k.c.task !== null || k.c.phase === 'leave' || queuedAll === 0) continue;
      if (assign(k, { x: k.c.x, y: k.c.y }, sc, vp)) {
        k.c.phase = 'travel';
        queuedAll--;
      }
    }
    let live = 0;
    for (const k of crew) if (k.c.phase !== 'leave') live++;
    for (let i = crew.length - 1; i >= 0 && live > target; i--) {
      const k = crew[i];
      if (k.c.task !== null || k.c.idleFor <= RETIRE_AFTER) continue;
      if (k.c.phase === 'hidden') {
        crew.splice(i, 1);
        crewChanged = true;
        live--;
      } else if (k.c.phase === 'idle') {
        sendOut(k, vp);
        live--;
      }
    }
    if (live < target && queuedAll > 0 && time - lastSpawn >= SPAWN_EVERY) {
      const k = makeCrew(nextId++, spawned, config.agents, rng(), { x: vp.w / 2, y: vp.h / 2 }, rng, config.effects);
      if (assign(k, { x: vp.w / 2, y: vp.h / 2 }, sc, vp)) {
        spawned++;
        lastSpawn = time;
        spawnAt(k, vp);
        crew.push(k);
        crewChanged = true;
      }
    }

    // 3. Update
    decos.length = 0;
    ops.length = 0;
    const out = { decos, ops };
    let busy = false;
    let active = 0;
    let allIdle = true;
    for (let i = crew.length - 1; i >= 0; i--) {
      const k = crew[i];
      const c = k.c;
      const px = c.x;
      const py = c.y;
      const pa = c.alpha;
      const cfg = k.area?.cfg ?? config;
      if (c.task !== null && k.action && k.area) {
        active++;
        allIdle = false;
        const a = k.area;
        const task = a.graph.tasks[c.task];
        const pi = task.piece;
        if (pi !== null && !a.pieces[pi].el.isConnected) {
          // Element removed while being worked on: end silently, no ops (R21).
          a.sched.add(finishTask(a, c.task));
          freeCrew(k);
          busy = true;
          continue;
        }
        let arrived = false;
        fadeIn(c, dt);
        if (c.phase === 'enter' || c.phase === 'travel') {
          const tx = k.ctx.rect.x + k.off.x;
          const ty = k.ctx.rect.y + k.off.y;
          springTo(c, tx, ty, dt * cfg.speed);
          c.shape = 'arrow';
          if (c.phase === 'enter' && inside(c, vp)) c.phase = 'travel';
          if (Math.hypot(tx - c.x, ty - c.y) < ARRIVE_PX) {
            c.phase = 'work';
            arrived = true;
            callPlugins((p) => p.onTask?.(task.type, xNorm(c.x, vp.w)));
          }
        }
        if (c.phase === 'work') {
          if (!arrived) k.t += dt;
          const act = k.action;
          act.update(k.t, k.ctx, c, out);
          const ks = act.keystrokes;
          if (ks && plugins.length) {
            while (k.key < ks.length && ks[k.key] <= k.t) {
              k.key++;
              callPlugins((p) => p.onKey?.(xNorm(c.x, vp.w)));
            }
          }
          syncSprings(c, dt);
          if (k.t >= act.duration) {
            act.finish(k.ctx, out);
            const ready = finishTask(a, c.task);
            a.sched.add(ready);
            if (task.type === 'guide' && task.dependents.length) guides.push({ area: a, task: c.task, color: c.color });
            emit('task', { type: task.type, el: task.piece === null ? null : a.pieces[task.piece].el });
            freeCrew(k);
          }
        }
        busy = true;
      } else if (c.phase === 'leave') {
        busy = true;
        if (leaveStep(k, dt * cfg.speed, vp)) {
          crew.splice(i, 1);
          crewChanged = true;
          continue;
        }
      } else {
        c.idleFor += dt;
        if (c.phase === 'hidden') continue;
        if (c.idleFor < cfg.idle.after) {
          springTo(c, k.home.x, k.home.y, dt);
          busy = true;
          allIdle = false;
        } else {
          const behavior = cfg.persist || inRange > 0 ? cfg.idle.behavior : 'leave';
          const ictx: IdleCtx = {
            pointer, lastTouch, home: k.home, areaRect: k.area?.rect ?? { x: 0, y: 0, w: vp.w, h: vp.h },
            viewport: vp, time, seedPhase: c.seedPhase,
          };
          const tgt = idleTarget(behavior, cfg.idle.noPointer, cfg.idle.radius, ictx);
          if (tgt === 'leave') {
            sendOut(k, vp);
          } else if (tgt === 'hide') {
            springTo(c, k.home.x, k.home.y, dt);
            c.alpha = Math.max(0, c.alpha - dt / HIDE_S);
            if (c.alpha === 0) c.phase = 'hidden';
          } else if (tgt === 'stay') {
            springTo(c, k.home.x, k.home.y, dt);
          } else {
            springTo(c, tgt.x, tgt.y, dt);
          }
        }
      }
      const shifted = Math.abs(c.x - px) + Math.abs(c.y - py) > MOVE_EPS;
      if (shifted || c.alpha !== pa || moving(c)) {
        busy = true;
        if (!firstMove && shifted) {
          firstMove = true;
          win.performance.mark('cu:first-move');
        }
      }
    }
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      const task = g.area.graph.tasks[g.task];
      if (task.dependents.every((d) => g.area.graph.tasks[d].state === 'done')) guides.splice(i, 1);
      else decos.push({ t: 'guide', x: task.x - sc.x, color: g.color });
    }
    if (crewChanged) {
      cursors = crew.map((k) => k.c);
      crewChanged = false;
    }

    // 4. Write (no layout reads from here on)
    applyOps(ops);
    for (let i = areas.length - 1; i >= 0; i--) if (areas[i].left === 0) endArea(areas[i], true);

    // 5. Draw
    stage.draw(cursors, decos, config.agents.showNames, vp);

    // 6. Stats, events, continue
    frameMs.push(host.now() - t0);
    if (frameMs.length > STATS_N) frameMs.shift();
    if (active > 0 || inRange > 0) working = true;
    else if (working && allIdle) {
      working = false;
      emit('idle');
    }
    // Queued events fire in frame() once this returns.
    return busy || active > 0 || inRange > 0;
  }

  // ---- listeners ----------------------------------------------------------

  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    wake();
  };
  /** Run `fn` on every plugin; a throwing plugin must never break the frame. */
  function callPlugins(fn: (p: EnginePlugin) => void): void {
    for (const p of plugins) {
      try {
        fn(p);
      } catch (err) {
        console.error('[curchestra]', err);
      }
    }
  }
  const xNorm = (x: number, w: number) => (w > 0 ? Math.min(1, Math.max(0, x / w)) : 0);
  /** The first user gesture unlocks plugins that need one (audio contexts). */
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    callPlugins((p) => p.unlock?.());
  };
  const onKeyDown = () => unlock();
  const onDown = (e: PointerEvent) => {
    unlock();
    if (e.pointerType === 'touch') lastTouch = { x: e.clientX, y: e.clientY };
    wake();
  };
  const onLeave = () => {
    pointer = null;
    wake();
  };
  const onScroll = () => wake();
  const onResize = () => {
    stage.resize();
    wake();
  };
  const onVis = () => wake();
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerdown', onDown);
  win.addEventListener('keydown', onKeyDown, true);
  doc.documentElement.addEventListener('pointerleave', onLeave);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize);
  doc.addEventListener('visibilitychange', onVis);

  // ---- API ----------------------------------------------------------------

  const engine: Engine = {
    addArea(root: Element, cfg: Config, mode: Mode): Run {
      if (destroyed) return { done: Promise.resolve(), finish() {}, cancel() {} };
      for (const a of areas) if (a.root === root || a.root.contains(root)) return a.run;
      const inner = areas.filter((a) => root.contains(a.root)).map((a) => a.root);
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      const area = buildArea(host, root, cfg, mode, inner) as Area;
      area.resolve = resolve;
      area.run = {
        done,
        finish: () => endArea(area, true),
        cancel: () => endArea(area, false),
      };
      disposeStyles ??= installStyles(host);
      areas.push(area);
      hadAreas = true;
      wake();
      return area.run;
    },
    areaFor: (el) => areaOf(el)?.run ?? null,
    pause() {
      paused = true;
      halt();
    },
    resume() {
      paused = false;
      wake();
    },
    finishAll() {
      for (const a of [...areas]) endArea(a, true);
    },
    destroy() {
      if (destroyed) return;
      engine.finishAll();
      destroyed = true;
      disposeSafety();
      halt();
      revealAll(doc);
      stage.destroy();
      disposeStyles?.();
      disposeStyles = null;
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerdown', onDown);
      win.removeEventListener('keydown', onKeyDown, true);
      doc.documentElement.removeEventListener('pointerleave', onLeave);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onResize);
      doc.removeEventListener('visibilitychange', onVis);
      callPlugins((p) => p.destroy?.());
      plugins.length = 0;
      crew.length = 0;
      cursors = [];
      listeners.clear();
    },
    on(e, fn) {
      let set = listeners.get(e);
      if (!set) listeners.set(e, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    use(plugin) {
      plugins.push(plugin);
      if (unlocked) callPlugins((p) => (p === plugin ? p.unlock?.() : undefined));
    },
    __failNextFrame() {
      failNext = true;
    },
    __prune(root) {
      for (const a of areas) {
        if (a.root !== root) continue;
        for (const t of a.graph.tasks) {
          if ((t.state !== 'wait' && t.state !== 'ready') || t.piece === null || a.pruned.has(t.id)) continue;
          if (a.pieces[t.piece].el.isConnected) continue;
          a.pruned.add(t.id);
          a.sched.add(finishTask(a, t.id));
        }
      }
      wake();
    },
    stats: () => ({
      frameMs: [...frameMs],
      decos: [...decos],
      cursors: crew.map(({ c }) => ({ id: c.id, name: c.name, x: c.x, y: c.y, phase: c.phase, alpha: c.alpha })),
    }),
  };
  const disposeSafety = attachSafety(engine, host, config);
  return engine;
}
