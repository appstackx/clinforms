import "server-only";

/**
 * Write answers into the referrer's ORIGINAL PDF (pdf-lib): AcroForm fields by name (text, checkbox,
 * radio, dropdown) for pdf_acroform; text drawn in the analysed box (pdf_overlay, wrapped and shrunk
 * to fit) for pdf_flat. FINAL copies are flattened; DRAFT copies carry a diagonal "DRAFT – NOT APPROVED"
 * watermark on every page and leave sign-off fields blank (the caller passes no receipt).
 *
 * Fitting text: a multi-line field keeps its own font size when the answer fits, otherwise the size
 * shrinks (to 8 pt at the smallest). A single-line box that is tall enough is written on two lines
 * (at 8 pt or more) before anything is cut. An answer that still does not fit keeps its leading words
 * with a short marker – "… (continued on the continuation sheet)" in a multi-line box, "… (see
 * continuation sheet)" in a single-line one (never the marker alone) – and the full answer is printed
 * on a continuation sheet added at the end of the form, with a warning (onWarning). Standard PDF fonts
 * are used, so characters outside the Windows-1252 set are transliterated (→ "->", ≥ ">=", ✓ "Yes"…).
 *
 * AcroForm specifics live in ./pdf-acro-fill.ts: tick boxes set widget by widget and redrawn visibly,
 * radio labels mapped to export values, one question across several tick-box fields (optionFields),
 * dates in 8 / 6-character boxes written DDMMYYYY / DDMMYY, one-character boxes (pdf_char_fields).
 * A value that would have to be cut to fit a box is an ERROR (onError), not a warning.
 *
 * Async because pdf-lib's load/save are async.
 *
 * Owner: forms-engine agent. Signature final.
 */
import {
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  StandardFonts,
  TextAlignment,
  degrees,
  rgb,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
  type PDFPage,
} from "pdf-lib";
import { isAnswerableField, type FormFillAnswer, type FormFillAnswers } from "../core/forms";
import type { FormDefinition, FormField, PdfCharFieldsAnchor, PdfFieldAnchor, PdfOptionField } from "../core/types";
import {
  answerIsoDate,
  charBoxFontSize,
  charFieldTexts,
  checkBoxChoice,
  chooseOptionIndex,
  ensureTextFieldDA,
  fitMaxLength,
  onValueFor,
  pickExportValue,
  setCheckBoxState,
  wantedOf,
} from "./pdf-acro-fill";
import { loadPdfDocument } from "./pdf-outline";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";
import { drawOverlayDateSlots, drawOverlayTicks } from "./pdf-overlay-marks";
import {
  continuationHeading,
  drawContinuationTable,
  drawOverlayTable,
  drawWrappedHeading,
  fillPdfFieldTable,
  printedTextLoader,
  type ContinuationTable,
  type TableFillDeps,
} from "./pdf-table";
import type { PdfFillOptions } from "./types";

/** Smallest font for answers: below 8 pt a form is hard to read, so longer answers go to the continuation sheet. */
const MIN_FONT = 8;
const DEFAULT_FONT = 10;
const ANSWER_COLOR = rgb(0.06, 0.09, 0.2);
const DRAFT_RED = rgb(0.71, 0.14, 0.09);
const CONTINUED = " (continued on the continuation sheet)";
/** Markers after the leading words of a cut answer, longest first ("" = just "…"). */
const MULTILINE_MARKERS = [CONTINUED, " (see continuation sheet)", " (cont.)", ""];
const SINGLE_LINE_MARKERS = [" (see continuation sheet)", " (see cont. sheet)", " (cont.)", ""];

function where(field: FormField): string {
  return `${field.id} (“${field.label}”)`;
}

/* ------------------------------------------------------------------------------------------------
 * Text: Windows-1252 only (standard fonts), wrapping and fitting
 * ----------------------------------------------------------------------------------------------*/

const TRANSLITERATE: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "✓": "Yes",
  "✔": "Yes",
  "✗": "No",
  "☐": "[ ]",
  "☑": "[X]",
  "☒": "[X]",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "′": "'",
  "″": '"',
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  ı: "i",
  "\u00A0": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u2009": " ",
  "\u200B": "",
};

/**
 * Text → characters the form's standard font can print (Windows-1252): known symbols are transliterated,
 * accents dropped where the base letter exists, anything else becomes "?". Pass `lost` to collect the
 * characters that could not be printed (the caller warns – a wrong character in an identifier must be
 * noticed, never silent).
 */
