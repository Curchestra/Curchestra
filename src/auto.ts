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
  if (mode !== 'page' && mode !== 'section') return;
  const preset = script!.getAttribute('data-preset');
  const swarm = curchestra(preset ? { preset: preset as 'calm' | 'default' | 'frenzy' } : undefined);
  if (mode === 'page') swarm.page();
  else document.querySelectorAll('[data-cu-section]').forEach((el) => swarm.section(el));
}

if (typeof window !== 'undefined') {
  window.Curchestra = { curchestra };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

// The IIFE's globalName assigns these exports to window.Curchestra when the script finishes.
export { curchestra };
