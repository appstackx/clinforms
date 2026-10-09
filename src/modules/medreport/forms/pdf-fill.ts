import "server-only";

/**
 * Write answers into the referrer's ORIGINAL PDF (pdf-lib): AcroForm fields by name (text, checkbox,
 * radio, dropdown) for pdf_acroform; text drawn in the analysed box (pdf_overlay, wrapped and shrunk
 * to fit) for pdf_flat. FINAL copies are flattened; DRAFT copies carry a diagonal "DRAFT – NOT APPROVED"
 * watermark on every page and leave sign-off fields blank (the caller passes no receipt).
 *
 * Fitting text: a multi-line field keeps its own font size when the answer fits, otherwise the size
 * shrinks (to 6 pt at the smallest). An answer that still does not fit is cut at a word boundary with
 * "(continued on the continuation sheet)", and the full answer is printed on a continuation sheet added
 * at the end of the form – with a warning (onWarning). Standard PDF fonts are used, so characters
 * outside the Windows-1252 set are transliterated (→ "->", ≥ ">=", ✓ "Yes"…).
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
  degrees,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFForm,
  type PDFPage,
} from "pdf-lib";
import { isAnswerableField, isUnknownAnswer, matchOption, type FormFillAnswer, type FormFillAnswers } from "../core/forms";
import type { FormDefinition, FormField } from "../core/types";
import { loadPdfDocument } from "./pdf-outline";
import type { PdfFillOptions } from "./types";

/** Smallest font for answers: below 8 pt a form is hard to read, so longer answers go to the continuation sheet. */
const MIN_FONT = 8;
const DEFAULT_FONT = 10;
const ANSWER_COLOR = rgb(0.06, 0.09, 0.2);
const DRAFT_RED = rgb(0.71, 0.14, 0.09);
const CONTINUED = " (continued on the continuation sheet)";

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

const lineHeight = (font: PDFFont, size: number) => font.heightAtSize(size) * 1.18;

interface Fit {
  size: number;
  text: string;
  overflow: boolean;
}

/** Largest size ≤ preferred at which the text fits the box; else the text cut to fit at the minimum size. */
export function fitText(text: string, font: PDFFont, box: { width: number; height: number }, preferred: number, multiline: boolean): Fit {
  const fits = (t: string, size: number) =>
    multiline ? wrapText(t, font, size, box.width).length * lineHeight(font, size) <= box.height : font.widthOfTextAtSize(t, size) <= box.width;
  for (let size = preferred; size >= MIN_FONT; size -= 0.5) if (fits(text, size)) return { size, text, overflow: false };
  // Cut at a word boundary so that the text plus the continuation note fits at the minimum size.
  const words = text.split(/(\s+)/);
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(`${words.slice(0, mid).join("").trimEnd()}…${CONTINUED}`, MIN_FONT)) lo = mid;
    else hi = mid - 1;
  }
  const cut = words.slice(0, lo).join("").trimEnd();
  return { size: MIN_FONT, text: cut ? `${cut}…${CONTINUED}` : CONTINUED.trim(), overflow: true };
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

function yesNoOption(options: string[], value: boolean): string | undefined {
  return options.find((o) => (value ? /^\s*(yes|y|on|true)\b/i : /^\s*(no|n|off|false)\b/i).test(o));
}

/** Map an answer to one of the field's export values (via the printed labels when they differ). */
function pickOption(field: FormField, answer: FormFillAnswer, exportValues: string[]): string | null {
  const printed = field.options ?? [];
  const toExport = (label: string | null): string | null => {
    if (!label) return null;
    const direct = matchOption(exportValues, label);
    if (direct) return direct;
    const i = printed.findIndex((p) => p === label);
    return i >= 0 && exportValues[i] ? exportValues[i] : null;
  };
  if (typeof answer.value === "boolean") return toExport(yesNoOption(printed.length ? printed : exportValues, answer.value) ?? null);
  const raw = (typeof answer.value === "string" && answer.value) || answer.text || "";
  if (!raw.trim() || isUnknownAnswer(raw, printed.length ? printed : exportValues)) return null;
  return toExport(matchOption(printed.length ? printed : exportValues, raw) ?? raw);
}

interface Continuation {
  field: FormField;
  text: string;
}