export function makeEncoder(font: PDFFont): (text: string, lost?: string[]) => string {
  const cache = new Map<string, boolean>();
  const ok = (ch: string) => {
    let v = cache.get(ch);
    if (v === undefined) {
      try {
        font.encodeText(ch);
        v = true;
      } catch {
        v = false;
      }
      cache.set(ch, v);
    }
    return v;
  };
  return (text: string, lost?: string[]) => {
    let out = "";
    for (const ch of Array.from(text.replace(/\r\n?/g, "\n").replace(/\t/g, " "))) {
      if (ch === "\n" || ok(ch)) {
        out += ch;
        continue;
      }
      const t = TRANSLITERATE[ch];
      if (t !== undefined) {
        out += t;
        continue;
      }
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      if (base && Array.from(base).every(ok)) {
        out += base;
      } else {
        out += "?";
        lost?.push(ch);
      }
    }
    return out;
  };
}

/** Greedy word wrap (explicit newlines kept). */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the box is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const lineHeight = (font: PDFFont, size: number, factor = 1.18) => font.heightAtSize(size) * factor;

interface Fit {
  size: number;
  text: string;
  overflow: boolean;
  /** 2 when a single-line box is written on two lines (the caller makes the field multi-line). */
  lines?: number;
}

export interface FitTextOptions {
  /** Single-line boxes: try two lines (at 8 pt or more) when the box is tall enough, before cutting. */
  allowTwoLines?: boolean;
  /** Line height as a multiple of the font height (pdf-lib lays out multi-line fields at 1.2). */
  lineHeightFactor?: number;
}

/**
 * The leading words of `text` plus the first marker with which at least one word fits (`fits` checks
 * the candidate); a first word too long for the box is cut by characters. Never the marker alone.
 */
function cutToFit(text: string, fits: (candidate: string) => boolean, markers: readonly string[]): string {
  const words = text.split(/(\s+)/);
  for (const marker of markers) {
    let lo = 0;
    let hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(`${words.slice(0, mid).join("").trimEnd()}…${marker}`)) lo = mid;
      else hi = mid - 1;
    }
    const cut = words.slice(0, lo).join("").trimEnd();
    if (cut) return `${cut}…${marker}`;
  }
  let word = text.trim();
  while (word.length > 1 && !fits(`${word}…`)) word = word.slice(0, -1);
  return `${word}…`;
}

/**
 * Largest size ≤ preferred at which the text fits the box; else the leading words with a marker, at the
 * minimum size. A preferred size below the minimum (a form whose fields ask for 6 or 7 pt) starts at the
 * minimum: answers are never printed smaller than MIN_FONT, and a short answer is not "cut".
 */
export function fitText(
  text: string,
  font: PDFFont,
  box: { width: number; height: number },
  preferredSize: number,
  multiline: boolean,
  opts: FitTextOptions = {},
): Fit {
  const preferred = Math.max(MIN_FONT, preferredSize);
  const lh = (size: number) => lineHeight(font, size, opts.lineHeightFactor);
  const fitsLines = (t: string, size: number, maxLines = Infinity) => {
    const n = wrapText(t, font, size, box.width).length;
    return n <= maxLines && n * lh(size) <= box.height;
  };
  const fitsOne = (t: string, size: number) => font.widthOfTextAtSize(t, size) <= box.width;
  if (multiline) {
    for (let size = preferred; size >= MIN_FONT; size -= 0.5) if (fitsLines(text, size)) return { size, text, overflow: false };
    return { size: MIN_FONT, text: cutToFit(text, (t) => fitsLines(t, MIN_FONT), MULTILINE_MARKERS), overflow: true };
  }
  for (let size = preferred; size >= MIN_FONT; size -= 0.5) if (fitsOne(text, size)) return { size, text, overflow: false };
  // A single-line box tall enough for two lines at the minimum size: wrap before cutting.
  if (opts.allowTwoLines && 2 * lh(MIN_FONT) <= box.height) {
    for (let size = preferred; size >= MIN_FONT; size -= 0.5) if (fitsLines(text, size, 2)) return { size, text, overflow: false, lines: 2 };
    return { size: MIN_FONT, text: cutToFit(text, (t) => fitsLines(t, MIN_FONT, 2), SINGLE_LINE_MARKERS), overflow: true, lines: 2 };
  }
  return { size: MIN_FONT, text: cutToFit(text, (t) => fitsOne(t, MIN_FONT), SINGLE_LINE_MARKERS), overflow: true };
}

