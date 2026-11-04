/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import { resolveConfig, readDataAttrs } from '../config/resolve';
import { validate } from '../config/validate';
import { createEngine } from '../engine/engine';
import { browserHost } from '../host/host';
import { unmarkArea } from '../reveal/reveal';
import type { Config, DeepPartial, Engine, EngineEvent, Host, Mode, Run } from '../types';

export interface Curchestra {
  page(opts?: DeepPartial<Config>): Run;
  section(target: string | Element, opts?: DeepPartial<Config>): Run;
  transition(
    update: () => unknown | Promise<unknown>,
    opts?: { root?: string | Element } & DeepPartial<Config>,
  ): Promise<void>;
  pause(): void;
  resume(): void;
  finish(): void;
  destroy(): void;
  on(e: EngineEvent, fn: (p?: unknown) => void): () => void;
}

// Dev-only code uses the literal `process.env.NODE_ENV` check so bundlers can strip it.

const FADE_MS = 180;
/** intro length when no scroll is awaited, ms */
const INTRO_MS = 1400;
const SKIP_TAGS = new Set(['script', 'style', 'link', 'template', 'noscript']);

const doneRun = (): Run => ({ done: Promise.resolve(), finish() {}, cancel() {} });

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `s` is a valid selector. */
function selectorCheck(doc: Document): (s: string) => boolean {
  const frag = doc.createDocumentFragment();
  return (s) => {
    try {
      frag.querySelector(s);
      return true;
    } catch {
      return false;
    }
  };
}

/** One area in a group behind one Run. */
interface Slot {
  root: Element;
  cfg: Config;
  started: boolean;
  run: Run | null;
  settle: () => void;
  done: Promise<void>;
}

