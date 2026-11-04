import { unmarkArea } from '../reveal/reveal';
import type { Config, Engine, Host, Mode, Run } from '../types';

/** Log a recovered failure; callers then reveal everything. */
export function reportError(host: Host, err: unknown): void {
  (host.win as unknown as typeof globalThis).console.error('[curchestra]', err);
}

const resolvedRun = (): Run => ({ done: Promise.resolve(), finish() {}, cancel() {} });

/** Failsafe, error recovery, reduced motion, skip on click/focus and live removals. */
export function attachSafety(engine: Engine, host: Host, cfg: Config): () => void {
  const win = host.win;
  const g = win as unknown as typeof globalThis;
  const doc = host.doc;
  const original = engine.addArea.bind(engine);
  const observers = new Set<MutationObserver>();
  /** active runs and their failsafe timers */
  const active = new Map<Run, number>();
  let off = false;

  /** Watch removals and arm the failsafe from the area's start. */
  function watch(root: Element, run: Run, failsafe: number): void {
    const mo = new g.MutationObserver((recs) => {
      if (recs.some((r) => r.removedNodes.length > 0)) engine.__prune(root);
    });
    mo.observe(root, { childList: true, subtree: true });
    observers.add(mo);
    const timer = failsafe > 0 && Number.isFinite(failsafe) ? win.setTimeout(() => run.finish(), failsafe) : 0;
    active.set(run, timer);
    const stop = () => {
      mo.disconnect();
      observers.delete(mo);
      // disarm however it ended
      const t = active.get(run);
      if (t) win.clearTimeout(t);
      active.delete(run);
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
      unmarkArea(root, []);
      return resolvedRun();
    }
    // a root inside an active area is already watched
    if (!active.has(run)) watch(root, run, area.failsafe);
    return run;
  };

  /** Unfinished run at a pointer position, even over hidden content. */
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

  /** last pointer press; focus right after it is a click, not keyboard */
  let pressedAt = -Infinity;
  const onPress = () => {
    pressedAt = host.now();
  };
  const onDown = (e: Event) => {
    const p = e as PointerEvent;
    runAt(e.target, p.clientX, p.clientY)?.finish();
  };
  const onFocus = (e: Event) => {
    if (host.now() - pressedAt < 500) return;
    runAt(e.target, null, null)?.finish();
  };
  // hidden content cannot take focus: reveal before Tab moves it
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Tab' && active.size > 0) engine.finishAll();
  };
  // keyboard always reveals; clicks skip only with skipOnClick
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('pointerdown', onPress, true);
  if (cfg.skipOnClick) doc.addEventListener('pointerdown', onDown, true);

  return () => {
    off = true;
    for (const t of active.values()) if (t) win.clearTimeout(t);
    active.clear();
    for (const mo of observers) mo.disconnect();
    observers.clear();
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