/* ------------------------------------------------------------------------------------------------
 * Field helpers
 * ----------------------------------------------------------------------------------------------*/

function answerText(answer: FormFillAnswer): string {
  let text = answer.text ?? "";
  if (!text.trim() && answer.value !== undefined && answer.value !== null) {
    text = typeof answer.value === "boolean" ? (answer.value ? "Yes" : "No") : String(answer.value);
  }
  return text.trim();
}

/** Font size from a text field's default appearance ("/Helv 9 Tf"); 0 = auto. */
function daFontSize(field: PDFTextField): number | null {
  const da = field.acroField.getDefaultAppearance() ?? "";
  const m = /(\d+(?:\.\d+)?)\s+Tf/.exec(da);
  return m ? Number(m[1]) : null;
}

interface Continuation {
  field: FormField;
  text: string;
  /** Table rows that did not fit on the form, printed as a table (forms/pdf-table.ts). */
  table?: ContinuationTable;
}

interface Ctx {
  doc: PDFDocument;
  pdfForm: PDFForm;
  font: PDFFont;
  bold: PDFFont;
  encode: (text: string, lost?: string[]) => string;
  opts: PdfFillOptions;
  warn(message: string): void;
  /** The written form would be wrong (a value cut to fit): onError, else onWarning. */
  error(message: string): void;
  continuations: Continuation[];
}

/** Encode an answer for the form's font, warning when characters cannot be printed (shown as "?"). */
function encodeAnswer(ctx: Ctx, field: FormField, raw: string): string {
  const lost: string[] = [];
  const text = ctx.encode(raw, lost);
  if (lost.length > 0) {
    const chars = Array.from(new Set(lost)).slice(0, 5).map((c) => `“${c}”`).join(", ");
    ctx.warn(
      `${where(field)}: ${lost.length} character${lost.length === 1 ? "" : "s"} (${chars}) cannot be printed with the form's font and appear as “?”. Check the answer on the completed form.`,
    );
  }
  return text;
}

function cutError(field: FormField, max: number, full: string, written: string): string {
  return `${where(field)}: the box takes at most ${max} character${max === 1 ? "" : "s"}, so “${full}” would be written as “${written}” – the completed form would be wrong. Shorten the answer (or correct the form mapping) before it is approved.`;
}

function fillTextField(ctx: Ctx, field: FormField, tf: PDFTextField, raw: string, answer: FormFillAnswer = {}): void {
  ensureTextFieldDA(ctx.pdfForm, tf);
  const widget = tf.acroField.getWidgets()[0];
  let text = encodeAnswer(ctx, field, raw);
  const max = tf.getMaxLength();
  if (max !== undefined) {
    // A date in 8 / 6 boxes is written DDMMYYYY / DDMMYY; spaces and separators go before anything is cut.
    const fit = fitMaxLength(text, max, answerIsoDate(field, answer));
    if (fit.cut) ctx.error(cutError(field, max, text, fit.text));
    else if (fit.compacted === "spaces" || fit.compacted === "separators") {
      ctx.warn(`${where(field)}: the box takes at most ${max} characters, so the answer was written without ${fit.compacted === "spaces" ? "spaces" : "spaces or separators"} (“${fit.text}”).`);
    }
    text = fit.text;
  }
  if (!widget) {
    tf.setText(text);
    return;
  }
  const rect = widget.getRectangle();
  const bw = widget.getBorderStyle()?.getWidth() ?? 1;
  const pad = bw + 2;
  const multiline = tf.isMultiline();
  const flat = multiline ? text : text.replace(/\s*\n\s*/g, "; ");
  const preferred = Math.min(daFontSize(tf) || (multiline ? 9 : DEFAULT_FONT), multiline ? 11 : Math.max(MIN_FONT, rect.height - 2 * pad));
  if (tf.isCombed()) {
    // One character per comb cell, laid out by the form's own cells (the length was checked above).
    tf.setText(flat);
    tf.setFontSize(preferred);
    return;
  }
  // A single-line box may take two lines; they are laid out the way pdf-lib draws a multi-line field
  // (inner box = border + 1 pt, line height 1.2 × the font height).
  const fit = multiline
    ? fitText(flat, ctx.font, { width: rect.width - 2 * pad - 2, height: rect.height - 2 * pad }, preferred, true)
    : fitText(flat, ctx.font, { width: rect.width - 2 * pad - 2, height: rect.height - 2 * (bw + 1) }, preferred, false, { allowTwoLines: true, lineHeightFactor: 1.2 });
  if (fit.overflow) {
    ctx.warn(`${where(field)}: the answer is longer than the box; it continues on a continuation sheet at the end of the form.`);
    ctx.continuations.push({ field, text });
  }
  if (fit.lines === 2) tf.enableMultiline();
  tf.setText(fit.text);
  tf.setFontSize(fit.size);
}

