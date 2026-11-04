import type { Host, Rect, RevealOp } from '../types';

const CSS = '[data-cu="h"]{visibility:hidden!important}[data-cu="v"]{visibility:visible!important}';
const styleRefs = new WeakMap<Document, number>();
const clipped = new Set<Element>();
/** Elements we transformed, with their own inline transform. */
const moved = new Map<Element, { t: string; o: string }>();

function unmove(el: Element): void {
  const was = moved.get(el);
  if (!was) return;
  const st = (el as HTMLElement).style;
  st.transform = was.t;
  st.transformOrigin = was.o;
  moved.delete(el);
}

/** Clear our clip and transform on `el`. */
function restore(el: Element): void {
  if (clipped.delete(el)) (el as HTMLElement).style.clipPath = '';
  unmove(el);
}

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

/** Clip for typed text at `progress` (0..1); `box` text reveals full-height bands per line. */
export function clipPolygon(elRect: Rect, lines: Rect[], progress: number, rtl: boolean, box = false): string {
  const zero = 'polygon(0px 0px, 0px 0px, 0px 0px)';
  const total = lines.reduce((a, l) => a + l.w, 0);
  if (!(progress > 0) || lines.length === 0 || total <= 0) return zero;
  const covered = Math.min(1, progress) * total;
  if (box) {
    const W = elRect.w;
    const H = elRect.h;
    const edge: [number, number][] = [];
    let start = 0;
    let top = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const frac = l.w > 0 ? Math.min(1, Math.max(0, (covered - start) / l.w)) : 0;
      start += l.w;
      if (frac <= 0) break;
      const bot = i === lines.length - 1 ? H : Math.max(top, l.y - elRect.y + l.h);
      const caret = rtl ? l.x - elRect.x + l.w * (1 - frac) : l.x - elRect.x + l.w * frac;
      const x = frac >= 1 ? (rtl ? 0 : W) : caret;
      edge.push([x, top], [x, bot]);
      top = bot;
    }
    if (edge.length === 0) return zero;
    const side = rtl ? W : 0;
    const pts: [number, number][] = [[side, 0], ...edge, [side, top]];
    return `polygon(${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(', ')})`;
  }
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
        let er = o.elRect;
        if (!er) {
          const r = el.getBoundingClientRect();
          er = { x: r.left, y: r.top, w: r.width, h: r.height };
        }
        (el as HTMLElement).style.clipPath = clipPolygon(
          er,
          o.lines,
          o.progress,
          o.rtl,
          o.box,
        );
        clipped.add(el);
        break;
      }
      case 'unclip':
        (el as HTMLElement).style.clipPath = '';
        clipped.delete(el);
        break;
      case 'xform': {
        const st = (el as HTMLElement).style;
        if (o.dx === 0 && o.dy === 0 && o.s === 1) {
          unmove(el);
          break;
        }
        if (!moved.has(el)) moved.set(el, { t: st.transform, o: st.transformOrigin });
        st.transformOrigin = '0 0';
        st.transform = `translate(${f(o.dx)}, ${f(o.dy)})${o.s !== 1 ? ` scale(${Math.round(o.s * 1000) / 1000})` : ''}`;
        break;
      }
    }
  }
}

/** Show the root and its pieces, clear clips. */
export function revealArea(root: Element, pieces: Element[]): void {
  for (const el of [root, ...pieces]) {
    el.setAttribute('data-cu', 'v');
    restore(el);
  }
}

/** Drop marks and clips under `root`, except inside `keep` (still building). */
export function unmarkArea(root: Element, keep: Element[]): void {
  const drop = (el: Element) => {
    restore(el);
    el.removeAttribute('data-cu');
  };
  drop(root);
  for (const el of root.querySelectorAll('[data-cu]')) if (!keep.some((k) => k.contains(el))) drop(el);
}

export function revealAll(doc: Document): void {
  for (const el of clipped) (el as HTMLElement).style.clipPath = '';
  clipped.clear();
  for (const el of [...moved.keys()]) unmove(el);
  doc.querySelectorAll('[data-cu]').forEach((el) => el.removeAttribute('data-cu'));
  doc.querySelectorAll('style[data-cu-style]').forEach((s) => s.remove());
  styleRefs.delete(doc);
}
