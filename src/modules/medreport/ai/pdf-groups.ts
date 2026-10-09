import "server-only";

/**
 * Fillable-PDF answer spaces made of several fields, for the analysis (outline rendering, rules mode
 * and post-validation):
 *
 * - One-character boxes: fields that share a `charGroup` (forms/pdf-outline.ts) are ONE question,
 *   written one character per box – a date as DDMMYYYY / DDMMYY when the boxes are printed D D M M Y Y
 *   (Y Y) or the label asks for a date, otherwise the text.
 * - Option groups (rules mode): separate single tick boxes that answer one question – a "Yes" box and a
 *   "No" box on one line (Freedom), or a column of boxes each printed with an option (AXA's therapist
 *   type, its preferred contact method). A column of boxes whose labels are questions ("answered all
 *   questions?", "signed and dated the form?") is a checklist, not a choice, and is left alone.
 *
 * Pure functions of the outline. Owner: ai agent.
 */
import type { AnswerType, PdfCharFormat, PdfFormOutline, PdfOutlineField } from "../core/types";

/* ------------------------------------------------------------------------------------------------
 * One-character boxes
 * ----------------------------------------------------------------------------------------------*/

/** The members of a field's one-character group, left to right (just the field when it has none). */
export function charGroupMembers(pdf: Pick<PdfFormOutline, "fields">, field: PdfOutlineField): PdfOutlineField[] {
  if (!field.charGroup) return [field];
  return pdf.fields.filter((f) => f.charGroup === field.charGroup && f.page === field.page).sort((a, b) => a.rect.x - b.rect.x);
}

/** Every one-character group of the outline: group ID → members, left to right. */
export function charGroupsOf(pdf: Pick<PdfFormOutline, "fields">): Map<string, PdfOutlineField[]> {
  const out = new Map<string, PdfOutlineField[]>();
  for (const f of pdf.fields) {
    if (!f.charGroup) continue;
    out.set(f.charGroup, [...(out.get(f.charGroup) ?? []), f]);
  }
  out.forEach((members, id) => out.set(id, members.slice().sort((a, b) => a.rect.x - b.rect.x)));
  return out;
}

/** Union rectangle of several fields (same page). */
export function unionRect(fields: PdfOutlineField[]): PdfOutlineField["rect"] {
  const x1 = Math.min(...fields.map((f) => f.rect.x));
  const y1 = Math.min(...fields.map((f) => f.rect.y));
  const x2 = Math.max(...fields.map((f) => f.rect.x + f.rect.width));
  const y2 = Math.max(...fields.map((f) => f.rect.y + f.rect.height));
  return { x: x1, y: y1, width: Math.round((x2 - x1) * 10) / 10, height: Math.round((y2 - y1) * 10) / 10 };
}

const DATE_WORDS_RE = /\b(?:date|dated|d\.?o\.?b|birth|dd\s*\/\s*mm)\b/i;

/** The D/M/Y letters printed in the boxes, as found in the nearby text ("DDMMYYYY"), or "". */
export function charGroupHint(nearbyText: string): string {
  return (
    nearbyText
      .split(" | ")
      .map((s) => s.trim())
      .find((s) => /^D{1,2}M{1,2}Y{2,4}$/.test(s)) ?? ""
  );
}

/**
 * How a group of `n` one-character boxes is written. A date question (or boxes printed D D M M Y Y Y Y,
 * or a label that asks for a date) in 8 boxes is DDMMYYYY, in 6 boxes DDMMYY; anything else one
 * character per box.
 */
export function charGroupFormat(n: number, nearbyText: string, answerType?: AnswerType): PdfCharFormat {
  const hint = charGroupHint(nearbyText);
  const isDate = answerType === "date" || answerType === "date_signed" || hint !== "" || DATE_WORDS_RE.test(nearbyText);
  if (!isDate) return "chars";
  if (n === 8) return "DDMMYYYY";
  if (n === 6) return "DDMMYY";
  return "chars";
}

/** The question a group of boxes answers: its nearby text without the D/M/Y hint and "(dd/mm/yyyy)". */
export function charGroupLabel(nearbyText: string): string {
  const hint = charGroupHint(nearbyText);
  return (
    nearbyText
      .split(" | ")
      .map((s) => s.replace(/\(\s*dd\s*\/\s*mm\s*\/\s*yy(?:yy)?\s*\)/gi, " ").replace(/\s+/g, " ").trim())
      .find((s) => s.length > 1 && s !== hint) ?? ""
  );
}

/* ------------------------------------------------------------------------------------------------
 * Options
 * ----------------------------------------------------------------------------------------------*/

/** Two options that read Yes and No (either order). */
export function isYesNoOptions(options: readonly string[]): boolean {
  if (options.length !== 2) return false;
  const yes = options.filter((o) => /^\s*y(?:es)?\b/i.test(o)).length;
  const no = options.filter((o) => /^\s*no?\b/i.test(o) && !/^\s*none\b/i.test(o)).length;
  return yes === 1 && no === 1;
}

/** Yes before No. */
export function yesFirst<T>(items: T[], optionOf: (item: T) => string): T[] {
  return items.slice().sort((a, b) => Number(/^\s*no?\b/i.test(optionOf(a))) - Number(/^\s*no?\b/i.test(optionOf(b))));
}

/**
 * A radio group's or multi-widget tick box's printed labels (blank ones replaced by the export value),
 * in reading order where the labels can be found in the page text near the field, else as given.
 */