function getPdfField(ctx: Ctx, field: FormField, name: string): PDFField | null {
  try {
    return ctx.pdfForm.getField(name);
  } catch {
    ctx.warn(`${where(field)}: the form has no field called “${name}”, so it was left blank. Check the form mapping.`);
    return null;
  }
}

function fillField(ctx: Ctx, field: FormField, answer: FormFillAnswer, anchor: PdfFieldAnchor): void {
  if (anchor.optionFields?.length) {
    fillOptionFields(ctx, field, answer, anchor.optionFields);
    return;
  }
  const name = anchor.fieldName;
  const pdfField = getPdfField(ctx, field, name);
  if (!pdfField) return;
  const text = answerText(answer);
  if (pdfField instanceof PDFTextField) {
    if (text) fillTextField(ctx, field, pdfField, text, answer);
    return;
  }
  if (pdfField instanceof PDFCheckBox) {
    const choice = checkBoxChoice(pdfField, anchor, answer);
    if (choice.kind === "set") setCheckBoxState(pdfField, choice.on);
    else if (choice.kind === "unmatched") ctx.warn(`${where(field)}: the answer “${text}” does not match any of the form's tick boxes, so none was ticked.`);
    return;
  }
  if (pdfField instanceof PDFRadioGroup) {
    if (!text && typeof answer.value !== "boolean") return;
    const opt = pickExportValue(field, anchor, answer, pdfField.getOptions());
    if (opt && pdfField.getOptions().includes(opt)) pdfField.select(opt);
    else ctx.warn(`${where(field)}: the answer “${text}” does not match any of the form's options, so none was selected.`);
    return;
  }
  if (pdfField instanceof PDFDropdown || pdfField instanceof PDFOptionList) {
    if (!text) return;
    const opt = pickExportValue(field, anchor, answer, pdfField.getOptions());
    if (opt && pdfField.getOptions().includes(opt)) pdfField.select(opt);
    else if (pdfField instanceof PDFDropdown && pdfField.isEditable()) pdfField.select(encodeAnswer(ctx, field, text), true);
    else ctx.warn(`${where(field)}: the answer “${text}” is not one of the list's options, so it was left blank.`);
    return;
  }
  ctx.warn(`${where(field)}: “${name}” is not a field that can be filled (button or signature).`);
}

/**
 * One question across several tick-box fields: tick the box of the chosen option and clear the others.
 * No answer leaves every box as it is; a "No" with no "No" box clears them all (the "Yes" box unticked).
 */
function fillOptionFields(ctx: Ctx, field: FormField, answer: FormFillAnswer, options: PdfOptionField[]): void {
  const wanted = wantedOf(answer);
  if (wanted.kind === "none") return;
  let chosen = chooseOptionIndex(options.map((o) => o.option), wanted);
  if (chosen < 0 && wanted.kind === "text" && field.options?.length === options.length) {
    // The question's printed options, in the same order as the boxes.
    chosen = chooseOptionIndex(field.options, wanted);
  }
  if (chosen < 0 && !(wanted.kind === "bool" && !wanted.value)) {
    ctx.warn(`${where(field)}: the answer “${answerText(answer)}” does not match any of the form's tick boxes, so none was ticked.`);
    return;
  }
  const pick = chosen >= 0 ? options[chosen] : null;
  const names = Array.from(new Set(options.map((o) => o.fieldName)));
  for (const name of names) {
    const pdfField = getPdfField(ctx, field, name);
    if (!pdfField) continue;
    const mine = pick && pick.fieldName === name ? pick : null;
    if (pdfField instanceof PDFCheckBox) {
      const on = mine ? onValueFor(pdfField, mine.onValue) : null;
      if (mine && !on) {
        ctx.warn(`${where(field)}: the tick box “${name}” has no “${mine.onValue}” box, so it was left blank. Check the form mapping.`);
        continue;
      }
      setCheckBoxState(pdfField, on);
    } else if (pdfField instanceof PDFRadioGroup) {
      const exportValue = mine ? (mine.onValue && pdfField.getOptions().includes(mine.onValue) ? mine.onValue : pdfField.getOptions()[0]) : null;
      if (exportValue) pdfField.select(exportValue);
    } else {
      ctx.warn(`${where(field)}: “${name}” is not a tick box, so it was left blank. Check the form mapping.`);
    }
  }
}

