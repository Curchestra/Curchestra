import type { Host, Rect, RevealOp } from '../types';

const CSS = '[data-cu="h"]{visibility:hidden!important}[data-cu="v"]{visibility:visible!important}';
const styleRefs = new WeakMap<Document, number>();
const clipped = new Set<Element>();

export function installStyles(host: Host): () => void {
  const doc = host.doc;
  const n = styleRefs.get(doc) ?? 0;
  if (n === 0 && !doc.querySelector('style[data-cu-style]')) {
    const s = doc.createElement('style');
    s.setAttribute('data-cu-style', '');
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  styleRefs.set(doc, n + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (styleRefs.get(doc) ?? 1) - 1;
    if (left <= 0) {
      styleRefs.delete(doc);
      doc.querySelector('style[data-cu-style]')?.remove();
    } else styleRefs.set(doc, left);
  };
}

export function markArea(root: Element, pieces: Element[]): void {
  root.setAttribute('data-cu', 'h');
  for (const p of pieces) p.setAttribute('data-cu', 'h');
}

const f = (n: number) => `${Math.round(n * 100) / 100}px`;

export function clipPolygon(elRect: Rect, lines: Rect[], progress: number, rtl: boolean): string {
  const zero = 'polygon(0px 0px, 0px 0px, 0px 0px)';
  const total = lines.reduce((a, l) => a + l.w, 0);
  if (!(progress > 0) || lines.length === 0 || total <= 0) return zero;
  const covered = Math.min(1, progress) * total;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  let start = 0;
  for (const l of lines) {
    const frac = l.w > 0 ? Math.min(1, Math.max(0, (covered - start) / l.w)) : 0;
    start += l.w;
    if (frac <= 0) continue;
    const x = l.x - elRect.x;
    const t = l.y - elRect.y;
    const b = t + l.h;
    const x0 = rtl ? x + l.w * (1 - frac) : x;
    const x1 = rtl ? x + l.w : x + l.w * frac;
    left.push([x0, t], [x0, b]);
    right.push([x1, t], [x1, b]);
  }
  if (left.length === 0) return zero;
  const pts = [...left, ...right.reverse()];
  return `polygon(${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(', ')})`;
}

export function applyOps(ops: RevealOp[]): void {
  for (const o of ops) {
    const el = o.el;
    switch (o.op) {
      case 'hide':
        el.setAttribute('data-cu', 'h');
        break;
      case 'show':
        el.setAttribute('data-cu', 'v');
        break;
      case 'fade':
        el.setAttribute('data-cu', 'v');
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: o.ms, easing: 'ease-out' });
        break;
      case 'clip': {
        el.setAttribute('data-cu', 'v');
        const r = el.getBoundingClientRect();
        (el as HTMLElement).style.clipPath = clipPolygon(
          { x: r.left, y: r.top, w: r.width, h: r.height },
          o.lines,
          o.progress,
          o.rtl,
        );
        clipped.add(el);
        break;
      }
      case 'unclip':
        (el as HTMLElement).style.clipPath = '';
        clipped.delete(el);
        break;
    }
  }
}

export function revealAll(doc: Document): void {
  for (const el of clipped) (el as HTMLElement).style.clipPath = '';
  clipped.clear();
  doc.querySelectorAll('[data-cu]').forEach((el) => el.removeAttribute('data-cu'));
  doc.querySelectorAll('style[data-cu-style]').forEach((s) => s.remove());
  styleRefs.delete(doc);
}
