import "server-only";

/**
 * Printed answer boxes and tick boxes of a FLAT PDF, from the page's vector drawing (pdf.js operator
 * list): every rectangle that is stroked or filled, with the current transformation matrix tracked
 * through save/restore, `cm` and form XObjects.
 *
 * - kind "tick": a small square (sides within 20 % of each other, at most TICK_MAX_SIDE). Aviva CM016's
 *   tick boxes are 16.8 pt squares, so the limit is a little above that.
 * - kind "box": any other rectangle at least 20 × 8 pt.
 * - Kept only when nothing is printed inside (an empty answer space); a rectangle that holds other
 *   boxes is a frame or a table outline and is dropped; duplicates (fill + stroke of one box) are one.
 * - `slots`: printed separators inside a box (the "/" of a "__ / __ / ____" date box – drawn as short
 *   strokes or printed as text – or vertical dividers) split it into writable slots, left to right. A
 *   row of four or more touching squares (a comb of single-character cells) becomes one box whose
 *   slots are the cells.
 * - `rules`: horizontal lines ruled across a box (Aviva GEN030 question 5, CM016's three-line GP
 *   address box) – the y of each, top to bottom. The answer is then written one line per ruled row,
 *   on the line, never struck through by it (form-boxes.ts snapOverlay → pdf_overlay `ruledRows`).
 *
 * Coordinates are PDF points in the page's user space (origin bottom-left), the same space as the
 * page text and pdf-lib's drawing, rounded to 0.1 pt.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import type { PdfBox } from "../core/types";

/** Largest side of a square that is treated as a tick box (pt). */
export const TICK_MAX_SIDE = 18;
const MIN_BOX_WIDTH = 20;
const MIN_BOX_HEIGHT = 8;