/** One character per box (pdf_char_fields): a date as DDMMYYYY / DDMMYY, or the text. */
function fillCharFields(ctx: Ctx, field: FormField, answer: FormFillAnswer, anchor: PdfCharFieldsAnchor): void {
  const raw = answerText(answer);
  const res = charFieldTexts(anchor, answer, raw ? encodeAnswer(ctx, field, raw) : "");
  if (res.kind === "none") return;
  if (res.kind === "not_a_date") {
    ctx.warn(`${where(field)}: the boxes take a date, but the answer “${raw}” is not one, so they were left blank.`);
    return;
  }
  if (res.cut) ctx.error(cutError(field, anchor.fieldNames.length, res.value, res.chars.join("")));
  anchor.fieldNames.forEach((name, i) => {
    const pdfField = getPdfField(ctx, field, name);
    if (!pdfField) return;
    if (!(pdfField instanceof PDFTextField)) {
      ctx.warn(`${where(field)}: “${name}” is not a text box, so it was left blank. Check the form mapping.`);
      return;
    }
    const ch = res.chars[i] ?? "";
    if (!ch.trim()) return;
    ensureTextFieldDA(ctx.pdfForm, pdfField);
    const widget = pdfField.acroField.getWidgets()[0];
    const box = widget ? widget.getRectangle() : { width: 16, height: 16 };
    // One character in the middle of its box, not against its left edge.
    pdfField.setAlignment(TextAlignment.Center);
    pdfField.setText(ch);
    pdfField.setFontSize(charBoxFontSize(ctx.font, daFontSize(pdfField), box));
  });
}

type OverlayBox = { page: number; x: number; y: number; width: number; height: number; fontSize?: number; ruledRows?: Array<{ y: number; height: number }> };

/** The ruled rows of an overlay, when they still lie within it (staff may have moved the box since). */
function usableRuledRows(a: OverlayBox): Array<{ y: number; height: number }> | null {
  const rows = a.ruledRows;
  if (!rows || rows.length < 2) return null;
  const inside = rows.every((r) => r.height > 0 && r.y >= a.y - 4 && r.y + r.height <= a.y + a.height + 4);
  return inside ? rows : null;
}

/**
 * Text on a box ruled with writing lines: one line of text per printed row, the baseline a few points
 * above the row's rule (never struck through by it), at a size no taller than the rows allow. Too long
 * for the rows: the leading words with a marker, and the full answer on the continuation sheet.
 */
function drawRuledOverlay(ctx: Ctx, field: FormField, page: PDFPage, encodedIn: string, a: OverlayBox, rows: Array<{ y: number; height: number }>): void {
  const width = a.width - 2;
  // An answer given line by line (an address) with more lines than the printed rows: the last rows'
  // lines share the last row ("Loughton, Milton Keynes"), rather than spilling onto a continuation sheet.
  const encoded = joinExtraLines(encodedIn, rows.length);
  const pitch = Math.min(...rows.map((r) => r.height));
  const preferred = Math.max(MIN_FONT, Math.min(a.fontSize ?? DEFAULT_FONT, pitch * 0.6));
  const fits = (t: string, size: number) => wrapText(t, ctx.font, size, width).length <= rows.length;
  let size = MIN_FONT;
  let text = encoded;
  let overflow = true;
  for (let s = preferred; s >= MIN_FONT; s -= 0.5) {
    if (fits(encoded, s)) {
      size = s;
      overflow = false;
      break;
    }
  }
  if (overflow) {
    text = cutToFit(encoded, (t) => fits(t, MIN_FONT), MULTILINE_MARKERS);
    ctx.warn(`${where(field)}: the answer is longer than the printed lines; it continues on a continuation sheet at the end of the form.`);
    ctx.continuations.push({ field, text: encoded });
  }
  const lines = wrapText(text, ctx.font, size, width);
  lines.forEach((line, i) => {
    const row = rows[i];
    if (!row || !line) return;
    // Cap height of Helvetica ≈ 0.72 em: centred in the row, but at most 4 pt and at least 2.5 pt above the rule.
    const lift = Math.max(2.5, Math.min(4, (row.height - size * 0.72) / 2));
    page.drawText(line, { x: a.x + 1, y: row.y + lift, size, font: ctx.font, color: ANSWER_COLOR });
  });
}

