import "server-only";

/**
 * AcroForm answers that pdf-lib's high-level setters get wrong on real insurer forms (used by
 * forms/pdf-fill.ts):
 *
 * - Tick boxes with several widgets and different on-values (AXA's "Was the patient referred?" is ONE
 *   field with a "no" widget and a "Yes" widget): pdf-lib's check() / setValue() only accept the first
 *   widget's on-value, so a Yes ticked "No". setCheckBoxState() sets /V and every widget's /AS itself,
 *   then redraws the box: form-designed ticks that pdf.js and poppler do not show (AXA strokes its black
 *   tick over in white) become a visible tick.
 * - Radio groups whose export values are not the printed labels (Bupa's "Choice1"…"Choice6", printed
 *   right to left as Other, Dr, Mr, Ms, Mrs, Miss): the answer is matched to the printed label, then to
 *   its export value through the anchor's optionLabels (pickExportValue).
 * - One question across separate tick-box fields (anchor.optionFields: Freedom's "Yes" box and "No"
 *   box, AXA's six therapist-type boxes): the matching box is ticked, the others cleared.
 * - Boxes with a character limit (comb date boxes take 8 or 6): a date is written DDMMYYYY / DDMMYY;
 *   other answers lose spaces and separators before anything is cut, and a cut answer is an ERROR
 *   (the form would be wrong), never a quiet warning (fitMaxLength).
 * - One-character boxes (pdf_char_fields): one character per box (charFieldTexts).
 * - Text fields whose default appearance (/DA) sits on the widget, a parent field or the form itself
 *   (Allianz Care's pre-authorisation form): pdf-lib's setFontSize() reads only the field's own /DA and
 *   throws, so ensureTextFieldDA() copies the inherited one onto the field first.
 *
 * Owner: forms-engine agent.
 */
import { PDFDict, PDFHexString, PDFName, PDFString, type PDFCheckBox, type PDFFont, type PDFForm, type PDFTextField, type PDFWidgetAnnotation } from "pdf-lib";
import { isUnknownAnswer, matchOption, type FormFillAnswer } from "../core/forms";
import { isValidIsoDate, parseUkDate } from "../core/dates";
import type { FormField, PdfCharFieldsAnchor, PdfFieldAnchor } from "../core/types";

/* ------------------------------------------------------------------------------------------------
 * What an answer asks for
 * ----------------------------------------------------------------------------------------------*/

export type WantedOption = { kind: "none" } | { kind: "bool"; value: boolean } | { kind: "text"; text: string };

export function wantedOf(answer: FormFillAnswer): WantedOption {
  if (typeof answer.value === "boolean") return { kind: "bool", value: answer.value };
  const raw = ((typeof answer.value === "string" && answer.value) || answer.text || "").trim();
  return raw ? { kind: "text", text: raw } : { kind: "none" };
}

const YES_RE = /^\s*(?:yes|y|on|true)\b/i;
const NO_RE = /^\s*(?:no|n|off|false)\b/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Index of the option an answer picks: a boolean picks the "Yes" / "No" option; text picks the option
 * it names (exactly, then core/forms.ts matchOption). `labels` are the printed labels ("" = none
 * printed); `fallback` (e.g. on-values or export values, aligned with labels) is tried after them.
 * -1 when nothing matches or the answer says the information is not known.
 */
export function chooseOptionIndex(labels: readonly string[], wanted: WantedOption, fallback: readonly string[] = []): number {
  if (wanted.kind === "none") return -1;
  const lists = [labels, fallback].filter((l) => l.length > 0);
  if (wanted.kind === "bool") {
    const re = wanted.value ? YES_RE : NO_RE;
    for (const list of lists) {
      const i = list.findIndex((o) => Boolean(o) && re.test(o));
      if (i >= 0) return i;
    }
    return -1;
  }
  const all = lists.reduce<string[]>((acc, l) => acc.concat(l.filter(Boolean)), []);
  if (isUnknownAnswer(wanted.text, all)) return -1;
  const t = norm(wanted.text);
  for (const list of lists) {
    const exact = list.findIndex((o) => Boolean(o) && norm(o) === t);
    if (exact >= 0) return exact;
  }
  for (const list of lists) {
    const named = matchOption(list.map((o) => o || "\u0000"), wanted.text);
    if (named !== null) return list.indexOf(named);
  }
  return -1;
}

