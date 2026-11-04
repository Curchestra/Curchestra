/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import { curchestra } from './index';

declare global {
  interface Window {
    Curchestra?: { curchestra: typeof curchestra };
  }
}

// Captured at evaluation time: it is null once the script has finished running.
const script = typeof document !== 'undefined' ? document.currentScript : null;

function boot(): void {
  const mode = script?.getAttribute('data-curchestra');
  if (mode !== 'page' && mode !== 'section') {
    // nothing will build: unhide now
    document.documentElement.classList.add('cu-ready');
    return;
  }
  const preset = script!.getAttribute('data-preset');
  const orchestra = curchestra(preset ? { preset: preset as 'calm' | 'default' | 'frenzy' } : undefined);
  if (mode === 'page') orchestra.page();
  else document.querySelectorAll('[data-cu-section]').forEach((el) => orchestra.section(el));
}

if (typeof window !== 'undefined') {
  window.Curchestra = { curchestra };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

// exposed as window.Curchestra
export { curchestra };