/** Text with at most `rows` explicit lines: the lines from the last row on are joined with ", ". */
export function joinExtraLines(text: string, rows: number): string {
  const lines = text.split("\n");
  if (rows < 1 || lines.length <= rows) return text;
  return [...lines.slice(0, rows - 1), lines.slice(rows - 1).filter((l) => l.trim()).join(", ")].join("\n");
}

function drawOverlay(ctx: Ctx, field: FormField, text: string, a: OverlayBox): void {
  const page = ctx.doc.getPages()[a.page - 1];
  if (!page) {
    ctx.warn(`${where(field)}: page ${a.page} does not exist in this PDF.`);
    return;
  }
  const encoded = encodeAnswer(ctx, field, text);
  const ruled = usableRuledRows(a);
  if (ruled) {
    drawRuledOverlay(ctx, field, page, encoded, a, ruled);
    return;
  }
  const multiline = a.height >= 2 * (a.fontSize ?? DEFAULT_FONT) || encoded.includes("\n");
  const fit = fitText(multiline ? encoded : encoded.replace(/\s*\n\s*/g, "; "), ctx.font, { width: a.width - 2, height: a.height - 1 }, a.fontSize ?? DEFAULT_FONT, multiline);
  if (fit.overflow) {
    ctx.warn(`${where(field)}: the answer is longer than the space on the page; it continues on a continuation sheet at the end of the form.`);
    ctx.continuations.push({ field, text: encoded });
  }
  const lines = multiline ? wrapText(fit.text, ctx.font, fit.size, a.width - 2) : [fit.text];
  const lh = lineHeight(ctx.font, fit.size);
  let y = a.y + a.height - fit.size;
  for (const line of lines) {
    if (y < a.y - 1) break;
    if (line) page.drawText(line, { x: a.x + 1, y, size: fit.size, font: ctx.font, color: ANSWER_COLOR });
    y -= lh;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Continuation sheet and DRAFT marking
 * ----------------------------------------------------------------------------------------------*/

function addContinuationSheet(ctx: Ctx): void {
  // The size the form's pages are SHOWN at (crop box): a print-ready file's media box is larger.
  const first = ctx.doc.getPages()[0];
  const { width: W, height: H } = first ? first.getCropBox() : { width: 595.28, height: 841.89 };
  const margin = 48;
  const size = 9.5;
  const lh = lineHeight(ctx.font, size);
  let page: PDFPage | null = null;
  let y = 0;
  const newPage = () => {
    page = ctx.doc.addPage([W, H]);
    page.drawText(ctx.encode("Continuation sheet"), { x: margin, y: H - margin, size: 13, font: ctx.bold, color: rgb(0.1, 0.12, 0.2) });
    page.drawText(ctx.encode("Answers that did not fit in their box on the form, in full."), {
      x: margin,
      y: H - margin - 16,
      size: 8.5,
      font: ctx.font,
      color: rgb(0.38, 0.42, 0.48),
    });
    y = H - margin - 40;
  };
  newPage();
  for (const c of ctx.continuations) {
    if (c.table) {
      const cursor = drawContinuationTable(ctx, c.field, c.table, { page: page!, y }, {
        margin,
        width: W - 2 * margin,
        newPage: () => {
          newPage();
          return { page: page!, y };
        },
      });
      page = cursor.page;
      y = cursor.y;
      continue;
    }
    const heading = ctx.encode(continuationHeading(c.field));
    const lines = wrapText(c.text, ctx.font, size, W - 2 * margin);
    if (y - lh * 3 < margin) newPage();
    y = drawWrappedHeading(page!, heading, ctx.bold, margin, y, W - 2 * margin);
    y -= lh * 1.4;
    for (const line of lines) {
      if (y < margin) newPage();
      if (line) page!.drawText(line, { x: margin, y, size, font: ctx.font, color: ANSWER_COLOR });
      y -= lh;
    }
    y -= lh;
  }
}

/** A page's /Rotate as a quarter turn (0, 90, 180 or 270). */
export function pageQuarterTurn(page: PDFPage): 0 | 90 | 180 | 270 {
  const r = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/**
 * A point of the page as a reader shows it – the crop box, turned by /Rotate – in user space, where it
 * is drawn (with `rotate: degrees(quarter)` the text reads left to right on screen). Origin: the visible
 * bottom-left corner.
 */
export function visibleToUserSpace(box: { x: number; y: number; width: number; height: number }, quarter: 0 | 90 | 180 | 270, vx: number, vy: number): { x: number; y: number } {
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  switch (quarter) {
    case 90:
      return { x: x1 - vy, y: y0 + vx };
    case 180:
      return { x: x1 - vx, y: y1 - vy };
    case 270:
      return { x: x0 + vy, y: y1 - vx };
    default:
      return { x: x0 + vx, y: y0 + vy };
  }
}

/** Baseline of the red DRAFT line above the visible bottom edge (pt), and the highest it may move to clear printed text. */
const DRAFT_NOTE_BASELINE = 12;
const DRAFT_NOTE_MAX_BASELINE = 30;

/**
 * Printed text near the foot of each page (a page number, a form reference), in visible coordinates
 * of an upright page: one pdf.js pass over the form. Pages turned by /Rotate are left out (empty).
 */
async function printedFooterText(buf: Uint8Array, doc: PDFDocument): Promise<Array<Array<{ x0: number; x1: number; y0: number; y1: number }>>> {
  const out = doc.getPages().map(() => [] as Array<{ x0: number; x1: number; y0: number; y1: number }>);
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument(pdfjsDocumentParams(buf));
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= Math.min(pdf.numPages, out.length); n += 1) {
        const page = doc.getPages()[n - 1];
        if (pageQuarterTurn(page) !== 0) continue;
        const box = page.getCropBox();
        for (const raw of (await (await pdf.getPage(n)).getTextContent()).items) {
          if (!("str" in raw) || !raw.str.trim()) continue;
          const t = raw.transform as number[];
          const h = raw.height || Math.abs(t[3]) || 8;
          const vy = t[5] - box.y;
          if (vy < DRAFT_NOTE_MAX_BASELINE + 4 && vy + h > 0) out[n - 1].push({ x0: t[4] - box.x, x1: t[4] - box.x + raw.width, y0: vy - h * 0.25, y1: vy + h * 0.8 });
        }
      }
    } finally {
      await task.destroy();
    }
  } catch {
    // Unreadable text: the line keeps its usual place.
  }
  return out;
}