interface Ctx {
  doc: PDFDocument;
  pdfForm: PDFForm;
  font: PDFFont;
  bold: PDFFont;
  encode: (text: string, lost?: string[]) => string;
  opts: PdfFillOptions;
  warn(message: string): void;
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

function fillTextField(ctx: Ctx, field: FormField, tf: PDFTextField, raw: string): void {
  const widget = tf.acroField.getWidgets()[0];
  let text = encodeAnswer(ctx, field, raw);
  const max = tf.getMaxLength();
  if (max !== undefined && text.length > max) {
    ctx.warn(`${where(field)}: the box takes at most ${max} characters, so the answer was shortened.`);
    text = text.slice(0, max);
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
  const fit = fitText(flat, ctx.font, { width: rect.width - 2 * pad - 2, height: rect.height - 2 * pad }, preferred, multiline);
  if (fit.overflow) {
    ctx.warn(`${where(field)}: the answer is longer than the box; it continues on a continuation sheet at the end of the form.`);
    ctx.continuations.push({ field, text });
  }
  tf.setText(fit.text);
  tf.setFontSize(fit.size);
}

function fillField(ctx: Ctx, field: FormField, answer: FormFillAnswer, name: string): void {
  let pdfField;
  try {
    pdfField = ctx.pdfForm.getField(name);
  } catch {
    ctx.warn(`${where(field)}: the form has no field called “${name}”, so it was left blank. Check the form mapping.`);
    return;
  }
  const text = answerText(answer);
  if (pdfField instanceof PDFTextField) {
    if (text) fillTextField(ctx, field, pdfField, text);
    return;
  }
  if (pdfField instanceof PDFCheckBox) {
    const v = typeof answer.value === "boolean" ? answer.value : text ? /^(yes|true|x|ticked|checked)\b/i.test(text) : null;
    if (v === true) pdfField.check();
    else if (v === false) pdfField.uncheck();
    return;
  }
  if (pdfField instanceof PDFRadioGroup) {
    if (!text && typeof answer.value !== "boolean") return;
    const opt = pickOption(field, answer, pdfField.getOptions());
    if (opt && pdfField.getOptions().includes(opt)) pdfField.select(opt);
    else ctx.warn(`${where(field)}: the answer “${text}” does not match any of the form's options, so none was selected.`);
    return;
  }
  if (pdfField instanceof PDFDropdown || pdfField instanceof PDFOptionList) {
    if (!text) return;
    const opt = pickOption(field, answer, pdfField.getOptions());
    if (opt && pdfField.getOptions().includes(opt)) pdfField.select(opt);
    else if (pdfField instanceof PDFDropdown && pdfField.isEditable()) pdfField.select(encodeAnswer(ctx, field, text), true);
    else ctx.warn(`${where(field)}: the answer “${text}” is not one of the list's options, so it was left blank.`);
    return;
  }
  ctx.warn(`${where(field)}: “${name}” is not a field that can be filled (button or signature).`);
}

function drawOverlay(ctx: Ctx, field: FormField, text: string, a: { page: number; x: number; y: number; width: number; height: number; fontSize?: number }): void {
  const page = ctx.doc.getPages()[a.page - 1];
  if (!page) {
    ctx.warn(`${where(field)}: page ${a.page} does not exist in this PDF.`);
    return;
  }
  const encoded = encodeAnswer(ctx, field, text);
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
  const first = ctx.doc.getPages()[0];
  const { width: W, height: H } = first ? first.getSize() : { width: 595.28, height: 841.89 };
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
    const heading = ctx.encode(`${c.field.section ? `${c.field.section} – ` : ""}${c.field.label} (continued)`);
    const lines = wrapText(c.text, ctx.font, size, W - 2 * margin);
    if (y - lh * 3 < margin) newPage();
    page!.drawText(heading, { x: margin, y, size: 10, font: ctx.bold, color: rgb(0.1, 0.12, 0.2) });
    y -= lh * 1.4;
    for (const line of lines) {
      if (y < margin) newPage();
      if (line) page!.drawText(line, { x: margin, y, size, font: ctx.font, color: ANSWER_COLOR });
      y -= lh;
    }
    y -= lh;
  }
}

function drawDraftMarks(ctx: Ctx): void {
  const label = "DRAFT - NOT APPROVED";
  const note = "DRAFT - awaiting clinician approval - not for issue";
  for (const page of ctx.doc.getPages()) {
    const { width: W, height: H } = page.getSize();
    const size = Math.min(W, H) / 8.5;
    const w = ctx.bold.widthOfTextAtSize(label, size);
    const h = size * 0.7;
    const t = Math.PI / 4;
    page.drawText(label, {
      x: W / 2 - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t),
      y: H / 2 - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t),
      size,
      font: ctx.bold,
      color: DRAFT_RED,
      opacity: 0.16,
      rotate: degrees(45),
    });
    const nw = ctx.bold.widthOfTextAtSize(note, 7.5);
    page.drawText(note, { x: (W - nw) / 2, y: 12, size: 7.5, font: ctx.bold, color: DRAFT_RED });
  }
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
    continuations: [],
  };
  if (pdfForm.hasXFA()) {
    pdfForm.deleteXFA();
    ctx.warn("This was an XFA (dynamic) form: its standard fillable fields were used and the dynamic layout was removed.");
  }

  for (const field of form.fields) {
    if (!isAnswerableField(field)) continue;
    const answer = answers[field.id] ?? {};
    const anchor = field.anchor;
    if (anchor.kind === "pdf_field") fillField(ctx, field, answer, anchor.fieldName);
    else if (anchor.kind === "pdf_overlay") {
      const text = answerText(answer);
      if (text) drawOverlay(ctx, field, text, anchor);
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
  if (opts.draft) drawDraftMarks(ctx);
  // A classic cross-reference table (no object streams) opens in the widest range of PDF readers.
  return doc.save({ useObjectStreams: false });
}
