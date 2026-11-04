import { resolveConfig, readDataAttrs } from '../config/resolve';
import { validate } from '../config/validate';
import { createEngine } from '../engine/engine';
import { browserHost } from '../host/host';
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

// Dev-only code (R25) is guarded by the literal `process.env.NODE_ENV !== 'production'` at each use:
// a named constant is not constant-folded by bundlers, the literal comparison is.

const FADE_MS = 180;
const SKIP_TAGS = new Set(['script', 'style', 'link', 'template', 'noscript']);

const doneRun = (): Run => ({ done: Promise.resolve(), finish() {}, cancel() {} });

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `doc` accepts `s` as a selector. An invalid one would throw inside the scanner. */
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

/** A group of areas behind one aggregate Run; areas may still be waiting for their trigger. */
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

  /** The layer that reaches resolveConfig: validated in dev, minimally sanitized otherwise. */
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
      // Sound is an optional chunk: it is only fetched when the site asks for it.
      if (cfg.sound) {
        const sound = cfg.sound;
        import('../audio/index')
          .then((m) => {
            if (engine === eng) eng.use(m.createAudio(sound));
          })
          .catch((err) => console.error('[curchestra]', err));
      }
      for (const s of subs) s.off = engine.on(s.e, s.fn);
    }
    return engine;
  }

  const markReady = () => doc.documentElement.classList.add('cu-ready');

  let warnedInstance = false;
  /**
   * seed, theme, zIndex and agents.showNames belong to the shared canvas and RNG (R27); skipOnClick
   * and sound are wired once per instance (safety listeners, the audio plugin).
   */
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

  function startSlot(slot: Slot, mode: Mode): void {
    if (slot.started) return;
    slot.started = true;
    const run = getEngine().addArea(slot.root, slot.cfg, mode);
    slot.run = run;
    run.done.then(slot.settle);
  }

  /** One aggregate Run over `roots`, each started by its own trigger. */
  function group(roots: Element[], mode: Mode, opts: unknown, base?: DeepPartial<Config>): Run {
    const slots: Slot[] = roots.map((root) => {
      let settle!: () => void;
      const done = new Promise<void>((r) => (settle = r));
      return { root, cfg: areaConfig(root, opts, base), started: false, run: null, settle, done };
    });
    let observer: IntersectionObserver | null = null;
    const bySlot = new Map<Element, Slot>();

    const stop = () => {
      observer?.disconnect();
      observer = null;
      cleanups.delete(stop);
    };
    /** Never-started areas were never hidden: just settle them. */
    const end = (how: 'finish' | 'cancel') => {
      stop();
      for (const s of slots) {
        if (s.run) s.run[how]();
        else s.settle();
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

    // Areas the observer would fire for at once start now, in this task. Every position is read
    // before the first scan and hide, so no read follows a write.
    const vh = host!.viewport().h;
    const nearNow = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.bottom >= -vh && r.top <= 2 * vh;
    };
    const now: Slot[] = [];
    const lazy: Slot[] = [];
    for (const s of slots) {
      // R31: in page mode 'load' means "now if near the viewport, else as it approaches".
      const trigger = mode === 'page' && s.cfg.trigger === 'load' ? 'in-view' : s.cfg.trigger;
      if (trigger === 'load' || (trigger === 'in-view' && nearNow(s.root))) now.push(s);
      else if (trigger === 'in-view') lazy.push(s);
    }
    const started = now.length > 0;
    // R30: cu-ready first, so preload.css is not hiding what the scanner measures (same task, no paint).
    if (started) markReady();
    for (const s of now) startSlot(s, mode);
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
              startSlot(s, mode);
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
    // Nothing will be hidden until a trigger fires (manual only): do not keep preload.css hiding it.
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

  /** Reveal whatever the engine hid under `root` after a failed transition. */
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
      if (cfg.reducedMotion === 'respect' && host.reducedMotion()) {
        await update();
        return;
      }
      const eng = getEngine();
      /** The selector may now match a new element; an Element root is kept. */
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
          // A failed update is reported below; anything else just means no animation.
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