/* ------------------------------------------------------------------------------------------------
 * Radio groups and lists
 * ----------------------------------------------------------------------------------------------*/

/** The anchor's printed labels aligned with the PDF's export values (empty when unknown). */
export function labelsForExportValues(anchor: PdfFieldAnchor | null, exportValues: string[]): string[] {
  const labels = anchor?.optionLabels;
  if (!labels?.length) return [];
  const mapped = anchor?.options?.length ? anchor.options : null;
  if (!mapped) return labels.length === exportValues.length ? labels.slice() : [];
  return exportValues.map((v) => {
    const i = mapped.indexOf(v);
    return i >= 0 ? labels[i] ?? "" : "";
  });
}

/**
 * The export value to select for an answer, or null. The answer is first read against the question's
 * printed options (FormField.options, e.g. "Mrs"), then matched to the export value printed with that
 * label (anchor.optionLabels), then to an export value directly. Only without printed labels does the
 * order of FormField.options stand in for the export values (maps made before optionLabels existed).
 */
export function pickExportValue(field: Pick<FormField, "options">, anchor: PdfFieldAnchor | null, answer: FormFillAnswer, exportValues: string[]): string | null {
  const labels = labelsForExportValues(anchor, exportValues);
  const printed = field.options?.length ? field.options : labels.filter(Boolean);
  const wanted = wantedOf(answer);
  if (wanted.kind === "none") return null;
  let target: string | null;
  if (wanted.kind === "bool") {
    const list = printed.length ? printed : exportValues;
    target = list.find((o) => (wanted.value ? YES_RE : NO_RE).test(o)) ?? null;
  } else {
    if (isUnknownAnswer(wanted.text, printed.length ? printed : exportValues)) return null;
    target = matchOption(printed, wanted.text) ?? wanted.text;
  }
  if (!target) return null;
  if (labels.length) {
    const byLabel = labels.findIndex((l) => Boolean(l) && norm(l) === norm(target as string));
    if (byLabel >= 0) return exportValues[byLabel] ?? null;
  }
  const direct = matchOption(exportValues, target);
  if (direct) return direct;
  if (labels.length) {
    const i = chooseOptionIndex(labels, { kind: "text", text: target });
    return i >= 0 ? exportValues[i] ?? null : null;
  }
  const i = printed.findIndex((p) => p === target);
  return i >= 0 && exportValues[i] ? exportValues[i] : null;
}

/* ------------------------------------------------------------------------------------------------
 * Tick boxes
 * ----------------------------------------------------------------------------------------------*/

const OFF = PDFName.of("Off");

export function widgetOnValue(w: PDFWidgetAnnotation): PDFName {
  return w.getOnValue() ?? PDFName.of("Yes");
}

