import { revealArea } from '../reveal/reveal';
import type { Config, Engine, Host, Mode, Run } from '../types';

/** Log a recovered failure; callers then reveal everything. */
export function reportError(host: Host, err: unknown): void {
  (host.win as unknown as typeof globalThis).console.error('[curchestra]', err);
}

const resolvedRun = (): Run => ({ done: Promise.resolve(), finish() {}, cancel() {} });

/**
 * Safety net around an engine: failsafe timer, error recovery around addArea,
 * reduced motion, skip-on-click/focus and live removals. Returns a disposer.
 */
export function attachSafety(engine: Engine, host: Host, cfg: Config): () => void {
  const win = host.win;
  const g = win as unknown as typeof globalThis;
  const doc = host.doc;
  const original = engine.addArea.bind(engine);
  const observers = new Set<MutationObserver>();
  const active = new Set<Run>();
  let timer = 0;
  let off = false;

  const clearTimer = () => {
    if (timer) win.clearTimeout(timer);
    timer = 0;
  };
  const offComplete = engine.on('complete', clearTimer);

  function watch(root: Element, run: Run): void {
    const mo = new g.MutationObserver((recs) => {
      if (recs.some((r) => r.removedNodes.length > 0)) engine.__prune(root);
    });
    mo.observe(root, { childList: true, subtree: true });
    observers.add(mo);
    active.add(run);
    const stop = () => {
      mo.disconnect();
      observers.delete(mo);
      active.delete(run);
      // However the last area ended (finish, cancel, failsafe), disarm the timer.
      if (active.size === 0) clearTimer();
    };
    run.done.then(stop, stop);
  }

  engine.addArea = (root: Element, area: Config, mode: Mode): Run => {
    if (off) return original(root, area, mode);
    if (area.reducedMotion === 'respect' && host.reducedMotion()) return resolvedRun();
    let run: Run;
    try {
      run = original(root, area, mode);
    } catch (err) {
      reportError(host, err);
      engine.finishAll();
      revealArea(root, [...root.querySelectorAll('[data-cu]')]);
      return resolvedRun();
    }
    watch(root, run);
    if (!timer && area.failsafe > 0 && Number.isFinite(area.failsafe)) {
      timer = win.setTimeout(() => {
        timer = 0;
        engine.finishAll();
      }, area.failsafe);
    }
    return run;
  };

  /** The unfinished run for a pointer position, even over hidden (unhittable) content. */
  function runAt(target: EventTarget | null, x: number | null, y: number | null): Run | null {
    if (target instanceof g.Element) {
      const r = engine.areaFor(target);
      if (r) return r;
    }
    if (x === null || y === null) return null;
    for (const el of doc.querySelectorAll('[data-cu="h"]')) {
      const b = el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
        const r = engine.areaFor(el);
        if (r) return r;
      }
    }
    return null;
  }

  const onDown = (e: Event) => {
    const p = e as PointerEvent;
    runAt(e.target, p.clientX, p.clientY)?.finish();
  };
  const onFocus = (e: Event) => {
    runAt(e.target, null, null)?.finish();
  };
  // Hidden content cannot take focus, so Tab would skip it: reveal before the browser moves focus.
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Tab' && active.size > 0) engine.finishAll();
  };
  if (cfg.skipOnClick) {
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('focusin', onFocus, true);
  }

  return () => {
    off = true;
    clearTimer();
    offComplete();
    for (const mo of observers) mo.disconnect();
    observers.clear();
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