type Mx = [number, number, number, number, number, number];
const IDENTITY: Mx = [1, 0, 0, 1, 0, 0];
const mul = (m: Mx, n: Mx): Mx => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mx, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A positioned text item as the outline reads it (x, y = baseline start; w, h = size). */
export interface BoxTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parts of a pdf.js page proxy this module uses. */
export interface OperatorListPage {
  getOperatorList(params?: { annotationMode?: number }): Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>;
  view?: number[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Segment {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Path ops of pdf.js 6's constructPath data (DrawOPS). */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

/** Split a pdf.js path into subpaths of points; curves mark a subpath as not straight. */
function subpaths(path: ArrayLike<number>): Array<{ points: Array<[number, number]>; curved: boolean }> {
  const out: Array<{ points: Array<[number, number]>; curved: boolean }> = [];
  let current: { points: Array<[number, number]>; curved: boolean } | null = null;
  for (let k = 0; k < path.length; ) {
    const op = path[k];
    if (op === MOVE) {
      current = { points: [[path[k + 1], path[k + 2]]], curved: false };
      out.push(current);
      k += 3;
    } else if (op === LINE) {
      if (!current) {
        current = { points: [], curved: false };
        out.push(current);
      }
      current.points.push([path[k + 1], path[k + 2]]);
      k += 3;
    } else if (op === CURVE) {
      if (current) current.curved = true;
      k += 7;
    } else if (op === QUAD) {
      if (current) current.curved = true;
      k += 5;
    } else if (op === CLOSE) {
      k += 1;
    } else {
      // Unknown op: stop reading this path rather than misread it.
      break;
    }
  }
  return out;
}

/** The axis-aligned rectangle a straight 4–5 point subpath draws, in page space; null otherwise. */
function rectOf(points: Array<[number, number]>, ctm: Mx): Rect | null {
  const pts = points.map(([x, y]) => apply(ctm, x, y));
  // Drop a repeated closing point.
  if (pts.length === 5 && Math.abs(pts[4][0] - pts[0][0]) < 0.5 && Math.abs(pts[4][1] - pts[0][1]) < 0.5) pts.pop();
  if (pts.length !== 4) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Every corner on the bounding box's corners (axis-aligned rectangle).
  const near = (a: number, b: number) => Math.abs(a - b) < 0.6;
  const corners = pts.every(([x, y]) => (near(x, minX) || near(x, maxX)) && (near(y, minY) || near(y, maxY)));
  if (!corners) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A straight line in page space (a slash or divider candidate); null when it is not a single segment. */
function segmentOf(points: Array<[number, number]>, ctm: Mx): Segment | null {
  if (points.length !== 2) return null;
  const [a, b] = points.map(([x, y]) => apply(ctm, x, y));
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
}

const inside = (inner: Rect, outer: Rect, tol = 0.8) =>
  inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol;

const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

function isSquareTick(r: Rect): boolean {
  const big = Math.max(r.width, r.height);
  return big <= TICK_MAX_SIDE && big >= 5 && Math.abs(r.width - r.height) <= Math.max(1.5, big * 0.2);
}

/** Text printed inside a rectangle (its own separators "/" and "-" do not count). */
function holdsText(r: Rect, items: readonly BoxTextItem[]): boolean {
  return items.some((it) => {
    const t = it.str.replace(/[\s/\-–.]+/g, "");
    if (!t) return false;
    const midY = it.y + Math.max(2, it.h) / 2;
    const midX = it.x + Math.max(1, Math.min(it.w, 6)) / 2;
    return midX > r.x + 1 && midX < r.x + r.width - 1 && midY > r.y + 1 && midY < r.y + r.height - 1;
  });
}

/** Writable slots of a box between the separators printed inside it, left to right. */
function slotsOf(r: Rect, segments: readonly Segment[], items: readonly BoxTextItem[]): Array<{ x: number; width: number }> | undefined {
  const dividers: Array<{ x0: number; x1: number }> = [];
  for (const s of segments) {
    const tall = s.y1 - s.y0 >= r.height * 0.45;
    const within = s.x0 >= r.x + 2 && s.x1 <= r.x + r.width - 2 && s.y0 >= r.y - 1 && s.y1 <= r.y + r.height + 1;
    if (tall && within && s.x1 - s.x0 <= 12) dividers.push({ x0: s.x0, x1: s.x1 });
  }
  for (const it of items) {
    if (it.str.trim() !== "/") continue;
    const midY = it.y + Math.max(2, it.h) / 2;
    if (it.x > r.x + 1 && it.x + it.w < r.x + r.width - 1 && midY > r.y && midY < r.y + r.height) dividers.push({ x0: it.x, x1: it.x + Math.max(it.w, 2) });
  }
  if (dividers.length === 0) return undefined;
  dividers.sort((a, b) => a.x0 - b.x0);
  const slots: Array<{ x: number; width: number }> = [];
  let start = r.x;
  for (const d of dividers) {
    if (d.x0 - start >= 3) slots.push({ x: r1(start), width: r1(d.x0 - start) });
    start = Math.max(start, d.x1);
  }
  if (r.x + r.width - start >= 3) slots.push({ x: r1(start), width: r1(r.x + r.width - start) });
  return slots.length >= 2 ? slots : undefined;
}

/** Closest a ruled line may sit to the box's top or bottom edge, and the smallest row pitch (pt). */
const RULE_EDGE = 3;
const MIN_RULE_PITCH = 9;

/**
 * Horizontal lines ruled across a box (lines to write on), top to bottom: each spans at least 85 % of
 * the box's width and lies inside it, clear of its edges. Undefined when there are none, or when they
 * are packed tighter than a line of writing (shading, hatching).
 */
function rulesOf(r: Rect, segments: readonly Segment[]): number[] | undefined {
  const ys: number[] = [];
  for (const s of segments) {
    if (s.y1 - s.y0 > 0.6) continue;
    const y = (s.y0 + s.y1) / 2;
    const spans = s.x0 <= r.x + r.width * 0.075 + 2 && s.x1 >= r.x + r.width * 0.925 - 2 && s.x1 - s.x0 >= r.width * 0.85;
    const within = s.x0 >= r.x - 2 && s.x1 <= r.x + r.width + 2 && y > r.y + RULE_EDGE && y < r.y + r.height - RULE_EDGE;
    if (spans && within && !ys.some((v) => Math.abs(v - y) < 1)) ys.push(y);
  }
  if (ys.length === 0) return undefined;
  ys.sort((a, b) => b - a);
  const bounds = [r.y + r.height, ...ys, r.y];
  for (let i = 1; i < bounds.length; i += 1) if (bounds[i - 1] - bounds[i] < MIN_RULE_PITCH) return undefined;
  return ys.map(r1);
}

/**
 * Rows of four or more touching squares (single-character cells) → one box per row, with a slot per
 * cell. Returns the merged boxes and the squares left over (real tick boxes).
 */
function mergeCombs(squares: Rect[]): { combs: Array<Rect & { slots: Array<{ x: number; width: number }> }>; rest: Rect[] } {
  const sorted = squares.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Set<number>();
  const combs: Array<Rect & { slots: Array<{ x: number; width: number }> }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(i)) continue;
    const run = [i];
    let last = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const s = sorted[j];
      if (used.has(j) || Math.abs(s.y - last.y) > 1 || Math.abs(s.height - last.height) > 1) continue;
      const gap = s.x - (last.x + last.width);
      if (gap >= -1 && gap <= 3) {
        run.push(j);
        last = s;
      }
    }
    if (run.length >= 4) {
      run.forEach((k) => used.add(k));
      const cells = run.map((k) => sorted[k]);
      const x = cells[0].x;
      const right = cells[cells.length - 1].x + cells[cells.length - 1].width;
      combs.push({ x, y: cells[0].y, width: right - x, height: cells[0].height, slots: cells.map((c) => ({ x: r1(c.x), width: r1(c.width) })) });
    }
  }
  return { combs, rest: sorted.filter((_, i) => !used.has(i)) };
}

/**
 * The empty answer boxes and tick boxes printed on one page. `ops` is pdf.js's OPS table
 * (pdfjs.OPS); `items` the page's positioned text.
 */
export async function extractPageBoxes(page: OperatorListPage, pageNumber: number, ops: Record<string, number>, items: readonly BoxTextItem[]): Promise<PdfBox[]> {
  // The page's own drawing only: form-field appearances (pdf.js AnnotationMode.DISABLE = 0) are not
  // printed boxes, and are drawn in their own coordinate space.
  const list = await page.getOperatorList({ annotationMode: 0 });
  const painted = new Set(
    ["stroke", "closeStroke", "fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"].map((k) => ops[k]).filter((v) => v !== undefined),
  );
  let ctm: Mx = IDENTITY;
  const stack: Mx[] = [];
  const rects: Rect[] = [];
  const segments: Segment[] = [];
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = mul(ctm, args as unknown as Mx);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0] as number[] | null | undefined;
      if (m && m.length === 6) ctm = mul(ctm, m as unknown as Mx);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.constructPath && args) {
      const paint = args[0] as number;
      if (!painted.has(paint)) continue;
      const data = args[1] as ArrayLike<unknown> | null | undefined;
      const path = data?.[0] as ArrayLike<number> | null | undefined;
      if (!path || typeof path !== "object" || typeof (path as ArrayLike<number>).length !== "number") continue;
      for (const sub of subpaths(path)) {
        if (sub.curved) continue;
        const rect = rectOf(sub.points, ctm);
        if (rect) {
          if (rect.width >= 5 && rect.height >= 5) rects.push(rect);
          continue;
        }
        const seg = segmentOf(sub.points, ctm);
        if (seg) segments.push(seg);
      }
    }
  }

  // One entry per drawn rectangle (fill + stroke of the same box).
  const unique: Rect[] = [];
  for (const r of rects) if (!unique.some((u) => sameRect(u, r))) unique.push(r);
  const view = page.view;
  const pageW = view && view.length === 4 ? view[2] - view[0] : 612;
  const pageH = view && view.length === 4 ? view[3] - view[1] : 792;
  const candidates = unique.filter((r) => !(r.width > pageW * 0.85 && r.height > pageH * 0.6));
  // A rectangle that holds other boxes is a frame or a table outline.
  const leaves = candidates.filter((r) => !candidates.some((o) => o !== r && !sameRect(o, r) && inside(o, r) && o.width * o.height < r.width * r.height * 0.9));
  const empty = leaves.filter((r) => !holdsText(r, items));

  const squares = empty.filter(isSquareTick);
  const { combs, rest } = mergeCombs(squares);
  const out: PdfBox[] = [];
  for (const c of combs) out.push({ page: pageNumber, x: r1(c.x), y: r1(c.y), width: r1(c.width), height: r1(c.height), kind: "box", slots: c.slots });
  for (const t of rest) out.push({ page: pageNumber, x: r1(t.x), y: r1(t.y), width: r1(t.width), height: r1(t.height), kind: "tick" });
  for (const b of empty) {
    if (isSquareTick(b) || b.width < MIN_BOX_WIDTH || b.height < MIN_BOX_HEIGHT) continue;
    const slots = slotsOf(b, segments, items);
    // Ruled writing lines (a box with vertical dividers as well is a table, not lines to write on).
    const rules = slots ? undefined : rulesOf(b, segments);
    out.push({ page: pageNumber, x: r1(b.x), y: r1(b.y), width: r1(b.width), height: r1(b.height), kind: "box", ...(slots && { slots }), ...(rules && { rules }) });
  }
  // Reading order: top to bottom, then left to right.
  return out.sort((a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x);
}