export function curchestra(config?: DeepPartial<Config>): Curchestra {
  const host: Host | null = browserHost();
  if (!host) {
    return {
      page: doneRun,
      section: doneRun,
      transition: async (update) => {
        await update();
      },
      pause() {},
      resume() {},
      finish() {},
      destroy() {},
      on: () => () => {},
    };
  }
  const { win, doc } = host;
  const g = win as unknown as typeof globalThis;
  const selOk = selectorCheck(doc);

  /** Validated in dev, sanitized in prod. */
  function clean(input: unknown): DeepPartial<Config> {
    if (process.env.NODE_ENV !== 'production') return validate(input, undefined, selOk);
    if (!isPlain(input)) return {};
    if (!('skip' in input)) return input as DeepPartial<Config>;
    const skip = Array.isArray(input.skip) ? input.skip.filter((s) => typeof s === 'string' && selOk(s)) : [];
    return { ...input, skip } as DeepPartial<Config>;
  }

  let engine: Engine | null = null;
  let globalLayer: DeepPartial<Config> | null = null;
  let pageRun: Run | null = null;
  const subs = new Set<{ e: EngineEvent; fn: (p?: unknown) => void; off: (() => void) | null }>();
  const groups = new Set<Run>();
  const cleanups = new Set<() => void>();

  const globalCfg = () => (globalLayer ??= clean(config));

  function getEngine(): Engine {
    if (!engine) {
      const cfg = resolveConfig(globalCfg());
      const eng = (engine = createEngine(host!, cfg));
      // sound is a lazy chunk
      if (cfg.sound) {
        const sound = cfg.sound;
        import('../audio/index')
          .then((m) => {
            if (engine === eng) eng.use(m.createAudio(sound === true ? { volume: 0.7 } : sound));
          })
          .catch((err) => console.error('[curchestra]', err));
      }
      for (const s of subs) s.off = engine.on(s.e, s.fn);
    }
    return engine;
  }

  const markReady = () => doc.documentElement.classList.add('cu-ready');

  let warnedInstance = false;
  /** Warn once when instance-level keys are set per call. */
  function warnInstanceLevel(layer: DeepPartial<Config>): void {
    if (process.env.NODE_ENV === 'production' || warnedInstance) return;
    const hit = ['seed', 'theme', 'zIndex', 'skipOnClick', 'sound'].find((k) => k in layer) ?? (layer.agents && 'showNames' in layer.agents ? 'agents.showNames' : '');
    if (!hit) return;
    warnedInstance = true;
    console.warn(`[curchestra] ${hit}: only applies to curchestra(config); ignored for this call`);
  }

  function areaConfig(root: Element, opts: unknown, base?: DeepPartial<Config>): Config {
    const call = clean(opts);
    const attrs = clean(readDataAttrs(root));
    warnInstanceLevel(call);
    warnInstanceLevel(attrs);
    return resolveConfig(base, globalCfg(), call, attrs);
  }

  /** Reduced motion: show content, create nothing. */
  const reduced = (cfg: Config) => cfg.reducedMotion === 'respect' && host!.reducedMotion();

  function startSlot(slot: Slot, mode: Mode): void {
    if (slot.started) return;
    slot.started = true;
    try {
      const run = getEngine().addArea(slot.root, slot.cfg, mode);
      slot.run = run;
      run.done.then(slot.settle);
    } catch (err) {
      // engine failed: show content and settle
      console.error('[curchestra]', err);
      unmarkArea(slot.root, []);
      slot.settle();
    }
  }

  /** One Run over `roots`, each started by its own trigger. */
  function group(roots: Element[], mode: Mode, opts: unknown, base?: DeepPartial<Config>): Run {
    const slots: Slot[] = roots.map((root) => {
      let settle!: () => void;
      const done = new Promise<void>((r) => (settle = r));
      return { root, cfg: areaConfig(root, opts, base), started: false, run: null, settle, done };
    });
    let observer: IntersectionObserver | null = null;
    const bySlot = new Map<Element, Slot>();
    /** page mode: hidden sections waiting to enter the view */
    let entry: IntersectionObserver | null = null;
    const byEntry = new Map<Element, Slot>();

    const stop = () => {
      observer?.disconnect();
      observer = null;
      entry?.disconnect();
      entry = null;
      cleanups.delete(stop);
    };
    /** Unstarted areas are shown and settled. */
    const end = (how: 'finish' | 'cancel') => {
      stop();
      for (const s of slots) {
        if (s.run) s.run[how]();
        else {
          if (!s.started) unmarkArea(s.root, []);
          s.settle();
        }
        s.started = true;
      }
      markReady();
    };
    const run: Run = {
      done: Promise.all(slots.map((s) => s.done)).then(() => {
        stop();
        groups.delete(run);
      }),
      finish: () => end('finish'),
      cancel: () => end('cancel'),
    };
    groups.add(run);

    // start near areas now; read every position before the first write
    const vh = host!.viewport().h;
    const nearNow = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.bottom >= -vh && r.top <= 2 * vh;
    };
    /** on screen, or within 10% of it */
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.bottom >= -0.1 * vh && r.top <= 1.1 * vh;
    };
    const staged = mode === 'page' && typeof g.IntersectionObserver !== 'undefined';
    /** Start now, or in page mode hide now and start on entering the view (so its failsafe starts then). */
    const begin = (s: Slot, inView = seen(s.root)) => {
      if (!staged || inView) {
        startSlot(s, mode);
        return;
      }
      getEngine().hold(s.root);
      markReady();
      entry ??= new g.IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const t = byEntry.get(en.target);
            if (!en.isIntersecting || !t) continue;
            entry?.unobserve(en.target);
            byEntry.delete(en.target);
            startSlot(t, mode);
          }
        },
        { rootMargin: '10% 0px' },
      );
      cleanups.add(stop);
      byEntry.set(s.root, s);
      entry.observe(s.root);
    };
    const now: Slot[] = [];
    const lazy: Slot[] = [];
    /** hidden now, built on the first scroll or after the intro */
    const held: Slot[] = [];
    let intro: Config['intro'] = false;
    for (const s of slots) {
      if (reduced(s.cfg)) {
        s.started = true;
        s.settle();
        continue;
      }
      intro ||= s.cfg.intro;
      // page 'load' = in-view
      const trigger = mode === 'page' && s.cfg.trigger === 'load' ? 'in-view' : s.cfg.trigger;
      if (trigger === 'scroll') (nearNow(s.root) ? held : lazy).push(s);
      else if (trigger === 'load' || (trigger === 'in-view' && nearNow(s.root))) now.push(s);
      else if (trigger === 'in-view') lazy.push(s);
    }
    if (intro) held.push(...now.splice(0));
    if (held.length || intro) {
      const eng = getEngine();
      markReady();
      for (const s of held) eng.hold(s.root);
      const byScroll = held.some((s) => s.cfg.trigger === 'scroll');
      const evs = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'scroll'];
      let timer = 0;
      const off = () => {
        for (const e of evs) win.removeEventListener(e, go, true);
        win.clearTimeout(timer);
        cleanups.delete(off);
      };
      const go = () => {
        off();
        for (const s of held) begin(s);
      };
      for (const e of evs) win.addEventListener(e, go, { capture: true, passive: true });
      if (intro) eng.intro(typeof intro === 'string' ? resolveTarget(intro) : null, go);
      // no scroll: start after the failsafe (or INTRO_MS for an intro)
      timer = win.setTimeout(go, byScroll ? (held[0]?.cfg.failsafe ?? 15000) : INTRO_MS);
      cleanups.add(off);
    }
    const started = now.length > 0;
    // cu-ready first so preload.css does not hide what the scanner measures
    if (started) markReady();
    const inView = now.map((s) => seen(s.root));
    now.forEach((s, i) => begin(s, inView[i]));
    if (lazy.length) {
      if (typeof g.IntersectionObserver === 'undefined') {
        markReady();
        for (const s of lazy) startSlot(s, mode);
      } else {
        observer = new g.IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              const s = bySlot.get(en.target);
              if (!en.isIntersecting || !s) continue;
              observer?.unobserve(en.target);
              bySlot.delete(en.target);
              markReady();
              begin(s);
            }
          },
          { rootMargin: '100% 0px' },
        );
        cleanups.add(stop);
        for (const s of lazy) {
          bySlot.set(s.root, s);
          observer.observe(s.root);
        }
      }
    }
    // manual only: nothing is hidden yet
    if (!started && lazy.length === 0) markReady();
    return run;
  }

  function pageAreas(): Element[] {
    const body = doc.body;
    if (!body) return [];
    const usable = (el: Element) => !SKIP_TAGS.has(el.localName) && !el.hasAttribute('data-cu-skip');
    const sections = [...doc.querySelectorAll('[data-cu-section]')].filter(usable);
    return sections.length ? sections : [...body.children].filter(usable);
  }

  function resolveTarget(target: string | Element | undefined): Element | null {
    if (typeof target !== 'string') return target ?? null;
    try {
      return doc.querySelector(target);
    } catch {
      return null;
    }
  }

  /** Show what was hidden under `root` after a failed transition. */
  const reveal = (run: Run | null) => run?.cancel();

  const api: Curchestra = {
    page(opts) {
      if (pageRun) return pageRun;
      const run = group(pageAreas(), 'page', opts);
      pageRun = run;
      return run;
    },

    section(target, opts) {
      const root = resolveTarget(target);
      if (!root) return doneRun();
      if (engine) {
        const existing = engine.areaFor(root);
        if (existing) return existing;
      }
      return group([root], 'section', opts, { trigger: 'in-view' });
    },

    async transition(update, opts) {
      const { root: rootOpt, ...rest } = opts ?? {};
      const root = resolveTarget(rootOpt) ?? doc.body;
      if (!root) {
        await update();
        return;
      }
      const cfg = areaConfig(root, rest);
      let eng: Engine | null = null;
      try {
        if (!reduced(cfg)) eng = getEngine();
      } catch (err) {
        console.error('[curchestra]', err);
      }
      if (!eng) {
        await update();
        return;
      }
      /** A selector may match a new element after the update. */
      const current = () => {
        if (typeof rootOpt === 'string' && !root.isConnected) return resolveTarget(rootOpt) ?? doc.body;
        return root;
      };
      let run: Run | null = null;
      const add = () => {
        markReady();
        run = eng.addArea(current(), cfg, 'transition');
      };

      if (typeof doc.startViewTransition === 'function') {
        let failure: { error: unknown } | null = null;
        const vt = doc.startViewTransition(async () => {
          try {
            await update();
          } catch (error) {
            failure = { error };
            throw error;
          }
          add();
        });
        vt.ready.catch(() => {});
        vt.updateCallbackDone.catch(() => {});
        try {
          await vt.finished;
        } catch {
          // a failed update is reported below
        }
        if (failure) {
          reveal(run);
          throw (failure as { error: unknown }).error;
        }
        await (run as Run | null)?.done;
        return;
      }

      const fade: Animation | null =
        typeof root.animate === 'function'
          ? root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' })
          : null;
      try {
        await fade?.finished;
      } catch {
        // cancelled elsewhere: carry on
      }
      try {
        await update();
      } catch (error) {
        fade?.cancel();
        reveal(run);
        throw error;
      }
      add();
      fade?.cancel();
      await (run as Run | null)?.done;
    },

    pause: () => engine?.pause(),
    resume: () => engine?.resume(),
    finish() {
      for (const r of [...groups]) r.finish();
      engine?.finishAll();
    },
    destroy() {
      for (const r of [...groups]) r.cancel();
      for (const c of [...cleanups]) c();
      engine?.destroy();
      engine = null;
      pageRun = null;
      for (const s of subs) s.off = null;
    },
    on(e, fn) {
      const sub = { e, fn, off: engine ? engine.on(e, fn) : null };
      subs.add(sub);
      return () => {
        sub.off?.();
        subs.delete(sub);
      };
    },
  };
  return api;
}
