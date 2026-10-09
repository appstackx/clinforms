import "server-only";

/**
 * Marks on a FLAT PDF beyond plain text (S2):
 *
 * - Tick boxes (`pdf_overlay_ticks`): an X centred in the printed box of the chosen option – "Yes" or
 *   "No" for a yes/no answer, the printed option for a single choice, the one box of a tick box.
 * - Date slots (`pdf_overlay.dateSlots`): a date box with printed separators ("__ / __ / ____") gets
 *   DD, MM and YYYY each centred in its own slot, so nothing is written over the slashes. Two slots
 *   take MM / YYYY; one slot per character (a comb of 8 or 6 cells) takes DDMMYYYY / DDMMYY.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { rgb, type PDFDocument, type PDFFont } from "pdf-lib";
import { isValidIsoDate, parseUkDate } from "../core/dates";
import { isUnknownAnswer, matchOption, type FormFillAnswer } from "../core/forms";
import type { FormField, PdfOverlayAnchor, PdfOverlayTicksAnchor } from "../core/types";

const MARK_COLOR = rgb(0.06, 0.09, 0.2);

export interface MarkDeps {
  doc: PDFDocument;
  font: PDFFont;
  warn(message: string): void;
}

function where(field: FormField): string {
  return `${field.id} (“${field.label}”)`;
}

/** The answer's text, or "Yes"/"No" for a boolean value. */
function answerString(answer: FormFillAnswer): string {
  if (typeof answer.value === "boolean") return answer.value ? "Yes" : "No";
  if (typeof answer.value === "string" && answer.value.trim()) return answer.value.trim();
  return (answer.text ?? "").trim();
}

/**
 * The options to tick for an answer: yes/no answers tick the printed "Yes" or "No" (a single tick box
 * is ticked for "Yes" and left empty for "No"), a choice ticks the printed option it matches. Answers
 * that say the information is not known tick nothing.
 */
export function ticksFor(answer: FormFillAnswer, options: readonly string[]): string[] {
  if (options.length === 0) return [];
  if (typeof answer.value === "boolean") {
    const re = answer.value ? /^\s*(?:yes|y|true|ticked)\b/i : /^\s*(?:no|n|false)\b/i;
    const hit = options.find((o) => re.test(o));
    if (hit) return [hit];
    // One box with its own label ("Physiotherapist"): ticked for Yes only.
    return options.length === 1 && answer.value ? [options[0]] : [];
  }
  const raw = answerString(answer);
  if (!raw || isUnknownAnswer(raw, options)) return [];
  const match = matchOption(options, raw);
  if (match) return [match];
  if (options.length === 1 && /^(?:yes|y|true|ticked|x|✓|✔)$/i.test(raw)) return [options[0]];
  const yesNo = /^(?:yes|y)$/i.test(raw) ? /^\s*yes\b/i : /^(?:no|n)$/i.test(raw) ? /^\s*no\b/i : null;
  const hit = yesNo ? options.find((o) => yesNo.test(o)) : undefined;
  return hit ? [hit] : [];
}

/** An X centred in a square box at (x, y) with side `size`. */
export function drawTickX(page: ReturnType<PDFDocument["getPages"]>[number], box: { x: number; y: number; size: number }): void {
  const inset = box.size * 0.22;
  const thickness = Math.max(1, Math.min(1.8, box.size * 0.09));
  const a = { x: box.x + inset, y: box.y + inset };
  const b = { x: box.x + box.size - inset, y: box.y + box.size - inset };
  page.drawLine({ start: a, end: b, thickness, color: MARK_COLOR });
  page.drawLine({ start: { x: a.x, y: b.y }, end: { x: b.x, y: a.y }, thickness, color: MARK_COLOR });
}

/** Tick the chosen option's printed box (pdf_overlay_ticks). */
export function drawOverlayTicks(deps: MarkDeps, field: FormField, answer: FormFillAnswer, anchor: PdfOverlayTicksAnchor): void {
  const raw = answerString(answer);
  if (!raw && typeof answer.value !== "boolean") return;
  const page = deps.doc.getPages()[anchor.page - 1];
  if (!page) {
    deps.warn(`${where(field)}: page ${anchor.page} does not exist in this PDF.`);
    return;
  }
  const chosen = ticksFor(answer, anchor.options.map((o) => o.option));
  if (chosen.length === 0) {
    // "No" on a single tick box is an empty box, not a problem.
    const singleNo = anchor.options.length === 1 && (answer.value === false || /^(?:no|n)$/i.test(raw));
    if (!singleNo) deps.warn(`${where(field)}: the answer “${raw}” does not match any of the printed tick boxes, so none was ticked.`);
    return;
  }
  for (const option of anchor.options) if (chosen.indexOf(option.option) >= 0) drawTickX(page, option);
}

/** The parts of a date for a box's slots: 3 → DD, MM, YYYY; 2 → MM, YYYY; 8 / 6 → one digit each. */
export function datePartsForSlots(iso: string, slots: number): string[] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  if (slots === 3) return [dd, mm, yyyy];
  if (slots === 2) return [mm, yyyy];
  if (slots === 8) return Array.from(`${dd}${mm}${yyyy}`);
  if (slots === 6) return Array.from(`${dd}${mm}${yyyy.slice(2)}`);
  return null;
}

/** The ISO date of an answer (its value, or DD/MM/YYYY text); null when it is not a date. */
export function answerIsoDate(answer: FormFillAnswer): string | null {
  if (typeof answer.value === "string" && isValidIsoDate(answer.value)) return answer.value;
  const text = (answer.text ?? "").trim();
  if (isValidIsoDate(text)) return text;
  return parseUkDate(text);
}

/**
 * Write a date part by part into the slots of a pre-printed date box (pdf_overlay with dateSlots).
 * Returns false when the answer is not a date or the slots do not fit a date (the caller then writes
 * the text as usual).
 */
export function drawOverlayDateSlots(deps: MarkDeps, field: FormField, answer: FormFillAnswer, anchor: PdfOverlayAnchor): boolean {
  const slots = anchor.dateSlots;
  if (!slots || slots.length < 2) return false;
  const iso = answerIsoDate(answer);
  const parts = iso ? datePartsForSlots(iso, slots.length) : null;
  if (!parts) return false;
  const page = deps.doc.getPages()[anchor.page - 1];
  if (!page) {
    deps.warn(`${where(field)}: page ${anchor.page} does not exist in this PDF.`);
    return true;
  }
  let size = Math.max(6, Math.min(anchor.fontSize ?? 10, anchor.height - 3));
  // Shrink until every part fits its slot.
  while (size > 6 && parts.some((p, i) => deps.font.widthOfTextAtSize(p, size) > slots[i].width - 2)) size -= 0.5;
  const y = anchor.y + (anchor.height - size * 0.72) / 2;
  parts.forEach((part, i) => {
    const w = deps.font.widthOfTextAtSize(part, size);
    page.drawText(part, { x: slots[i].x + (slots[i].width - w) / 2, y, size, font: deps.font, color: MARK_COLOR });
  });
  return true;
}