/**
 * The DRAFT watermark and the red line at the foot of every page, placed in the VISIBLE page (crop box
 * and /Rotate): a print-ready file whose media box is larger than its crop box (Aviva CM016) would
 * otherwise have the line drawn outside what readers show. The watermark is sized so its diagonal fits
 * the page (no letter cut off at the corners); the red line moves up, when the form prints something at
 * its place (a page number), to just above it.
 */
function drawDraftMarks(ctx: Ctx, footers: ReadonlyArray<ReadonlyArray<{ x0: number; x1: number; y0: number; y1: number }>>): void {
  const label = "DRAFT - NOT APPROVED";
  const note = "DRAFT - awaiting clinician approval - not for issue";
  const noteSize = 7.5;
  ctx.doc.getPages().forEach((page, i) => {
    const box = page.getCropBox();
    const quarter = pageQuarterTurn(page);
    const W = quarter === 90 || quarter === 270 ? box.height : box.width;
    const H = quarter === 90 || quarter === 270 ? box.width : box.height;
    const t = Math.PI / 4;
    // Width × cos 45° plus the letters' height × sin 45° within 90 % of the shorter side.
    const unit = ctx.bold.widthOfTextAtSize(label, 1);
    const size = Math.min(Math.min(W, H) / 8.5, (0.9 * Math.min(W, H)) / ((unit + 0.7) * Math.cos(t)));
    const w = ctx.bold.widthOfTextAtSize(label, size);
    const h = size * 0.7;
    const mark = visibleToUserSpace(box, quarter, W / 2 - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t), H / 2 - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t));
    page.drawText(label, { ...mark, size, font: ctx.bold, color: DRAFT_RED, opacity: 0.16, rotate: degrees(45 + quarter) });
    const nw = ctx.bold.widthOfTextAtSize(note, noteSize);
    const nx = (W - nw) / 2;
    let baseline = DRAFT_NOTE_BASELINE;
    const clashes = (b: number) => (footers[i] ?? []).filter((r) => r.x1 > nx - 2 && r.x0 < nx + nw + 2 && r.y1 > b - 2 && r.y0 < b + noteSize * 0.75 + 1);
    for (let k = 0; k < 4; k += 1) {
      const hit = clashes(baseline);
      if (hit.length === 0) break;
      const above = Math.max(...hit.map((r) => r.y1)) + 2;
      if (above > DRAFT_NOTE_MAX_BASELINE) break;
      baseline = above;
    }
    const at = visibleToUserSpace(box, quarter, nx, baseline);
    page.drawText(note, { ...at, size: noteSize, font: ctx.bold, color: DRAFT_RED, rotate: degrees(quarter) });
  });
}

