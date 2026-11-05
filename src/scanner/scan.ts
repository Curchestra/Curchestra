/*!
 * curchestra
 * Copyright(c) 2026 JoshLei
 * MIT Licensed
 */

import type { Host, Piece, PieceKind } from '../types';

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link']);
const MEDIA_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'picture', 'embed', 'object']);
const INLINE_DISPLAY = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'none']);
const NON_SPACE = /\S/;

/** Alpha of a computed color string. 'transparent' -> 0; unparseable -> 1 (opaque). */
function alphaOf(c: string): number {
  if (c === 'transparent') return 0;
  if (c.charCodeAt(0) !== 114 /* r */) return 1;
  const open = c.indexOf('(');
  const close = c.lastIndexOf(')');
  if (open < 0 || close < open) return 1;
  const body = c.slice(open + 1, close).trim();
  let a: string | undefined;
  const slash = body.indexOf('/');
  if (slash >= 0) {
    a = body.slice(slash + 1).trim();
  } else if (body.indexOf(',') >= 0) {
    const parts = body.split(',');
    if (parts.length === 4) a = parts[3].trim();
  } else {
    return 1; // space syntax without alpha
  }
  if (a === undefined || a === '') return 1;
  const n = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  return Number.isNaN(n) ? 1 : n;
}

function hasDirectText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && NON_SPACE.test((n as Text).data)) return true;
  }
  return false;
}

function hasBlockChild(el: Element, win: Window, flexy = false): boolean {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'br' || INLINE_DISPLAY.has(win.getComputedStyle(c).display)) continue;
    if (!flexy || (!MEDIA_TAGS.has(c.localName) && hasBlockChild(c, win))) return true;
  }
  return false;
}

export function scan(host: Host, root: Element, opts: { skip: string[]; maxTasks: number }): Piece[] {
  const win = host.win;
  const sc = host.scroll();
  const skipSel = opts.skip.length ? opts.skip.join(',') : '';
  const pieces: Piece[] = [];
  if (opts.maxTasks <= 0) return pieces;

  // stack of [element, parent piece id], preorder
  const els: Element[] = [];
  const parents: (number | null)[] = [];
  const pushChildren = (el: Element, parent: number | null) => {
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) {
      els.push(c);
      parents.push(parent);
    }
  };
  pushChildren(root, null);

  while (els.length) {
    const el = els.pop()!;
    const parent = parents.pop()!;
    if (SKIP_TAGS.has(el.localName)) continue;
    if (el.hasAttribute('data-cu-skip')) continue;
    if (skipSel && el.matches(skipSel)) continue;

    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    const bgImage = cs.backgroundImage;
    const hasBgImage = bgImage !== 'none';
    let kind: PieceKind | null = null;
    let textLen = 0;
    let fontPx: number | undefined;
    let boxed = false;

    if (MEDIA_TAGS.has(el.localName) || el.shadowRoot) {
      kind = 'media';
    } else if (hasBgImage && !NON_SPACE.test(el.textContent || '')) {
      kind = 'media';
    } else if (hasDirectText(el) && !hasBlockChild(el, win, /flex|grid/.test(cs.display))) {
      kind = 'text';
      textLen = (el.textContent || '').trim().length;
      fontPx = parseFloat(cs.fontSize) || undefined;
      boxed = hasBgImage || alphaOf(cs.backgroundColor) > 0 ||
        (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && alphaOf(cs.borderTopColor) > 0);
    } else if (hasBgImage || alphaOf(cs.backgroundColor) > 0) {
      kind = 'box';
    } else if (
      parseFloat(cs.borderTopWidth) > 0 &&
      cs.borderTopStyle !== 'none' &&
      cs.borderTopStyle !== 'hidden' &&
      alphaOf(cs.borderTopColor) > 0
    ) {
      kind = 'line';
    }

    if (kind === null) {
      pushChildren(el, parent);
      continue;
    }

    const id = pieces.length;
    pieces.push({
      id,
      el,
      kind,
      rect: { x: r.left + sc.x, y: r.top + sc.y, w: r.width, h: r.height },
      parent,
      sig: el.localName + '.' + [...el.classList].sort().join('.'),
      textLen,
      rtl: cs.direction === 'rtl',
      fs: fontPx,
      ...(boxed ? { boxed } : {}),
    });
    if (pieces.length >= opts.maxTasks) break;
    if (kind === 'box' || kind === 'line') pushChildren(el, id);
  }
  return pieces;
}