/** The distinct on-values of a tick box's widgets, in widget order. */
export function checkBoxOnValues(cb: PDFCheckBox): PDFName[] {
  const out: PDFName[] = [];
  for (const w of cb.acroField.getWidgets()) {
    const v = widgetOnValue(w);
    if (out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/** True when the last colour set in a /DA string is so light that a tick drawn in it cannot be seen. */
export function isLightDaColour(da: string): boolean {
  const re = /((?:\d*\.\d+|\d+)(?:\s+(?:\d*\.\d+|\d+)){0,3})\s+(g|rg|k)(?=\s|$)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(da)) !== null) last = m;
  if (!last) return false;
  const n = last[1].trim().split(/\s+/).map(Number);
  if (last[2] === "g") return n.length === 1 && n[0] >= 0.75;
  if (last[2] === "rg") return n.length === 3 && n.every((c) => c >= 0.75);
  return n.length === 4 && n.every((c) => c <= 0.25);
}

/**
 * Tick a box at one of its widgets' on-values (null = clear it): /V on the field and /AS on every
 * widget set by hand, then the box redrawn with a plain visible tick (a tick colour too light to see is
 * replaced with black first).
 */
export function setCheckBoxState(cb: PDFCheckBox, on: PDFName | null): void {
  const acro = cb.acroField;
  acro.dict.set(PDFName.of("V"), on ?? OFF);
  for (const w of acro.getWidgets()) {
    w.setAppearanceState(on && widgetOnValue(w) === on ? on : OFF);
    if (isLightDaColour(w.getDefaultAppearance() ?? "")) w.setDefaultAppearance("0 g");
  }
  if (isLightDaColour(acro.getDefaultAppearance() ?? "")) acro.setDefaultAppearance("0 g");
  cb.updateAppearances();
}

/** The on-value of a box for an option field: the given one when a widget has it, else the box's first. */
export function onValueFor(cb: PDFCheckBox, onValue: string | undefined): PDFName | null {
  const values = checkBoxOnValues(cb);
  if (!onValue) return values[0] ?? null;
  return values.find((v) => v.decodeText() === onValue) ?? values.find((v) => norm(v.decodeText()) === norm(onValue)) ?? null;
}

export type TickChoice = { kind: "none" } | { kind: "set"; on: PDFName | null } | { kind: "unmatched" };

/**
 * What to do with a tick box for an answer. One on-value: ticked for a yes-like answer, cleared for any
 * other answer (as before). Several on-values (one widget per option): the widget whose printed label
 * (anchor.optionLabels) or on-value matches the answer; a "No" with no "No" widget clears the box.
 */
export function checkBoxChoice(cb: PDFCheckBox, anchor: PdfFieldAnchor | null, answer: FormFillAnswer): TickChoice {
  const wanted = wantedOf(answer);
  if (wanted.kind === "none") return { kind: "none" };
  const onValues = checkBoxOnValues(cb);
  if (onValues.length <= 1) {
    const yes = wanted.kind === "bool" ? wanted.value : /^(yes|true|x|ticked|checked)\b/i.test(wanted.text);
    return { kind: "set", on: yes ? onValues[0] ?? PDFName.of("Yes") : null };
  }
  const names = onValues.map((v) => v.decodeText());
  const labels = names.map((n) => {
    const i = anchor?.options?.indexOf(n) ?? -1;
    return (i >= 0 ? anchor?.optionLabels?.[i] : undefined) ?? "";
  });
  const i = chooseOptionIndex(labels, wanted, names);
  if (i >= 0) return { kind: "set", on: onValues[i] };
  if (wanted.kind === "bool" && !wanted.value) return { kind: "set", on: null };
  return { kind: "unmatched" };
}

/* ------------------------------------------------------------------------------------------------
 * Character limits and one-character boxes
 * ----------------------------------------------------------------------------------------------*/

/** The answer's date (ISO) when it is one: a date value, or the text of a date question. */
export function answerIsoDate(field: Pick<FormField, "answerType">, answer: FormFillAnswer): string | null {
  if (typeof answer.value === "string" && isValidIsoDate(answer.value)) return answer.value;
  if (field.answerType !== "date" && field.answerType !== "date_signed") return null;
  const t = (answer.text ?? "").trim();
  if (isValidIsoDate(t)) return t;
  return t ? parseUkDate(t) : null;
}

/** "2026-10-09" → "09102026" (DDMMYYYY) or "091026" (DDMMYY). */
export function dateDigits(iso: string, format: "DDMMYYYY" | "DDMMYY"): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${format === "DDMMYYYY" ? y : y.slice(2)}`;
}

export interface MaxLengthFit {
  text: string;
  /** How the answer was shortened without losing anything ("" = written as it is). */
  compacted: "" | "date" | "spaces" | "separators";
  /** True when characters had to be cut off: the written value is WRONG. */
  cut: boolean;
}

const SEPARATORS_RE = /[\s\-/.,:]+/g;

/**
 * Fit an answer into a box that takes at most `max` characters: a date in 8 (or 6) boxes is written
 * DDMMYYYY (or DDMMYY); otherwise spaces, then spaces and separators, are taken out before anything is
 * cut. `cut` reports what could not be saved.
 */
export function fitMaxLength(text: string, max: number, isoDate: string | null): MaxLengthFit {
  if (isoDate && (max === 8 || max === 6)) {
    const digits = dateDigits(isoDate, max === 8 ? "DDMMYYYY" : "DDMMYY");
    return { text: digits, compacted: text === digits ? "" : "date", cut: false };
  }
  if (text.length <= max) return { text, compacted: "", cut: false };
  const noSpaces = text.replace(/\s+/g, "");
  if (noSpaces.length <= max) return { text: noSpaces, compacted: "spaces", cut: false };
  const bare = text.replace(SEPARATORS_RE, "");
  if (bare.length <= max) return { text: bare, compacted: "separators", cut: false };
  return { text: bare.slice(0, max), compacted: "separators", cut: true };
}

export type CharFieldsResult = { kind: "none" } | { kind: "not_a_date" } | { kind: "ok"; chars: string[]; cut: boolean; value: string };

/**
 * One character per box for a pdf_char_fields anchor (boxes beyond the answer stay empty). `text` is
 * the answer as written (already in the form's character set); a date format takes the ISO value, or
 * the text as DD/MM/YYYY.
 */
export function charFieldTexts(anchor: PdfCharFieldsAnchor, answer: FormFillAnswer, text: string): CharFieldsResult {
  const n = anchor.fieldNames.length;
  const t = text.trim();
  let value: string;
  if (anchor.format === "chars") {
    if (!t) return { kind: "none" };
    value = t;
    if (value.length > n) value = value.replace(/\s+/g, "");
    if (value.length > n) value = value.replace(SEPARATORS_RE, "");
  } else {
    const iso = typeof answer.value === "string" && isValidIsoDate(answer.value) ? answer.value : isValidIsoDate(t) ? t : t ? parseUkDate(t) : null;
    if (!iso) return t ? { kind: "not_a_date" } : { kind: "none" };
    value = dateDigits(iso, anchor.format);
  }
  const chars = Array.from(value);
  return { kind: "ok", chars: chars.slice(0, n), cut: chars.length > n, value };
}

/** Font size for one character in a box: the form's own size when it fits the box, never below 6 pt. */
export function charBoxFontSize(font: PDFFont, daSize: number | null, box: { width: number; height: number }): number {
  let size = Math.min(daSize || 10, Math.max(6, box.height - 4));
  while (size > 6 && font.widthOfTextAtSize("W", size) > box.width - 2) size -= 0.5;
  return size;
}

/* ------------------------------------------------------------------------------------------------
 * Default appearance of a text field
 * ----------------------------------------------------------------------------------------------*/

/** A font operator in a /DA string, as pdf-lib's setFontSize() looks for it. */
const DA_TF_RE = /\/[^\0\t\n\f\r ]+[\0\t\n\f\r ]*(?:\d*\.\d+|\d+)?[\0\t\n\f\r ]+Tf/;
/** A colour operator (gray, RGB or CMYK) in a /DA string. */
const DA_COLOUR_RE = /(?:^|\s)(?:g|rg|k)(?:\s|$)/;

function daOf(dict: PDFDict | undefined): string | undefined {
  const da = dict?.lookup(PDFName.of("DA"));
  if (da instanceof PDFString) return da.asString();
  if (da instanceof PDFHexString) return da.decodeText();
  return undefined;
}

/**
 * Give a text field its own default appearance (/DA) with a font operator, so its font size can be set.
 * PDF readers inherit /DA from the widget, the parent fields and the form's AcroForm dictionary; pdf-lib
 * reads only the field's own entry and setFontSize() throws without one (MissingDAEntryError /
 * MissingTfOperatorError). The inherited value is copied (colour kept); "/Helv 0 Tf 0 g" when the form
 * gives none. The appearance is redrawn with the embedded font afterwards, so the font name only has to
 * be well-formed.
 */
export function ensureTextFieldDA(pdfForm: PDFForm, tf: PDFTextField): void {
  const acro = tf.acroField;
  const own = acro.getDefaultAppearance();
  if (own && DA_TF_RE.test(own)) return;
  const candidates: Array<string | undefined> = [own];
  for (const w of acro.getWidgets()) candidates.push(w.getDefaultAppearance());
  let parent = acro.dict.lookup(PDFName.of("Parent"));
  for (let depth = 0; parent instanceof PDFDict && depth < 16; depth += 1) {
    candidates.push(daOf(parent));
    parent = parent.lookup(PDFName.of("Parent"));
  }
  candidates.push(daOf(pdfForm.acroForm.dict));
  const present = candidates.filter((d): d is string => Boolean(d && d.trim()));
  const withFont = present.find((d) => DA_TF_RE.test(d));
  let da = withFont ?? `${present[0] ?? ""} /Helv 0 Tf`.trim();
  if (!DA_COLOUR_RE.test(da)) da = `${da} 0 g`;
  acro.setDefaultAppearance(da);
}
