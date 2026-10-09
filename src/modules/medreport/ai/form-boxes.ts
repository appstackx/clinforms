import "server-only";

/**
 * FLAT PDFs with printed boxes (S2): the answer boxes and tick boxes found by forms/pdf-boxes.ts are
 * the answer spaces, instead of positions guessed from the text.
 *
 * - flatBoxQuestions(): rules mode – one question per answer box (labelled by the text printed to its
 *   left in the label column, else just above it) and one per row of tick boxes (each box labelled by
 *   the word printed beside it: "Yes", "No", …).
 * - snapOverlay(): post-validation, whatever proposed the map – an overlay that falls on a printed box
 *   is written inside that box (inset 2 pt), a date box with printed slashes gets its date slots, a box
 *   ruled with writing lines gets its rows (`ruledRows`: one line of text per printed line), and a
 *   yes/no or choice overlay on tick boxes becomes a `pdf_overlay_ticks` anchor (an X in the chosen box).
 * - asksForBlockCapitals(): the form asks for BLOCK CAPITALS (FormDefinition.uppercase).
 * - renderPdfBoxes(): compact lines for the live analysis outline.
 *
 * Pure (no I/O). Owner: S2 (pdf-tables-flat).
 */
import type { AnswerType, FormAnchor, PdfBox, PdfFormOutline } from "../core/types";
import type { ParsedForm } from "./form-outline";

/** Inset between a printed box's border and the text written in it (pt). */
export const BOX_INSET = 2;
/** Largest gap between two lines of one printed label (pt; 9 pt text is set on 10.8–13 pt lines). */
const LABEL_LINE_GAP = 13.5;
/** How far left of its box a label column starts at most (pt). */
const LABEL_REACH = 200;
/** An option label printed right after its tick box starts within this distance (pt). */
const RIGHT_LABEL_GAP = 12;

type Item = { str: string; x: number; y: number };
type Line = { y: number; x: number; text: string };

const r1 = (n: number) => Math.round(n * 10) / 10;
const topOf = (b: Pick<PdfBox, "y" | "height">) => b.y + b.height;

function pageItems(pdf: PdfFormOutline, page: number): Item[] {
  return (pdf.pageText.find((p) => p.page === page)?.items ?? []).filter((it) => it.str.trim() !== "");
}