/**
 * After flatten(), drop page annotation references to the widget objects pdf-lib deleted (pdf-lib 1.17
 * can leave them in /Annots, and strict readers then report a broken cross-reference table).
 */
function removeDanglingAnnots(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef && !doc.context.lookup(ref)) annots.remove(i);
    }
    if (annots.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
}

/* ------------------------------------------------------------------------------------------------
 * Entry point
 * ----------------------------------------------------------------------------------------------*/

export async function fillPdf(buf: Uint8Array, form: FormDefinition, answers: FormFillAnswers, opts: PdfFillOptions): Promise<Uint8Array> {
  const doc = await loadPdfDocument(buf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pdfForm = doc.getForm();
  const ctx: Ctx = {
    doc,
    pdfForm,
    font,
    bold,
    encode: makeEncoder(font),
    opts,
    warn: (m) => opts.onWarning?.(m),
    error: (m) => (opts.onError ? opts.onError(m) : opts.onWarning?.(m)),
    continuations: [],
  };
  if (pdfForm.hasXFA()) {
    pdfForm.deleteXFA();
    ctx.warn("This was an XFA (dynamic) form: its standard fillable fields were used and the dynamic layout was removed.");
  }

  let printedText: TableFillDeps["printedText"];
  for (const field of form.fields) {
    if (!isAnswerableField(field)) continue;
    const answer = answers[field.id] ?? {};
    const anchor = field.anchor;
    if (anchor.kind === "pdf_field") fillField(ctx, field, answer, anchor);
    else if (anchor.kind === "pdf_char_fields") fillCharFields(ctx, field, answer, anchor);
    else if (anchor.kind === "pdf_overlay") {
      const text = answerText(answer);
      // A date box with printed slashes takes DD, MM and YYYY in their own slots (pdf-overlay-marks.ts).
      if (text && !drawOverlayDateSlots(ctx, field, answer, anchor)) drawOverlay(ctx, field, form.uppercase ? text.toLocaleUpperCase("en-GB") : text, anchor);
    } else if (anchor.kind === "pdf_overlay_ticks") drawOverlayTicks(ctx, field, answer, anchor);
    else if (anchor.kind === "pdf_table" || anchor.kind === "pdf_overlay_table") {
      // Table answers (forms/pdf-table.ts); rows beyond the printed table go to the continuation sheet.
      const deps: TableFillDeps = {
        ...ctx,
        fitText,
        wrapText,
        uppercase: Boolean(form.uppercase),
        addTableContinuation: (f, table) => ctx.continuations.push({ field: f, text: "", table }),
        printedText: printedText ?? (printedText = printedTextLoader(buf)),
      };
      if (answer.rows?.length) {
        if (anchor.kind === "pdf_table") await fillPdfFieldTable(deps, field, anchor, answer.rows);
        else drawOverlayTable(deps, field, anchor, answer.rows);
      }
    } else ctx.warn(`${where(field)}: this question has a Word position, so it cannot be written into a PDF.`);
  }

  if (ctx.continuations.length > 0) addContinuationSheet(ctx);
  if (pdfForm.getFields().length > 0) {
    pdfForm.updateFieldAppearances(font);
    // FINAL copies are always flattened. The Studio's DRAFT copies are flattened too (render-form.ts
    // passes flatten: true), so the "DRAFT – NOT APPROVED" watermark drawn next sits ON TOP of the
    // filled boxes – form widgets would otherwise cover page content.
    if (opts.flatten || !opts.draft) {
      pdfForm.flatten({ updateFieldAppearances: false });
      removeDanglingAnnots(doc);
    }
  }
  if (opts.draft) drawDraftMarks(ctx, await printedFooterText(buf, doc));
  // A classic cross-reference table (no object streams) opens in the widest range of PDF readers.
  return doc.save({ useObjectStreams: false });
}
