/**
 * Which printed options an answer chooses on a referrer's form – the ONE reading the forms engine marks with (WA2 design
 * 2) and the validators check approval with (WA1 design 5: an unknown or unmatched answer on a choice field blocks, Q-1).
 *
 *   resolveChoice(field, answer, options)  → chosen (these printed options; [] = explicitly none of them)
 *                                           | none_given (no answer yet) | unknown ("Not recorded") | unmatched
 *   choiceAnswerMatches(field, answer)      a stored structured answer the FINAL fill can mark exactly (true also when
 *                                           there is nothing to match: no answer yet, rows, or a box with no options)
 *
 * Choice anchors (checkbox_glyph, mark_cell, delete_options) end explicit on the issued form: the chosen options marked
 * or kept, every other one cleared. An answer the engine cannot read as printed options – "Not recorded", "Hydrotherapy"
 * for "Exercise / Manual therapy / Acupuncture" – is never issued over the printed defaults: the validators block it, and
 * a FINAL fill that still meets one refuses (forms/docx-fill.ts outcome, render-form.ts 422).
 *
 * The rules (unchanged from the engine's reading, 10/2026):
 * - Yes / No: a single printed option is ticked (Yes) or left unticked (No); otherwise the option that starts with
 *   "Yes" / "No" (or a printed "Y" / "N") is chosen, and a form printing neither cannot take that answer;
 * - text answers on a yes / no or tick box: "Yes…", "True", "Ticked" / "No…", "False" read as yes / no;
 * - a "tick all that apply" row read as text ("Neck, Back"; a mark_cell anchor on a short or long text question): every
 *   printed option named is chosen, "None" / "Nil" chooses none, and anything else named makes the answer unmatched;
 * - otherwise core/forms matchOption (exact, a leading whole option, or the unambiguous start of one) – but (review
 *   26/10) an answer naming two or more printed options of a single choice ("Arm and leg" for "Spine / Arm / Leg") is
 *   unmatched, never read as its first option; a yes and a no ("Yes – no restrictions") is still read as its first;
 * "Not recorded", "Unknown", "N/A"… (core/forms isUnknownAnswer) never choose anything – never a definite "No"; nor
 * (review 26/10) does "No" followed by words that say the information is missing ("No idea", "No info", "No mention in
 * the notes", "No answer recorded", "No recollection"), whatever a value beside the text says.
 *
 * Pure – no server-only code: core/validation imports it, and core runs in the browser.
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import { isUnknownAnswer, matchOption, namedOptions, yesNoOption } from "../core/forms";
import type { FormAnswer, FormField } from "../core/types";

/** What an answer chooses among a choice field's printed options. */
export type ChoiceResolution =
  /** No answer to read (no text and no value). */
  | { kind: "none_given" }
  /** These printed options are chosen; `options` may be empty – the answer chooses none of them ("No" on a single box, "None"). */
  | { kind: "chosen"; options: string[] }
  /** The answer says the information is not known ("Not recorded"): it chooses nothing and is not an answer. */
  | { kind: "unknown"; text: string }
  /** The answer is none of the printed options (`text`: what was not matched). */
  | { kind: "unmatched"; text: string };

/** The field facts the reading needs (answerType is optional for callers that hold only the anchor and options). */
export type ChoiceField = Pick<FormField, "anchor" | "options"> & Partial<Pick<FormField, "answerType">>;

/** An answer as the engine receives it (core/forms FormFillAnswer) or as a stored structured answer's text and value. */
export interface ChoiceAnswer {
  text?: string;
  value?: string | boolean | null;
}

/** A choice anchor: the engine marks, ticks or keeps printed options there (never writes the answer as text). */
export function isChoiceAnchor(field: Pick<FormField, "anchor">): boolean {
  const a = field.anchor;
  return a.kind === "docx" && (a.target === "checkbox_glyph" || a.target === "mark_cell" || a.target === "delete_options");
}

/** A "tick all that apply" row read as text: a mark-the-column anchor on a short or long text question. */
export function isTextGrid(field: ChoiceField, answer?: ChoiceAnswer): boolean {
  const a = field.anchor;
  if (a.kind !== "docx" || a.target !== "mark_cell") return false;
  if (field.answerType) return field.answerType === "short_text" || field.answerType === "long_text";
  return answer?.value === undefined || answer.value === null;
}

/** The options as printed: the map's own list, else the anchor's marked cells, tick boxes or kept options. */
export function printedOptions(field: Pick<FormField, "anchor" | "options">): string[] {
  if (field.options?.length) return field.options;
  if (field.anchor.kind !== "docx") return [];
  if (field.anchor.target === "mark_cell") return (field.anchor.optionCells ?? []).map((c) => c.option);
  if (field.anchor.target === "checkbox_glyph") return (field.anchor.optionGlyphs ?? []).map((g) => g.option);
  return (field.anchor.optionTexts ?? []).map((o) => o.option);
}

const YES_TEXT = /^(?:yes|true|ticked|checked)\b/i;
const NO_TEXT = /^(?:no|false)\b/i;

/**
 * "No" followed by words that say the information is missing (Q-1, review 26/10): "No idea", "No info", "No mention in
 * the notes", "No answer recorded", "No recollection", "No response from the patient". A narrow class of words for
 * knowing or recording – a clinical negative ("No pain", "No restrictions", "No evidence of instability") stays a No.
 */
const NO_BUT_NOT_KNOWN = /^no\s+(?:idea|info|information|mention(?:ed)?|answers?|recollection|memory|knowledge|notes?|record(?:s|ed)?|documentation|data|details|comments?|reply|entry|response\s+(?:from|given|received|recorded|yet))\b/i;