/** Items grouped into lines (y within 3 pt), top to bottom; text joined left to right. */
function linesOf(items: readonly Item[]): Line[] {
  const groups: Array<{ y: number; items: Item[] }> = [];
  for (const it of items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
    const g = groups.find((l) => Math.abs(l.y - it.y) <= 3);
    if (g) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  return groups.map((g) => {
    const sorted = g.items.sort((a, b) => a.x - b.x);
    return { y: g.y, x: sorted[0].x, text: sorted.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim() };
  });
}

/** The vertical middle of a text line (baseline + about half the cap height of 9 pt text). */
const lineMid = (l: Pick<Line, "y">) => l.y + 3.5;

/** The text printed just right of a tick box (its option label, e.g. "☐ Yes"), or "". */
export function tickLabel(tick: PdfBox, items: readonly Item[], maxGap = RIGHT_LABEL_GAP): string {
  const right = tick.x + tick.width;
  const near = items
    .filter((it) => it.x >= right - 2 && it.x <= right + maxGap && it.y >= tick.y - 2 && it.y <= topOf(tick))
    .sort((a, b) => a.x - b.x)[0];
  return near ? near.str.replace(/\s+/g, " ").trim() : "";
}

/**
 * The printed option of each tick box in a row (left to right): the words just right of each box
 * ("☐ Yes ☐ No"), else – when every box has text before it – the words between the previous box and
 * this one ("Claims ☐ Specific claim ☐"). A single box without its own words is a plain tick ("Yes").
 */
export function tickRowLabels(row: readonly PdfBox[], items: readonly Item[]): string[] {
  const right = row.map((t) => tickLabel(t, items));
  if (right.every(Boolean)) return right;
  if (row.length === 1) return [right[0] || "Yes"];
  const left = row.map((t, i) => {
    const from = i === 0 ? -Infinity : row[i - 1].x + row[i - 1].width;
    const before = items
      .filter((it) => it.x > from && it.x < t.x - 2 && it.y >= t.y - 2 && it.y <= topOf(t))
      .sort((a, b) => b.x - a.x)[0];
    return before ? before.str.replace(/\s+/g, " ").trim() : "";
  });
  // The first box's "left" text may be the question itself: only use left labels when the others have them.
  if (left.slice(1).every(Boolean) && left[0]) return left;
  return row.map((_, i) => right[i] || `Option ${i + 1}`);
}

/** Where a row of tick boxes and their printed options start (left labels sit before the first box). */
function tickRowStart(row: readonly PdfBox[], labels: readonly string[], items: readonly Item[]): number {
  const first = row[0];
  const lbl = items.find((it) => it.str.replace(/\s+/g, " ").trim() === labels[0] && it.x < first.x && it.y >= first.y - 2 && it.y <= topOf(first));
  return lbl ? lbl.x : first.x;
}

/**
 * The label of an answer region on a page: the lines printed in the label column to its left whose
 * middle lies within the region's height (plus the lines that continue them above and below, when no
 * other box owns them); else the line just above-left of it; else the line just above it.
 */
export function labelFor(region: { page: number; x: number; y: number; width: number; height: number }, pdf: PdfFormOutline, others: readonly PdfBox[]): string {
  const items = pageItems(pdf, region.page);
  const top = region.y + region.height;
  const sameRow = others.filter((b) => b.page === region.page && b.x + b.width <= region.x + 1 && b.y < top && topOf(b) > region.y);
  const leftBound = sameRow.length ? Math.max(...sameRow.map((b) => b.x + b.width)) - 2 : -Infinity;
  const column = linesOf(items.filter((it) => it.x >= leftBound && it.x < region.x - 4));
  // A line belongs to another box when its middle lies within that box's height and the box is just to
  // its right (in the label column's reach).
  const isRegion = (b: PdfBox) => Math.abs(b.x - region.x) < 0.5 && Math.abs(b.y - region.y) < 0.5 && Math.abs(b.width - region.width) < 0.5;
  const owned = (l: Line) =>
    others.some((b) => b.page === region.page && !isRegion(b) && b.x > l.x && b.x - l.x <= LABEL_REACH && lineMid(l) >= b.y - 1 && lineMid(l) <= topOf(b) + 1);
  const anchors = column.filter((l) => lineMid(l) >= region.y - 1 && lineMid(l) <= top + 1);
  let picked: Line[] = anchors.slice();
  if (picked.length === 0) {
    const aboveLeft = column.filter((l) => l.y > top - 1 && l.y <= top + 14 && !owned(l)).sort((a, b) => a.y - b.y)[0];
    if (aboveLeft) picked = [aboveLeft];
  }
  if (picked.length === 0) {
    const above = linesOf(items.filter((it) => it.x >= region.x - 4 && it.x < region.x + region.width && it.y > top - 1 && it.y <= top + 22)).sort((a, b) => a.y - b.y)[0];
    return above ? above.text : "";
  }
  // Continue upwards and downwards through the same label.
  const sorted = column.slice().sort((a, b) => b.y - a.y);
  let hi = sorted.indexOf(picked[0]);
  let lo = sorted.indexOf(picked[picked.length - 1]);
  while (hi > 0 && sorted[hi - 1].y - sorted[hi].y <= LABEL_LINE_GAP && !owned(sorted[hi - 1])) hi -= 1;
  while (lo < sorted.length - 1 && sorted[lo].y - sorted[lo + 1].y <= LABEL_LINE_GAP && !owned(sorted[lo + 1])) lo += 1;
  return sorted
    .slice(hi, lo + 1)
    .map((l) => l.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The tick boxes grouped into rows (same line), top to bottom, each row left to right. */
function tickRows(boxes: readonly PdfBox[]): PdfBox[][] {
  const ticks = boxes.filter((b) => b.kind === "tick").sort((a, b) => topOf(b) - topOf(a) || a.x - b.x);
  const rows: PdfBox[][] = [];
  for (const t of ticks) {
    const row = rows.find((r) => r[0].page === t.page && Math.abs(r[0].y - t.y) <= 3);
    if (row) row.push(t);
    else rows.push([t]);
  }
  rows.forEach((r) => r.sort((a, b) => a.x - b.x));
  return rows;
}

export interface FlatBoxQuestion {
  page: number;
  label: string;
  /** The answer box (an inset overlay) or the region of a row of tick boxes. */
  overlay: { page: number; x: number; y: number; width: number; height: number };
  answerType?: Exclude<AnswerType, "table">;
  /** Tick rows: the printed option beside each box, left to right. */
  options: string[];
}

/** One question per answer box and per row of tick boxes, top to bottom (rules mode). */
export function flatBoxQuestions(pdf: PdfFormOutline): FlatBoxQuestion[] {
  const boxes = pdf.boxes ?? [];
  const out: FlatBoxQuestion[] = [];
  for (let page = 1; page <= pdf.pages; page += 1) {
    const onPage = boxes.filter((b) => b.page === page);
    const items = pageItems(pdf, page);
    const others = onPage;
    for (const row of tickRows(onPage)) {
      const x = row[0].x;
      const y = Math.min(...row.map((t) => t.y));
      const right = Math.max(...row.map((t) => t.x + t.width));
      const height = Math.max(...row.map((t) => t.height));
      const options = tickRowLabels(row, items);
      // The question is printed left of the options (which may sit before their boxes).
      const start = tickRowStart(row, options, items);
      const region = { page, x: start, y, width: right - start, height };
      const label = labelFor(region, pdf, others.filter((b) => b.kind !== "tick" || row.indexOf(b) < 0));
      const yesNo = options.length === 2 && /^y(?:es)?\b/i.test(options[0]) && /^no?\b/i.test(options[1]);
      out.push({
        page,
        label,
        overlay: { page, x: r1(x), y: r1(y), width: r1(Math.max(right - x, 20)), height: r1(height) },
        answerType: yesNo ? "yes_no" : options.length === 1 ? "checkbox" : "single_choice",
        options,
      });
    }
    for (const b of onPage.filter((x) => x.kind === "box")) {
      const label = labelFor(b, pdf, onPage);
      const slots = b.slots?.length ?? 0;
      const answerType: FlatBoxQuestion["answerType"] = slots === 2 || slots === 3 ? "date" : b.height > 30 ? "long_text" : undefined;
      out.push({
        page,
        label,
        overlay: { page, x: r1(b.x + BOX_INSET), y: r1(b.y + BOX_INSET), width: r1(b.width - 2 * BOX_INSET), height: r1(b.height - 2 * BOX_INSET) },
        ...(answerType && { answerType }),
        options: [],
      });
    }
  }
  return out.filter((q) => q.label.trim().length > 1);
}

/* ------------------------------------------------------------------------------------------------
 * Post-validation: snap an overlay onto the printed boxes
 * ----------------------------------------------------------------------------------------------*/

type Region = { page: number; x: number; y: number; width: number; height: number };

function overlapArea(a: Region, b: Region): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface SnappedOverlay {
  anchor: FormAnchor;
  /** Options as printed beside the tick boxes (tick anchors only). */
  options?: string[];
  note: string;
}

/**
 * The writing rows of a box with printed horizontal rules, top to bottom: between the box's top edge,
 * each rule and its bottom edge (`y` = the row's lower boundary). Undefined for a box without rules.
 */
export function ruledRowsOf(box: Pick<PdfBox, "y" | "height" | "rules">): Array<{ y: number; height: number }> | undefined {
  if (!box.rules?.length) return undefined;
  const bounds = [box.y + box.height, ...box.rules.slice().sort((a, b) => b - a), box.y];
  const rows: Array<{ y: number; height: number }> = [];
  for (let i = 1; i < bounds.length; i += 1) rows.push({ y: r1(bounds[i]), height: r1(bounds[i - 1] - bounds[i]) });
  return rows.every((row) => row.height > 0) ? rows : undefined;
}

/**
 * The anchor for an overlay on a flat PDF with printed boxes: tick boxes for a yes/no, tick-box or
 * choice answer whose region covers them; else the printed box it falls on (inset, with date slots);
 * null when it falls on no printed box (the overlay is kept as proposed).
 */
export function snapOverlay(
  overlay: Region,
  pdf: PdfFormOutline,
  answerType: AnswerType,
  options: readonly string[],
): SnappedOverlay | null {
  const boxes = (pdf.boxes ?? []).filter((b) => b.page === overlay.page);
  if (boxes.length === 0) return null;
  const items = pageItems(pdf, overlay.page);

  if (answerType === "yes_no" || answerType === "single_choice" || answerType === "checkbox") {
    const grown = { ...overlay, x: overlay.x - 6, y: overlay.y - 6, width: overlay.width + 12, height: overlay.height + 12 };
    const ticks = boxes
      .filter((b) => b.kind === "tick")
      .filter((t) => {
        const cx = t.x + t.width / 2;
        const cy = t.y + t.height / 2;
        return cx >= grown.x && cx <= grown.x + grown.width && cy >= grown.y && cy <= grown.y + grown.height;
      })
      .sort((a, b) => topOf(b) - topOf(a) || a.x - b.x);
    if (ticks.length > 0) {
      const labels = tickRowLabels(ticks.slice().sort((a, b) => a.x - b.x), items);
      const byX = ticks.slice().sort((a, b) => a.x - b.x);
      const printed = ticks.map((t, i) => {
        const l = labels[byX.indexOf(t)];
        return l && !/^Option \d+$/.test(l) ? l : options[i] || l || `Option ${i + 1}`;
      });
      // Name each box with the proposed option it matches (case-insensitive), else its printed label.
      const named = printed.map((p) => options.find((o) => o.trim().toLowerCase() === p.trim().toLowerCase()) ?? p);
      return {
        anchor: {
          kind: "pdf_overlay_ticks",
          page: overlay.page,
          options: ticks.map((t, i) => ({ option: named[i], x: t.x, y: t.y, size: r1(Math.min(t.width, t.height)) })),
        },
        options: named,
        note: "Flat PDF: an X is drawn in the chosen printed tick box – check it in the preview.",
      };
    }
  }

  // The printed answer box the overlay falls on (most overlap, at least half of the smaller one).
  let best: PdfBox | null = null;
  let bestArea = 0;
  for (const b of boxes) {
    if (b.kind !== "box") continue;
    const area = overlapArea(overlay, b);
    const smaller = Math.min(overlay.width * overlay.height, b.width * b.height);
    if (area >= smaller * 0.5 && area > bestArea) {
      best = b;
      bestArea = area;
    }
  }
  if (!best) return null;
  const slots = best.slots?.length ?? 0;
  const dateLike = answerType === "date" || answerType === "date_signed";
  const dateSlots = dateLike && slots >= 2 && slots <= 8 ? best.slots : undefined;
  const ruledRows = dateSlots ? undefined : ruledRowsOf(best);
  return {
    anchor: {
      kind: "pdf_overlay",
      page: best.page,
      x: r1(best.x + BOX_INSET),
      y: r1(best.y + BOX_INSET),
      width: r1(best.width - 2 * BOX_INSET),
      height: r1(best.height - 2 * BOX_INSET),
      ...(dateSlots && { dateSlots: dateSlots.map((s) => ({ x: s.x, width: s.width })) }),
      ...(ruledRows && { ruledRows }),
    },
    note: dateSlots
      ? "Flat PDF: the date is written part by part between the printed separators – check it in the preview."
      : ruledRows
        ? `Flat PDF: the answer is written on the box's ${ruledRows.length} printed lines, one line of text per line – check it in the preview.`
        : "Flat PDF: the answer is written inside the printed box – check it in the preview.",
  };
}

/* ------------------------------------------------------------------------------------------------
 * Block capitals and the prompt outline
 * ----------------------------------------------------------------------------------------------*/

/** True when a flat form asks for answers in BLOCK CAPITALS. */
export function asksForBlockCapitals(parsed: ParsedForm): boolean {
  if (parsed.kind !== "pdf_flat") return false;
  const lines = parsed.pdf.pageText.flatMap((p) => linesOf(p.items).map((l) => l.text));
  return lines.some((t) => /\bblock\s+capitals\b|\bin\s+capital\s+letters\b|\bblock\s+letters\b/i.test(t));
}

/**
 * The printed boxes of one page as compact outline lines for the live analysis (`lines=N`: a box ruled
 * with N writing lines):
 *   boxes: [x=208 y=434 w=99 h=17 slots=3] [x=208 y=353 w=375 h=55 lines=3] ticks: [x=210 y=815 s=17 "Yes"] …
 */
export function renderPdfBoxes(pdf: PdfFormOutline, page: number): string[] {
  const boxes = (pdf.boxes ?? []).filter((b) => b.page === page);
  if (boxes.length === 0) return [];
  const items = pageItems(pdf, page);
  const r = (n: number) => Math.round(n);
  const answer = boxes
    .filter((b) => b.kind === "box")
    .map((b) => `[x=${r(b.x)} y=${r(b.y)} w=${r(b.width)} h=${r(b.height)}${b.slots ? ` slots=${b.slots.length}` : ""}${b.rules ? ` lines=${b.rules.length + 1}` : ""}]`);
  const ticks = tickRows(boxes).flatMap((row) => {
    const labels = tickRowLabels(row, items);
    return row.map((t, i) => {
      const label = /^Option \d+$/.test(labels[i]) ? "" : labels[i];
      return `[x=${r(t.x)} y=${r(t.y)} s=${r(Math.min(t.width, t.height))}${label ? ` ${JSON.stringify(label.slice(0, 40))}` : ""}]`;
    });
  });
  const out: string[] = [];
  if (answer.length) out.push(`  answer boxes: ${answer.join(" ")}`);
  if (ticks.length) out.push(`  tick boxes: ${ticks.join(" ")}`);
  return out;
}
