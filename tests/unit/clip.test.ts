import { describe, expect, it } from 'vitest';
import { clipPolygon } from '../../src/reveal/reveal';

function parse(s: string): [number, number][] {
  const m = /^polygon\((.*)\)$/.exec(s)!;
  return m[1].split(',').map((p) => {
    const [x, y] = p.trim().split(/\s+/).map((v) => parseFloat(v));
    return [x, y] as [number, number];
  });
}
function area(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const el = { x: 100, y: 200, w: 100, h: 40 };
const two = [
  { x: 100, y: 200, w: 100, h: 20 },
  { x: 100, y: 220, w: 100, h: 20 },
];

describe('clipPolygon', () => {
  it('progress 0 is empty', () => {
    expect(area(parse(clipPolygon(el, two, 0, false)))).toBe(0);
  });
  it('progress 1 covers all lines', () => {
    expect(area(parse(clipPolygon(el, two, 1, false)))).toBeCloseTo(4000);
  });
  it('2 equal lines at 0.75: line 1 full, line 2 half', () => {
    const pts = parse(clipPolygon(el, two, 0.75, false));
    expect(area(pts)).toBeCloseTo(100 * 20 + 50 * 20);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(100);
  });
  it('is relative to elRect in px', () => {
    const pts = parse(clipPolygon(el, two, 1, false));
    expect(Math.min(...pts.map((p) => p[0]))).toBe(0);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(0);
  });
  it('rtl at 0.5 on one line covers the right half', () => {
    const one = [{ x: 100, y: 200, w: 100, h: 20 }];
    const pts = parse(clipPolygon(el, one, 0.5, true));
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(50);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(100);
    expect(area(pts)).toBeCloseTo(1000);
  });
});

describe('clipPolygon on a text panel (box)', () => {
  // a 200x100 panel with 20 px padding and two 160x20 lines of code
  const panel = { x: 0, y: 0, w: 200, h: 100 };
  const code = [
    { x: 20, y: 20, w: 160, h: 20 },
    { x: 20, y: 40, w: 160, h: 20 },
  ];

  it('progress 0 is empty, progress 1 is the whole panel (padding included)', () => {
    expect(area(parse(clipPolygon(panel, code, 0, false, true)))).toBe(0);
    expect(area(parse(clipPolygon(panel, code, 1, false, true)))).toBe(200 * 100);
  });

  it('halfway through the first line: a band from the top edge, wiped up to the caret', () => {
    // caret at 20 + 80 = 100; band from y 0 to the line bottom (40)
    expect(area(parse(clipPolygon(panel, code, 0.25, false, true)))).toBe(100 * 40);
  });

  it('first line done, second half typed: the first band is full width, the last band runs to the bottom', () => {
    // band 1: 200 x 40; band 2: caret at 100, from 40 to the panel bottom (60 tall)
    expect(area(parse(clipPolygon(panel, code, 0.75, false, true)))).toBe(200 * 40 + 100 * 60);
  });

  it('rtl wipes from the right edge', () => {
    const pts = parse(clipPolygon(panel, code, 0.25, true, true));
    expect(area(pts)).toBe(100 * 40);
    expect(Math.min(...pts.map(([x]) => x))).toBe(100);
  });
});