export function printedOptions(pdf: Pick<PdfFormOutline, "pageText">, field: PdfOutlineField): string[] {
  const exportValues = field.options ?? [];
  const labels = exportValues.map((v, i) => (field.optionLabels?.[i] ?? "").trim() || v);
  const unique = Array.from(new Set(labels));
  const items = (pdf.pageText.find((p) => p.page === field.page)?.items ?? []).filter(
    (it) => it.x >= field.rect.x - 60 && it.x <= field.rect.x + field.rect.width + 60 && it.y >= field.rect.y - 20 && it.y <= field.rect.y + field.rect.height + 20,
  );
  const pos = unique.map((label) => items.find((it) => it.str.trim() === label) ?? null);
  if (pos.some((p) => p === null)) return unique;
  return unique
    .map((label, i) => ({ label, p: pos[i]! }))
    .sort((a, b) => (Math.abs(a.p.y - b.p.y) > 3 ? b.p.y - a.p.y : a.p.x - b.p.x))
    .map((x) => x.label);
}

export interface OptionGroup {
  /** The tick boxes, in reading order. */
  fields: PdfOutlineField[];
  /** The printed option of each box. */
  options: string[];
  /** The question (text near the first box that is not one of the options), or "". */
  label: string;
  yesNo: boolean;
}

const centreY = (f: PdfOutlineField) => f.rect.y + f.rect.height / 2;

/** The option printed beside a single tick box: its own label, else the label of the field just left of it on the same line. */
function optionOfBox(pdf: Pick<PdfFormOutline, "fields">, box: PdfOutlineField): string {
  const own = (box.optionLabels?.[0] ?? "").trim();
  if (own) return own;
  const left = pdf.fields
    .filter((f) => f !== box && f.page === box.page && f.type === "text" && Math.abs(centreY(f) - centreY(box)) <= 4 && f.rect.x + f.rect.width <= box.rect.x + 2 && box.rect.x - (f.rect.x + f.rect.width) < 60)
    .sort((a, b) => b.rect.x - a.rect.x)[0];
  return left ? (left.nearbyText.split(" | ")[0] ?? "").trim() : "";
}

function looksLikeOptions(options: string[]): boolean {
  if (options.length < 2 || options.some((o) => !o)) return false;
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return false;
  return options.every((o) => o.length <= 40 && !/\?\s*$/.test(o));
}

function questionNear(first: PdfOutlineField, options: string[]): string {
  const opts = new Set(options.map((o) => o.toLowerCase()));
  return (
    first.nearbyText
      .split(" | ")
      .map((s) => s.trim())
      .find((s) => s.length > 1 && !opts.has(s.toLowerCase())) ?? ""
  );
}

/**
 * Separate single tick boxes that answer one question: boxes on one line (≤ 220 pt apart), else boxes
 * stacked in one column (each step at most 2.5 box heights + 12 pt). A group is kept only when every box
 * has its own short printed option (no "?"), all different.
 */
export function detectOptionGroups(pdf: Pick<PdfFormOutline, "fields">): OptionGroup[] {
  const singles = pdf.fields.filter((f) => f.type === "checkbox" && !(f.options && f.options.length > 1) && !f.charGroup);
  const groups: PdfOutlineField[][] = [];
  const used = new Set<PdfOutlineField>();
  const pages = Array.from(new Set(singles.map((f) => f.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const boxes = singles.filter((f) => f.page === page);
    // Lines.
    const lines: PdfOutlineField[][] = [];
    for (const b of boxes.slice().sort((a, c) => centreY(c) - centreY(a))) {
      const line = lines.find((l) => Math.abs(centreY(l[0]) - centreY(b)) <= 3);
      if (line) line.push(b);
      else lines.push([b]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.rect.x - b.rect.x);
      let run: PdfOutlineField[] = [];
      const flush = () => {
        if (run.length >= 2) groups.push(run);
        run = [];
      };
      for (const b of line) {
        const prev = run[run.length - 1];
        if (prev && b.rect.x - (prev.rect.x + prev.rect.width) > 220) flush();
        run.push(b);
      }
      flush();
    }
    groups.forEach((g) => g.forEach((b) => used.add(b)));
    // Columns of the boxes left alone on their line.
    const rest = boxes.filter((b) => !used.has(b));
    const columns: PdfOutlineField[][] = [];
    for (const b of rest.slice().sort((a, c) => a.rect.x - c.rect.x)) {
      const col = columns.find((c) => Math.abs(c[0].rect.x - b.rect.x) <= 3);
      if (col) col.push(b);
      else columns.push([b]);
    }
    for (const col of columns) {
      col.sort((a, b) => b.rect.y - a.rect.y);
      let run: PdfOutlineField[] = [];
      const flush = () => {
        if (run.length >= 2) groups.push(run);
        run = [];
      };
      for (const b of col) {
        const prev = run[run.length - 1];
        if (prev && prev.rect.y - b.rect.y > 2.5 * Math.max(prev.rect.height, b.rect.height) + 12) flush();
        run.push(b);
      }
      flush();
    }
  }
  const out: OptionGroup[] = [];
  for (const g of groups) {
    const options = g.map((b) => optionOfBox(pdf, b));
    if (!looksLikeOptions(options)) continue;
    out.push({ fields: g, options, label: questionNear(g[0], options), yesNo: isYesNoOptions(options) });
  }
  return out;
}
