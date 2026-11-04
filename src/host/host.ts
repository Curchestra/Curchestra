import type { Host } from '../types';

export function browserHost(win?: Window): Host | null {
  if (!win) {
    if (typeof window === 'undefined') return null;
    win = window;
  }
  const w = win;
  const doc = w.document;
  return {
    win: w,
    doc,
    now: () => w.performance.now(),
    raf: (cb) => w.requestAnimationFrame(cb),
    caf: (id) => w.cancelAnimationFrame(id),
    scroll: () => ({ x: w.scrollX, y: w.scrollY }),
    viewport: () => ({ w: doc.documentElement.clientWidth, h: w.innerHeight }),
    dpr: () => w.devicePixelRatio || 1,
    reducedMotion: () => w.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hidden: () => doc.visibilityState === 'hidden',
  };
}