/** The answer says the information is not known (core/forms isUnknownAnswer, or "No" + a word for missing knowledge). */
function saysNotKnown(text: string, options: readonly string[]): boolean {
  if (isUnknownAnswer(text, options)) return true;
  const t = text.trim().replace(/\s+/g, " ");
  if (options.some((o) => o.trim().replace(/\s+/g, " ").toLowerCase() === t.toLowerCase())) return false;
  return NO_BUT_NOT_KNOWN.test(t);
}

/** Two or more printed options named in one answer to a single choice (not a yes beside a no: "Yes – no restrictions"). */
function namesSeveral(options: readonly string[], text: string): boolean {
  if (options.length < 2) return false;
  const { matched } = namedOptions(options, text);
  if (matched.length < 2) return false;
  const yes = yesNoOption(options, true);
  const no = yesNoOption(options, false);
  return !(matched.length === 2 && yes && no && matched.includes(yes) && matched.includes(no));
}

/**
 * Bounded work (review 26/10): a choice answer longer than this, or a list of more printed options, is none of them –
 * reading it against every option would cost options × characters (no real form comes near: Blue Heart's longest list
 * prints 11 options).
 */
export const MAX_CHOICE_TEXT = 1_000;
export const MAX_CHOICE_OPTIONS = 200;

/** What `answer` chooses among `options` (the anchor's printed options, in the anchor's order). Pure. */
export function resolveChoice(field: ChoiceField, answer: ChoiceAnswer, options: readonly string[]): ChoiceResolution {
  const value = answer.value;
  const text = (answer.text ?? "").trim();
  if (text.length > MAX_CHOICE_TEXT || (typeof value === "string" && value.length > MAX_CHOICE_TEXT) || options.length > MAX_CHOICE_OPTIONS) {
    return { kind: "unmatched", text: (text || String(value ?? "")).slice(0, 80) };
  }
  if (isTextGrid(field, answer)) {
    if (!text) return { kind: "none_given" };
    if (saysNotKnown(text, options)) return { kind: "unknown", text };
    const named = namedOptions(options, text);
    return named.unmatched ? { kind: "unmatched", text: named.unmatched } : { kind: "chosen", options: named.matched };
  }
  const yes = yesNoOption(options, true);
  const no = yesNoOption(options, false);
  // Text that says it is not known, or names several options of a single choice, is never a choice – whatever value
  // was read from it (review 26/10).
  if (text && saysNotKnown(text, options)) return { kind: "unknown", text };
  if (text && namesSeveral(options, text) && !options.some((o) => o.trim().toLowerCase() === text.toLowerCase())) return { kind: "unmatched", text };
  if (typeof value === "boolean") {
    if (options.length === 1) return { kind: "chosen", options: value ? options.slice() : [] };
    const pick = value ? yes : no;
    return pick ? { kind: "chosen", options: [pick] } : { kind: "unmatched", text: value ? "Yes" : "No" };
  }
  const raw = typeof value === "string" && value.trim() ? value.trim() : text;
  if (!raw) return { kind: "none_given" };
  if (saysNotKnown(raw, options)) return { kind: "unknown", text: raw };
  if (field.answerType === "yes_no" || field.answerType === "checkbox") {
    if (YES_TEXT.test(raw)) {
      if (options.length === 1) return { kind: "chosen", options: options.slice() };
      return yes ? { kind: "chosen", options: [yes] } : { kind: "unmatched", text: raw };
    }
    if (NO_TEXT.test(raw)) {
      if (no) return { kind: "chosen", options: [no] };
      return options.length === 1 ? { kind: "chosen", options: [] } : { kind: "unmatched", text: raw };
    }
  }
  const exact = options.find((o) => o.trim().toLowerCase().replace(/\s+/g, " ") === raw.toLowerCase().replace(/\s+/g, " "));
  if (exact) return { kind: "chosen", options: [exact] };
  // A single choice answered with several of its printed options is none of them (review 26/10): never the first only.
  if (namesSeveral(options, raw)) return { kind: "unmatched", text: raw };
  const match = matchOption(options, raw);
  return match ? { kind: "chosen", options: [match] } : { kind: "unmatched", text: raw };
}

/**
 * Does a stored structured answer select printed options the FINAL fill can mark exactly? (WA2 design 2, exported for
 * WA1 design 5.) false for an unknown or unmatched answer on a field that prints options – a structured value, or (Q-1)
 * a text answer on a choice anchor. true when there is nothing to match: no answer yet (placeholders.ts's job), table
 * rows, free text on a text box, or a field that prints no options.
 */
export function choiceAnswerMatches(field: ChoiceField, answer: FormAnswer | null | undefined): boolean {
  if (!answer || answer.value === null || Array.isArray(answer.value)) return true;
  const options = printedOptions(field);
  if (options.length === 0) return true;
  if (answer.kind === "text") {
    if (!isChoiceAnchor(field) || typeof answer.value !== "string") return true;
    const r = resolveChoice(field, { text: answer.value }, options);
    return r.kind === "chosen" || r.kind === "none_given";
  }
  if (typeof answer.value !== "boolean" && typeof answer.value !== "string") return true;
  // A structured value on a text-typed grid is read as its text.
  const r = field.answerType && isTextGrid(field) ? resolveChoice(field, { text: String(answer.value) }, options) : resolveChoice(field, { value: answer.value }, options);
  return r.kind === "chosen" || r.kind === "none_given";
}
