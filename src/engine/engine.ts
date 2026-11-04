/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import { createAction } from '../actions/index';
import { idlePlan } from '../idle/idle';
import type { FlowAgent, FlowState } from '../idle/liquid';
import { clamp } from '../motion/ease';
import { steerAngle } from '../motion/physics';
import { createRng } from '../motion/rng';
import { applyOps, installStyles, markArea, revealAll, revealArea, unmarkArea } from '../reveal/reveal';
import { crewTarget, tempoFor } from '../scheduler/crew';
import { createStage } from '../stage/stage';
import type {
  Config, Cursor, Deco, Engine, EngineEvent, EnginePlugin, Fx, Host, IdleCtx, Mode, Pt, RevealOp, Run,
} from '../types';
import { reportError, attachSafety } from './safety';
import { type Area, buildArea, finishTask, readLines, readRect } from './area';
import {
  type Crew, confineRect, distToRect, fadeIn, inside, leaveStep, makeCrew, moving, sendOut, spawnAt, springTo,
  syncSprings, travelStep,
} from './cursors';

/** min seconds between spawns */
const SPAWN_EVERY = 0.035;
/** scroll speed decay rate, 1/s */
const VEL_DECAY = 1.2;
/** max measured scroll speed, px/s */
const VEL_CAP = 6000;
/** intro starting radius, px */
const INTRO_R = 160;
const RETIRE_AFTER = 2.5;
const HIDE_S = 0.4;
/** press decay rate, 1/s */
const PRESS_DECAY = 6;
/** seconds rulers stay after the last on-screen work */
const RULER_LINGER = 0.7;
const MAX_DT = 0.05;
const STATS_N = 120;
/** px per frame below which a cursor is still */
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
  /** installed while any area is building */
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
  const fx: Fx[] = [];
  const frameMs: number[] = [];
  /** idle cursors grouped by orbit this frame */
  const flows = new Map<
    string,
    { center: Pt; pointer: Pt | null; radius: number; tight: boolean; agents: FlowAgent[]; ks: Crew[] }
  >();
  const flowStates = new Map<string, FlowState>();
  /** roots hidden by hold(), not built yet */
  const held = new Set<Element>();
  /** Idle motion is a lazy chunk; idle cursors hold still until it loads. */
  let liquid: typeof import('../idle/liquid') | null = null;
  let liquidLoading = false;
  function needLiquid(cfg: Config | null): void {
    if (liquidLoading || (cfg && (cfg.idle.behavior === 'leave' || cfg.idle.behavior === 'hide'))) return;
    liquidLoading = true;
    import('../idle/liquid').then(
      (m) => {
        liquid = m;
        if (!destroyed) wake();
      },
      (err) => reportError(host, err),
    );
  }

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
  /** smoothed scroll speed, px/s */
  let scrollSpeed = 0;
  /** action timings are divided by this */
  let tempo = 2.1;
  /** lowest document y seen so far; page work below it waits */
  let frontier = -Infinity;
  let hadAreas = false;
  let working = false;
  let firstMove = false;
  /** onStart fired for this build */
  let started = false;
  let rulersNeed = -10;
  let rulersT = 0;
  /** intro ring is on until the first area starts */
  let introOn = false;
  let introEl: Element | null = null;
  /** called once when the pointer bumps the intro ring */
  let introPoke: (() => void) | null = null;
  let poked: (() => void) | null = null;
  let crewChanged = false;
  let failNext = false;

  // ---- events -------------------------------------------------------------

  /** A throwing listener is logged; the rest still run. */
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
  /** Inside a frame, events wait until the frame is drawn. */
  function emit(e: EngineEvent, p?: unknown): void {
    if (inFrame) queued.push([e, p]);
    else fire(e, p);
  }

  // ---- loop control -------------------------------------------------------

  /** At most one rAF is pending. */
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
    k.c.shape = 'arrow';
    k.arc = null;
    k.wander = null;
    k.home = { x: k.c.x, y: k.c.y };
  }

  function endArea(a: Area, events: boolean): void {
    if (a.done) return;
    a.done = true;
    areas.splice(areas.indexOf(a), 1);
    for (const k of crew) if (k.area === a && k.c.task !== null) freeCrew(k);
    for (let i = guides.length - 1; i >= 0; i--) if (guides[i].area === a) guides.splice(i, 1);
    // inside a building area keep the marks, otherwise drop them
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
      started = false;
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
    if (task.type === 'text' || task.type === 'dup') readLines(range, piece.el, ctx.lines);
    if (task.type === 'text') {
      ctx.snapX = undefined;
      for (const d of task.deps) {
        const g = a.graph.tasks[d];
        if (g.type === 'guide') ctx.snapX = g.x - sc.x;
      }
    }
    if (task.type === 'dup' && task.original !== undefined) {
      const orig = a.graph.tasks[task.original];
      if (orig.piece !== null) ctx.origRect = readRect(a.pieces[orig.piece].el);
    }
  }

  /** Give `k` a task from the nearest area that has one. */
  function assign(k: Crew, at: Pt, sc: Pt, vp: { w: number; h: number }): boolean {
    const order = areas.length === 1 ? areas : [...areas].sort((p, q) => distToRect(at, p.rect) - distToRect(at, q.rect));
    for (const a of order) {
      let id: number | null;
      for (;;) {
        // pages build only what was seen; sections and transitions build everything
        id = a.sched.pick(at.y + sc.y, sc.y, sc.y + vp.h, a.mode === 'page' ? frontier : Infinity);
        if (id === null) break;
        if (a.pruned.has(id)) continue;
        const pi = a.graph.tasks[id].piece;
        if (pi === null || a.pieces[pi].el.isConnected) break;
        // element left the DOM: finish silently
        a.pruned.add(id);
        a.sched.add(finishTask(a, id));
      }
      if (id === null) continue;
      const task = a.graph.tasks[id];
      k.area = a;
      k.c.task = id;
      k.c.idleFor = 0;
      k.c.alpha = 1;
      k.wander = null;
      k.ctx.speed = a.cfg.speed;
      k.ctx.effects = a.cfg.effects;
      k.ctx.origRect = undefined;
      k.ctx.guideX = undefined;
      k.ctx.snapX = undefined;
      k.ctx.origText = undefined;
      if (task.type === 'dup' && task.original !== undefined) {
        const op = a.graph.tasks[task.original].piece;
        if (op !== null) k.ctx.origText = (a.pieces[op].el.textContent ?? '').replace(/\s+/g, ' ');
      }
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
      // never leave the page hidden
      reportError(host, err);
      engine.finishAll();
      ok = true;
    } finally {
      inFrame = false;
      const events = queued.splice(0);
      try {
        if (ok) for (const [e, p] of events) fire(e, p);
      } finally {
        // after listeners: they may add areas, pause or destroy
        if (more) schedule(false);
        // intro poked: start the build outside the frame
        const p = poked;
        poked = null;
        if (p) {
          try {
            p();
          } catch (err) {
            reportError(host, err);
          }
        }
      }
    }
  }

  /** One frame; returns whether to continue. */
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
    const v = Math.min(VEL_CAP, Math.abs(sc.y - lastScrollY) / Math.max(dt, 1e-3));
    scrollSpeed = Math.max(scrollSpeed * Math.exp(-dt * VEL_DECAY), scrollSpeed * 0.7 + v * 0.3);
    if (scrollSpeed < 1) scrollSpeed = 0;
    lastScrollY = sc.y;
    if (areas.length) frontier = Math.max(frontier, sc.y + vp.h);
    for (const a of areas) a.rect = readRect(a.root);
    for (const k of crew) if (k.c.task !== null) readTask(k, sc, vp);
    const ring = introOn && areas.length === 0
      ? introEl ? readRect(introEl) : { x: vp.w / 2 - 20, y: vp.h / 2 - 20, w: 40, h: 40 }
      : null;
    if (introOn && areas.length) {
      // build started: release the ring
      introOn = false;
      introPoke = null;
      for (const k of crew) {
        if (k.ring === undefined) continue;
        k.ring = undefined;
        k.c.idleFor = 0;
        k.home = { x: k.c.x, y: k.c.y };
        syncSprings(k.c, 0);
        k.c.sx.v = k.vel.x;
        k.c.sy.v = k.vel.y;
      }
    }

    // 2. Schedule
    let inRange = 0;
    let inView = 0;
    let queuedAll = 0;
    for (const a of areas) {
      inRange += a.sched.inRange(sc.y, sc.y + vp.h, vp.h);
      inView += a.sched.inRange(sc.y, sc.y + vp.h, 0);
      queuedAll += a.sched.size();
    }
    tempo = tempoFor(scrollSpeed, inView, crew.length);
    const building = areas.length > 0;
    // crew bounds: largest min/max of active areas, else instance config
    let bMin = areas.length ? 0 : config.agents.min;
    let bMax = areas.length ? 0 : config.agents.max;
    for (const a of areas) {
      bMin = Math.max(bMin, a.cfg.agents.min);
      bMax = Math.max(bMax, a.cfg.agents.max);
    }
    const target = crewTarget({ min: bMin, max: bMax, backlogInRange: inView, scrollSpeed });
    for (const k of crew) {
      if (k.c.task !== null || k.c.phase === 'leave' || queuedAll === 0) continue;
      if (assign(k, { x: k.c.x, y: k.c.y }, sc, vp)) {
        k.c.phase = 'travel';
        k.arc = null;
        queuedAll--;
      }
    }
    let live = 0;
    for (const k of crew) if (k.c.phase !== 'leave') live++;
    for (let i = crew.length - 1; i >= 0 && live > target; i--) {
      const k = crew[i];
      if (ring || k.c.task !== null || k.c.idleFor <= RETIRE_AFTER) continue;
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
      lastSpawn = time;
      if (assign(k, { x: vp.w / 2, y: vp.h / 2 }, sc, vp)) {
        spawned++;
        spawnAt(k, vp, rng);
        crew.push(k);
        crewChanged = true;
      } else if (live < bMin && areas.length) {
        // below min crew: join anyway and stroll
        const a = areas[0];
        k.area = a;
        k.ctx.rect = a.rect;
        k.off = { x: a.rect.w / 2, y: Math.min(a.rect.h, vp.h) / 2 };
        k.c.phase = 'idle';
        spawned++;
        spawnAt(k, vp, rng);
        crew.push(k);
        crewChanged = true;
      }
    }

    // 3. Update
    decos.length = 0;
    ops.length = 0;
    fx.length = 0;
    const out = { decos, ops, fx };
    let busy = false;
    let active = 0;
    let allIdle = true;
    flows.clear();
    for (let i = crew.length - 1; i >= 0; i--) {
      const k = crew[i];
      const c = k.c;
      const px = c.x;
      const py = c.y;
      const pa = c.alpha;
      const cfg = k.area?.cfg ?? config;
      c.press = Math.max(0, c.press - dt * PRESS_DECAY);
      let tilt: 'lean' | 'rest' | 'align' | 'flow' = 'lean';
      if (c.task !== null && k.action && k.area) {
        active++;
        allIdle = false;
        const a = k.area;
        const task = a.graph.tasks[c.task];
        const pi = task.piece;
        if (pi !== null && !a.pieces[pi].el.isConnected) {
          // element removed mid-task: end silently
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
          const landed = travelStep(k, { x: tx, y: ty }, dt * tempo, cfg.speed, rng);
          syncSprings(c, dt);
          c.shape = k.action.shape;
          if (c.phase === 'enter' && inside(c, vp)) c.phase = 'travel';
          if (landed) {
            c.phase = 'work';
            arrived = true;
            if (!started) {
              started = true;
              callPlugins((p) => p.onStart?.());
            }
          }
        }
        // rulers show while work is on screen (its area too: guide cursors sit on the ruler)
        const seen = cfg.effects.rulers && a.rect.y < vp.h && a.rect.y + a.rect.h > 0;
        if (seen && inside(c, vp)) rulersNeed = time;
        if (c.phase === 'work') {
          tilt = 'rest';
          if (!arrived) k.t += dt * tempo;
          const act = k.action;
          if (act.rulers && seen) rulersNeed = time;
          const f0 = fx.length;
          act.update(k.t, k.ctx, c, out);
          if (k.t >= act.duration) act.finish(k.ctx, out);
          if (plugins.length) for (let f = f0; f < fx.length; f++) callPlugins((p) => p.onFx?.(fx[f], { x: c.x, y: c.y }, vp));
          syncSprings(c, dt);
          if (k.t >= act.duration) {
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
        if (ring && liquid) {
          // intro ring, stepped with the flows below
          let g = flows.get('intro');
          if (!g) {
            g = {
              center: { x: ring.x + ring.w / 2, y: ring.y + ring.h / 2 },
              pointer,
              radius: clamp(Math.max(ring.w, ring.h) / 2 + 50, 95, Math.min(vp.w, vp.h) * 0.25),
              tight: false,
              agents: [],
              ks: [],
            };
            flows.set('intro', g);
          }
          g.agents.push({ pos: c, vel: k.vel, p: k.p });
          g.ks.push(k);
          tilt = 'flow';
          allIdle = false;
        } else if (ring) {
          // flow chunk not loaded yet: hold
          busy = true;
          allIdle = false;
        } else if (liquid && building && (cfg.persist || inRange > 0) && cfg.idle.behavior !== 'leave' && cfg.idle.behavior !== 'hide') {
          // between jobs: stroll in view
          fadeIn(c, dt);
          liquid.wanderStep(k, confineRect(k.area, vp), vp, sc, dt, tempo, rng);
          syncSprings(c, dt);
          k.home = { x: c.x, y: c.y };
          busy = true;
          allIdle = false;
        } else if (c.idleFor < cfg.idle.after) {
          springTo(c, k.home.x, k.home.y, dt);
          busy = true;
          allIdle = false;
        } else {
          const behavior = cfg.persist || inRange > 0 ? cfg.idle.behavior : 'leave';
          const ictx: IdleCtx = {
            pointer, lastTouch, home: k.home, areaRect: k.area?.rect ?? { x: 0, y: 0, w: vp.w, h: vp.h },
            viewport: vp, time, seedPhase: c.seedPhase,
          };
          const plan = idlePlan(behavior, cfg.idle.noPointer, ictx);
          if (plan.kind === 'leave') {
            sendOut(k, vp);
          } else if (plan.kind === 'hide') {
            springTo(c, k.home.x, k.home.y, dt);
            c.alpha = Math.max(0, c.alpha - dt / HIDE_S);
            if (c.alpha === 0) c.phase = 'hidden';
          } else if (plan.kind === 'stay') {
            springTo(c, k.home.x, k.home.y, dt);
          } else if (plan.kind === 'point') {
            springTo(c, plan.at.x, plan.at.y, dt);
          } else if (!liquid) {
            springTo(c, k.home.x, k.home.y, dt);
          } else {
            // join the orbit; stepped after this loop
            const onPointer = plan.center === pointer;
            const key = `${onPointer ? 'p' : 't'}|${cfg.idle.radius}|${plan.tight ? 1 : 0}`;
            let g = flows.get(key);
            if (!g) {
              g = { center: plan.center, pointer: onPointer ? pointer : null, radius: cfg.idle.radius, tight: plan.tight, agents: [], ks: [] };
              flows.set(key, g);
            }
            g.agents.push({ pos: c, vel: k.vel, p: k.p });
            g.ks.push(k);
            tilt = 'flow';
          }
        }
      }
      if (tilt !== 'flow' && dt > 0) {
        k.vel.x = (c.x - px) / dt;
        k.vel.y = (c.y - py) / dt;
        c.angle = steerAngle(c.angle, k.vel.x, k.vel.y, dt, tilt);
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
    for (const [key, g] of flows) {
      let st = flowStates.get(key);
      if (!st) {
        st = liquid!.createFlow();
        flowStates.set(key, st);
      }
      const touched = liquid!.flowStep(st, g.agents, g.center, g.pointer, g.radius, g.tight, time, dt);
      if (touched && key === 'intro' && introPoke) {
        poked = introPoke;
        introPoke = null;
      }
      for (const k of g.ks) {
        syncSprings(k.c, 0);
        k.c.sx.v = k.vel.x;
        k.c.sy.v = k.vel.y;
        k.c.angle = steerAngle(k.c.angle, k.vel.x, k.vel.y, dt, 'align');
      }
      busy = true;
    }
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      const task = g.area.graph.tasks[g.task];
      if (task.dependents.every((d) => g.area.graph.tasks[d].state === 'done')) guides.splice(i, 1);
      // placed guides show only while their area is on screen
      else if (g.area.rect.y < vp.h && g.area.rect.y + g.area.rect.h > 0) {
        decos.push({ t: 'guide', x: task.x - sc.x, color: g.color });
      }
    }
    if (crewChanged) {
      cursors = crew.map((k) => k.c);
      crewChanged = false;
    }

    // 4. Write (no layout reads after this)
    applyOps(ops);
    for (let i = areas.length - 1; i >= 0; i--) if (areas[i].left === 0) endArea(areas[i], true);

    // 5. Draw
    const rWant = time - rulersNeed < RULER_LINGER ? 1 : 0;
    rulersT += (rWant - rulersT) * Math.min(1, dt * 10);
    if (Math.abs(rWant - rulersT) < 0.002) rulersT = rWant;
    else busy = true;
    stage.draw(cursors, decos, config.agents.showNames, vp, { t: rulersT, sx: sc.x, sy: sc.y });

    // 6. Stats, events, continue
    frameMs.push(host.now() - t0);
    if (frameMs.length > STATS_N) frameMs.shift();
    if (active > 0 || inRange > 0) working = true;
    else if (working && allIdle) {
      working = false;
      emit('idle');
    }
    return busy || active > 0 || inRange > 0;
  }

  // ---- listeners ----------------------------------------------------------

  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    wake();
  };
  /** A throwing plugin is logged and never breaks the frame. */
  function callPlugins(fn: (p: EnginePlugin) => void): void {
    for (const p of plugins) {
      try {
        fn(p);
      } catch (err) {
        console.error('[curchestra]', err);
      }
    }
  }
  /** The first user gesture unlocks plugins (audio). */
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
      // un-hide a held root right before its scan
      if (held.delete(root)) unmarkArea(root, []);
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      const area = buildArea(host, root, cfg, mode, inner) as Area;
      needLiquid(cfg);
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
    hold(root) {
      if (destroyed || held.has(root) || areaOf(root)) return;
      disposeStyles ??= installStyles(host);
      held.add(root);
      markArea(root, []);
    },
    intro(target, poke) {
      if (destroyed || introOn || areas.length) return;
      introOn = true;
      introEl = target;
      introPoke = poke ?? null;
      needLiquid(null);
      const vp = host.viewport();
      const box = target ? readRect(target) : null;
      const cx = box ? box.x + box.w / 2 : vp.w / 2;
      const cy = box ? box.y + box.h / 2 : vp.h / 2;
      const n = Math.min(18, Math.max(config.agents.min, config.agents.max));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const at = { x: cx + Math.cos(a) * INTRO_R, y: cy + Math.sin(a) * INTRO_R };
        const k = makeCrew(nextId++, spawned++, config.agents, rng(), at, rng, config.effects);
        k.c.phase = 'idle';
        k.c.idleFor = 1e3;
        k.ring = i;
        crew.push(k);
      }
      crewChanged = true;
      callPlugins((p) => p.onIntro?.());
      wake();
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
      // show sections still waiting for a scroll
      for (const r of held) unmarkArea(r, []);
      held.clear();
      introOn = false;
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
      cursors: crew.map(({ c }) => ({ id: c.id, name: c.name, x: c.x, y: c.y, phase: c.phase, alpha: c.alpha, shape: c.shape, angle: c.angle })),
      rulers: rulersT,
    }),
  };
  const disposeSafety = attachSafety(engine, host, config);
  return engine;
}
