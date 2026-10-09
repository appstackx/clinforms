import "server-only";

/**
 * Geometry helpers for readPdfForm (forms/pdf-outline.ts), kept apart so the outline stays readable:
 *
 * - widgetOptionLabels: the label printed beside each tick-box / radio widget – the nearest text on
 *   the same line just right of the box (preferred) or just left of it. Real forms do both: Bupa prints
 *   "Miss ○ Mrs ○ …" labels right of each radio button, Freedom prints "Yes ☐  No ☐" labels left.
 * - detectCharGroups: runs of 6–8 one-character text boxes on one line (equal width ≤ 20 pt, touching
 *   in x), e.g. AXA's date boxes D D M M Y Y Y Y – one question, one character per box.
 * - charGroupNearbyText: the label of such a run – the text left of it (lines joined, glyph-split
 *   words such as a drop-cap "D" + "ate of diagnosis" rejoined), the text above it, and the D/M/Y
 *   letters printed inside the boxes as one hint ("DDMMYYYY").
 *
 * Pure functions of rectangles and positioned text (PDF points, origin bottom-left).
 *
 * Owner: forms-engine agent.
 */

export type Rect = { x: number; y: number; width: number; height: number };
/** Positioned page text: x/y = start of the baseline, w = advance width, h = font height. */
export type TextItem = { str: string; x: number; y: number; w: number; h: number };

/** Gap (pt) within which text right of a box is its label. */
const RIGHT_LABEL_GAP = 40;
/** Gap (pt) within which text left of a box is its label (a little less likely than right). */
const LEFT_LABEL_GAP = 30;
const LEFT_PENALTY = 4;

function sameLine(it: TextItem, r: Rect): boolean {
  return Math.abs(it.y + it.h / 2 - (r.y + r.height / 2)) < Math.max(r.height, 10);
}

/** The label printed beside one tick box / radio button ("" when none is close enough). */
export function widgetOptionLabel(r: Rect, items: TextItem[]): string {
  let best: { str: string; score: number } | null = null;
  for (const it of items) {
    const str = it.str.trim();
    if (!str || !sameLine(it, r)) continue;
    const right = it.x + it.w;
    let score: number | null = null;
    if (it.x >= r.x + r.width - 2 && it.x - (r.x + r.width) < RIGHT_LABEL_GAP) score = it.x - (r.x + r.width);
    else if (right <= r.x + 2 && r.x - right < LEFT_LABEL_GAP) score = r.x - right + LEFT_PENALTY;
    if (score !== null && (!best || score < best.score)) best = { str, score };
  }
  return best?.str ?? "";
}

/** One label per widget, in widget order (each widget looked up on its own page). */
export function widgetOptionLabels(widgets: Array<{ page: number; rect: Rect }>, itemsByPage: Map<number, TextItem[]>): string[] {
  return widgets.map((w) => widgetOptionLabel(w.rect, itemsByPage.get(w.page) ?? []));
}

/* ------------------------------------------------------------------------------------------------
 * One-character boxes
 * ----------------------------------------------------------------------------------------------*/

export interface CharCellCandidate {
  name: string;
  /** 1-based page. */
  page: number;
  rect: Rect;
}

export const CHAR_GROUP_MIN = 6;
export const CHAR_GROUP_MAX = 8;
const CHAR_MAX_WIDTH = 20;
const CHAR_MIN_WIDTH = 4;
/** Same line: bottoms and heights within this many points. */
const LINE_TOLERANCE = 1.5;
/** Equal width: within this many points. */
const WIDTH_TOLERANCE = 1.5;
/** Touching: the gap between neighbouring boxes is at most this (overlap up to the same). */
const TOUCH_GAP = 3;

/**
 * Runs of 6–8 single-line text boxes on one line, equal width ≤ 20 pt, touching in x. Callers pass
 * single-widget, single-line text fields only. Returns each run's field names, left to right.
 */
export function detectCharGroups(cells: CharCellCandidate[]): string[][] {
  const narrow = cells.filter((c) => c.rect.width <= CHAR_MAX_WIDTH && c.rect.width >= CHAR_MIN_WIDTH && c.rect.height >= CHAR_MIN_WIDTH);
  const groups: string[][] = [];
  const pages = Array.from(new Set(narrow.map((c) => c.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const onPage = narrow.filter((c) => c.page === page).sort((a, b) => b.rect.y - a.rect.y || a.rect.x - b.rect.x);
    // Lines: same bottom and height.
    const lines: CharCellCandidate[][] = [];
    for (const c of onPage) {
      const line = lines.find((l) => Math.abs(l[0].rect.y - c.rect.y) <= LINE_TOLERANCE && Math.abs(l[0].rect.height - c.rect.height) <= LINE_TOLERANCE);
      if (line) line.push(c);
      else lines.push([c]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.rect.x - b.rect.x);
      let run: CharCellCandidate[] = [];
      const flush = () => {
        if (run.length >= CHAR_GROUP_MIN && run.length <= CHAR_GROUP_MAX) groups.push(run.map((c) => c.name));
        run = [];
      };
      for (const c of line) {
        const prev = run[run.length - 1];
        const touching = prev && Math.abs(c.rect.x - (prev.rect.x + prev.rect.width)) <= TOUCH_GAP;
        const sameWidth = prev && Math.abs(c.rect.width - run[0].rect.width) <= WIDTH_TOLERANCE;
        if (prev && !(touching && sameWidth)) flush();
        run.push(c);
      }
      flush();
    }
  }
  return groups;
}

/** Text items on one line joined left to right; pieces that touch (a drop cap and its word) without a space. */
function joinLine(items: TextItem[]): string {
  let out = "";
  let end = -Infinity;
  for (const it of items.slice().sort((a, b) => a.x - b.x)) {
    const s = it.str.trim();
    if (!s) continue;
    out += out && it.x - end > 1.5 ? ` ${s}` : s;
    end = it.x + it.w;
  }
  return out;
}

function linesOf(items: TextItem[]): TextItem[][] {
  const lines: TextItem[][] = [];
  for (const it of items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= 3);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines;
}

/**
 * Nearby text of a run of character boxes (its union rectangle): the label left of it, the text just
 * above it, and the D/M/Y letters printed inside the boxes ("DDMMYYYY"), joined with " | ".
 */
export function charGroupNearbyText(union: Rect, items: TextItem[]): string {
  const top = union.y + union.height;
  const left = items.filter((it) => {
    const right = it.x + it.w;
    const overlapsBand = it.y < top + 4 && it.y + Math.max(it.h, 4) > union.y - 4;
    return it.str.trim() && overlapsBand && right <= union.x + 2 && union.x - right < 220;
  });
  const leftLabel = linesOf(left)
    .map(joinLine)
    .filter(Boolean)
    .join(" ");
  const above = items
    .filter((it) => it.str.trim() && it.y >= top - 3 && it.y - top < 34 && it.x < union.x + union.width && it.x + it.w > union.x - 12)
    .sort((a, b) => a.y - b.y);
  const aboveLabel = above.length ? joinLine(above.filter((it) => Math.abs(it.y - above[0].y) <= 3)) : "";
  const inside = items
    .filter((it) => it.x >= union.x - 1 && it.x <= union.x + union.width && it.y >= union.y - 2 && it.y <= top)
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str.trim())
    .join("");
  const hint = /^[DMY]{4,10}$/i.test(inside) ? inside.toUpperCase() : "";
  const seen = new Set<string>();
  return [leftLabel, aboveLabel, hint]
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t && !seen.has(t) && (seen.add(t), true))
    .join(" | ")
    .slice(0, 240);
}
