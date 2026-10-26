/**
 * Referrer forms – answers: the printed option an answer names, a record value or a raw answer as the structured
 * answer, the answer as text, whether a box is answered or left blank, and the answers map the forms engine writes into
 * the referrer's original file (buildFormAnswers).
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * Owner: WA1 (issue state) – docs/bh2-ownership.json.
 */
import { isReleaseModel, issueDetails } from "../issue-state";
import { formatUkDate, isValidIsoDate, parseUkDate, todayIso } from "../dates";
import { hasRowContent, rowsToText } from "../form-tables";
import type { FormAnswer, FormAnswerRow, FormDefinition, FormField, Report, ReportSection, SignReceipt, SignoffPart } from "../types";
import { answerKindFor, answerableFields } from "./fields";
import type { ResolvedFormValue } from "./record-paths";

/**
 * True when an answer says the information is NOT known ("Not recorded", "Unknown", "N/A",
 * "Nothing documented", "No information"…). Such an answer must stay blank (and raise a gap) – it must
 * never tick "No" or pick an option.
 */
export function isUnknownAnswer(text: string, options?: readonly string[]): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
  if (!t) return false;
  // A printed option is never "unknown", even when it reads like one ("Not applicable", "Not known").
  if (options?.some((o) => o.trim().toLowerCase().replace(/\s+/g, " ") === t)) return false;
  if (/^(?:n\/?a|n\.a\.?|unknown|unk|tbc|tbd|nil known|\?+|-+|–|—)$/.test(t.replace(/[.!]+$/, ""))) return true;
  return /\b(?:not (?:recorded|known|documented|stated|specified|assessed|available|applicable|noted|reported|provided|given|clear|determined|tested|measured)|unknown|nothing (?:documented|recorded|noted|known)|no (?:record|records|information|data|details|documentation|opinion|entry)\b|(?:unable|not able) to (?:say|comment|determine|confirm|answer)|cannot (?:say|comment|confirm|be (?:determined|confirmed|answered))|can't (?:say|comment|confirm)|insufficient (?:information|evidence)|unclear|not in the (?:record|records|notes))/.test(t);
}

/**
 * The printed option an answer refers to, or null. Case-insensitive:
 * 1. exact match;
 * 2. the answer starts with an option followed by a boundary ("Yes – see below" → "Yes"; the longest
 *    such option wins);
 * 3. the answer is the start of exactly ONE option, ends at a word boundary there and is at least three
 *    characters ("Fit with" → "Fit with adjustments") – single letters only for Yes/No ("Y" → "Yes").
 * Answers that say the information is not known (isUnknownAnswer) never match: "Not recorded" must not
 * tick "No", "Yesterday" must not tick "Yes" and "N" must not pick "None".
 */
export function matchOption(options: readonly string[] | undefined, text: string): string | null {
  if (!options?.length) return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const norm = options.map((o) => o.trim().toLowerCase().replace(/\s+/g, " "));
  const exact = norm.indexOf(t);
  if (exact >= 0) return options[exact];
  if (isUnknownAnswer(t)) return null;

  // 2. "<option><boundary>…": the answer begins with a whole option.
  let best = -1;
  norm.forEach((o, i) => {
    if (!o || !t.startsWith(o)) return;
    const next = t.charAt(o.length);
    if (!/^[\s,.;:()\u2013\u2014/-]$/.test(next)) return;
    if (best < 0 || o.length > norm[best].length) best = i;
  });
  if (best >= 0) return options[best];

  // 3. The answer abbreviates exactly one option.
  if (t.length === 1) {
    const yesNo = norm.map((o, i) => ({ o, i })).filter(({ o }) => (t === "y" && /^yes\b/.test(o)) || (t === "n" && /^no\b/.test(o)));
    return yesNo.length === 1 ? options[yesNo[0].i] : null;
  }
  if (t.length < 3) return null;
  const prefixes = norm
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.startsWith(t) && (o.length === t.length || /^[\s,.;:()\u2013\u2014/-]$/.test(o.charAt(t.length))));
  return prefixes.length === 1 ? options[prefixes[0].i] : null;
}

/**
 * The printed option a yes / no answer picks (10/2026): the option that starts with "Yes" / "No", else one printed as
 * the single letter "Y" / "N" (the readings take a "Y | N" pair as yes / no). Null when neither is printed. Pure.
 */
export function yesNoOption(options: readonly string[] | undefined, value: boolean): string | null {
  const list = options ?? [];
  const word = value ? /^\s*yes\b/i : /^\s*no\b/i;
  const letter = value ? /^\s*y\.?\s*$/i : /^\s*n\.?\s*$/i;
  return list.find((o) => word.test(o)) ?? list.find((o) => letter.test(o)) ?? null;
}

/** An answer that says no printed option applies ("None", "Nil", "N/A"): nothing is marked (10/2026). */
const NONE_OF_THEM = /^(?:none|nil|no|n\/a|not applicable|none of (?:them|these|the above))\.?$/i;

/**
 * The printed options a TEXT answer names (10/2026: a "tick all that apply" row of a mark-the-column table, answered as
 * text such as "Neck, Back"): every option is matched whole (case-insensitive, longest first, so "None or N/A"
 * stays one option); `unmatched` is whatever else the answer says. "None" / "Nil" / "N/A" name no option and leave
 * nothing unmatched. Pure.
 */
export function namedOptions(options: readonly string[] | undefined, text: string): { matched: string[]; unmatched: string } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || NONE_OF_THEM.test(t)) return { matched: [], unmatched: "" };
  let rest = t;
  const matched: string[] = [];
  const byLength = (options ?? []).map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o).sort((a, b) => b.o.length - a.o.length);
  for (const { o, i } of byLength) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-z0-9])`, "i");
    const m = re.exec(rest);
    if (!m) continue;
    matched.push((options ?? [])[i]);
    rest = `${rest.slice(0, m.index)}${m[1]} ${rest.slice(m.index + m[0].length)}`;
  }
  const unmatched = rest
    .replace(/\b(?:and|or|both|also)\b/gi, " ")
    .replace(/[\s,;/&+.:()-]+/g, " ")
    .trim();
  const order = new Map((options ?? []).map((o, i) => [o, i] as const));
  return { matched: matched.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), unmatched };
}

/** Convert a resolved value into the structured answer for a field (null value when it does not fit). */
export function toFormAnswer(field: FormField, resolved: ResolvedFormValue | null): FormAnswer {
  const kind = answerKindFor(field.answerType);
  if (!resolved) return { kind, value: null };
  switch (kind) {
    case "text":
      return { kind, value: null };
    case "date": {
      const v = typeof resolved.value === "string" ? resolved.value : "";
      const iso = isValidIsoDate(v) ? v : parseUkDate(resolved.text);
      return { kind, value: iso };
    }
    case "number": {
      const m = /-?\d+(?:\.\d+)?/.exec(String(resolved.value));
      return { kind, value: m ? m[0] : null };
    }
    case "choice":
      return { kind, value: matchOption(field.options, resolved.text) };
    case "yes_no":
    case "checkbox":
      return { kind, value: typeof resolved.value === "boolean" ? resolved.value : null };
    case "rows":
      // Table answers are built from the record by core/form-tables.ts, never from a single value.
      return { kind, value: null };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Answers → text, and the map the forms engine writes into the original file
 * ----------------------------------------------------------------------------------------------*/

/**
 * The answer as plain text (review list, preview, text anchors): the structured value for yes/no,
 * tick box, choice ("" when unset), date (DD/MM/YYYY) and number; otherwise the paragraphs joined by
 * blank lines.
 */
export function answerToText(section: Pick<ReportSection, "paragraphs" | "answer">): string {
  const answer = section.answer;
  // Table answers: one line per row (core/form-tables.ts rowsToText).
  if (answer?.kind === "rows") return Array.isArray(answer.value) ? rowsToText(answer.value) : "";
  if (answer && answer.kind !== "text") {
    const v = answer.value;
    if (v === null || v === "") return "";
    switch (answer.kind) {
      case "yes_no":
      case "checkbox":
        return v === true ? "Yes" : v === false ? "No" : String(v);
      case "date":
        return typeof v === "string" && isValidIsoDate(v) ? formatUkDate(v) : String(v);
      default:
        return String(v);
    }
  }
  return section.paragraphs
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * True when the section holds an answer. Structured answers (yes/no, tick box, choice, date, number)
 * are answered only by their value – their paragraphs are supporting text, not the answer. Text
 * answers are answered when a paragraph has text.
 */
/**
 * Verify fix (10/2026): whether a section's "left empty on purpose" (blankFromRecords) counts – only for the question
 * it can come from: a line (2 or later) of an address printed over several lines (a registration fill source with a
 * `part`, core/report-factory.ts). The flag travels with the report the browser sends, so the approval checks, the
 * merge-code check and the forms engine never take it from any other question (a staff entry, a clinical answer, a
 * clinic-system code such as <<P_SURNAME>>) – there an empty answer stays unanswered and blocks approval.
 */
export function isBlankByDesign(section: Pick<ReportSection, "blankFromRecords"> | null | undefined, field: Pick<FormField, "fillSource"> | null | undefined): boolean {
  if (!section?.blankFromRecords || !field || field.fillSource.kind !== "registration") return false;
  const { path, part } = field.fillSource;
  // (Fix round 1: and the 2nd, 3rd… attended appointment's date or time, for a session the record does not have.)
  return Boolean(part && part.index >= 2 && (path === "patient.addressLines" || path === "clinic.addressLines" || path === "episode.attendedDate" || path === "episode.attendedTime"));
}

export function isSectionAnswered(section: Pick<ReportSection, "paragraphs" | "answer"> & { blankFromRecords?: boolean }): boolean {
  if (section.answer?.kind === "rows") return hasRowContent(section.answer.value);
  // 10/2026: an answer space the record leaves empty on purpose (an address line it does not have) is answered.
  if (section.blankFromRecords && !section.paragraphs.some((p) => p.text.trim().length > 0)) return true;
  if (section.answer && section.answer.kind !== "text") {
    return section.answer.value !== null && section.answer.value !== "";
  }
  return section.paragraphs.some((p) => p.text.trim().length > 0);
}

/**
 * Parse a raw answer string (Claude's `answer`, or text typed by staff) into the structured answer for
 * a field: yes/no and tick box → boolean ("Yes"/"No", "Y"/"N", "ticked"…), choice → the option exactly
 * as printed (matchOption), date → ISO (from DD/MM/YYYY or ISO), number → digits. Anything that does not
 * fit gives value null (left blank – never guessed). Text answer types give {kind: "text", value: null}.
 */
export function parseFormAnswerValue(field: Pick<FormField, "answerType" | "options">, raw: string | null | undefined): FormAnswer {
  const kind = answerKindFor(field.answerType);
  const text = (raw ?? "").trim();
  if (kind === "text" || !text) return { kind, value: null };
  // "Not recorded", "Unknown", "N/A"… stay blank (a gap asks the clinician) – never a definite answer.
  if (isUnknownAnswer(text, field.options)) return { kind, value: null };
  switch (kind) {
    case "yes_no":
    case "checkbox": {
      const t = text.toLowerCase().replace(/[.!]+$/, "");
      if (/^(?:yes|y|true|ticked|tick|checked|☒|✓|✔|x)$/.test(t)) return { kind, value: true };
      if (/^(?:no|n|false|unticked|not ticked|unchecked|☐)$/.test(t)) return { kind, value: false };
      // Printed options such as "Yes – see below" / "No".
      const option = matchOption(field.options, text);
      if (option) {
        const o = option.trim().toLowerCase();
        if (/^(?:yes|y)\b/.test(o)) return { kind, value: true };
        if (/^(?:no|n)\b/.test(o)) return { kind, value: false };
      }
      return { kind, value: null };
    }
    case "choice":
      return { kind, value: matchOption(field.options, text) };
    case "date": {
      if (isValidIsoDate(text)) return { kind, value: text };
      return { kind, value: parseUkDate(text) };
    }
    case "number": {
      const m = /^-?\d+(?:\.\d+)?$/.exec(text.replace(/[,\s]/g, ""));
      return { kind, value: m ? m[0] : null };
    }
    case "rows":
      // A table is never answered by one piece of text: rows come from the record or are entered by staff.
      return { kind, value: null };
  }
}

/** One answer for the forms engine: `text` for text anchors, `value` for tick boxes / choices / fields. */
export interface FormFillAnswer {
  text?: string;
  value?: string | boolean | null;
  /** Table questions: the rows, column key → cell text (S2, additive). */
  rows?: FormAnswerRow[];
  /**
   * 10/2026: the record leaves this answer space empty on purpose (an address line it does not have): the forms
   * engine removes the placeholder (a clinic system's merge code) instead of leaving it or a review marker.
   */
  blank?: boolean;
  /**
   * Fix round 1 (B0-2): a person left this question blank (leftBlankByPerson), or the report was approved without an
   * answer here. Nothing the form prints as a default may then read as an answer: a printed tick or mark is cleared,
   * a "delete as necessary" list is removed, and a printed default value ("30 minutes") is removed. Blank lines,
   * empty cells and unticked boxes stay exactly as printed.
   */
  leftBlank?: boolean;
}

/** Answers keyed by form field ID ("F-01"…). */
export type FormFillAnswers = Record<string, FormFillAnswer>;

/** Sign-off values written at approval (from the verified receipt). */
export interface SignoffValues {
  signature: string;
  name: string;
  hcpc: string;
  /** DD/MM/YYYY (Europe/London date of signedAt). */
  date: string;
  /** ISO date of signedAt. */
  dateIso: string;
}

export function signoffValuesFromReceipt(receipt: Pick<SignReceipt, "signer" | "signedAt">): SignoffValues {
  const dateIso = todayIso(new Date(receipt.signedAt));
  const date = formatUkDate(dateIso);
  return {
    signature: `${receipt.signer.name} – approved electronically on ${date}`,
    name: receipt.signer.name,
    hcpc: receipt.signer.hcpc,
    date,
    dateIso,
  };
}

function signoffAnswer(part: SignoffPart, values: SignoffValues | null): FormFillAnswer {
  if (!values) return {};
  if (part === "date") return { text: values.date, value: values.dateIso };
  return { text: values[part], value: values[part] };
}

/** The validators' evidence for "optional and has no answer" (validation/placeholders.ts). */
const OPTIONAL_BLANK_EVIDENCE = "optional field blank";

/**
 * Fix round 1 (B0-2): a person decided to leave this question blank – it has no answer, none of its gaps is still
 * open, and a gap of it or its "optional and has no answer" warning was acknowledged (one by one, or with "Leave
 * optional boxes blank").
 */
export function leftBlankByPerson(report: Partial<Pick<Report, "sections" | "gaps" | "flags">>, key: string): boolean {
  const section = report.sections?.find((s) => s.key === key);
  if (!section || isSectionAnswered(section)) return false;
  const gaps = (report.gaps ?? []).filter((g) => g.sectionKey === key);
  if (gaps.some((g) => !g.resolution)) return false;
  return gaps.some((g) => g.resolution?.kind === "acknowledged") || (report.flags ?? []).some((f) => f.sectionKey === key && !f.paragraphId && f.evidence === OPTIONAL_BLANK_EVIDENCE && Boolean(f.acknowledged));
}

/**
 * What leaving a question blank does to what its place on the form prints (fix round 1, B0-2), for the review's
 * wording – or null when nothing printed there changes (an empty cell, a blank line, unticked boxes).
 */
export function leftBlankEffect(field: Pick<FormField, "anchor">): string | null {
  const a = field.anchor;
  if (a.kind !== "docx") return null;
  if (a.target === "mark_cell" || a.target === "checkbox_glyph") return "no box is marked – a mark printed there is removed";
  if (a.target === "delete_options") {
    const printed = a.placeholderText ?? (a.optionTexts ?? []).map((o) => o.text).join(" / ");
    return printed ? `the printed “${printed}” is removed` : null;
  }
  if (a.target === "replace_placeholder" && printsDefault(a.placeholderText) && !a.writeAfter) return `the printed “${a.placeholderText}” is removed`;
  return null;
}

/**
 * A placeholder that prints a default value ("30 minutes", "N/10"): letters or digits, and not a clinic system's merge
 * code (those block approval until they are replaced – core/merge-fields.ts). A fill line ("____") prints no value.
 */
export function printsDefault(placeholder: string | undefined): boolean {
  return Boolean(placeholder) && /[A-Za-z0-9]/.test(placeholder as string) && !/<<|>>|[«»]/.test(placeholder as string);
}

/**
 * The answers to write into the referrer's original file – a thin adapter over the issue state (bh2 WA1 design 4,
 * core/issue-state.ts): what each box issues is decided there, from the report's hashed content alone.
 *
 * - answer → its text, structured value or rows;
 * - sign-off → the values of the (verified) receipt passed in; blank on a DRAFT;
 * - not applicable (ruled out by a frozen condition, a person's decision or a session not attended) → nothing: the
 *   printed placeholder, a merge code, a default, a tick or a "delete as necessary" list in its place is removed (the
 *   forms engine's `blank` + `leftBlank`); a box ruled out by the earlier run-time reading (a report from before this
 *   release) keeps its earlier output, `{leftBlank: true}`;
 * - nothing in the record (an address line it does not have) → `{text: "", blank: true}`;
 * - no answer → `{leftBlank: true}` once approved (a receipt is passed) or left blank by a person; else `{}` (as
 *   printed, on a DRAFT).
 * A FINAL copy (receipt passed) depends on the issue state and the receipt only. Only a DRAFT copy also takes the
 * report's own status and acknowledged "optional and has no answer" warnings as "left blank" (fix round 1, B0-2), so the
 * review's preview shows a decision before it is approved.
 */
export function buildFormAnswers(
  report: Pick<Report, "sections"> & Partial<Pick<Report, "gaps" | "flags" | "status" | "reportModel" | "approver">>,
  form: Pick<FormDefinition, "fields">,
  opts: { receipt?: Pick<SignReceipt, "signer" | "signedAt"> | null } = {},
): FormFillAnswers {
  const signoff = opts.receipt ? signoffValuesFromReceipt(opts.receipt) : null;
  const final = Boolean(opts.receipt);
  const approvedDraft = !final && report.status === "signed";
  const answers: FormFillAnswers = {};
  const boxes = new Map(issueDetails(report, form).map((b) => [b.key, b]));
  // A report from before this release with no section for a field printed it as it is (AC-ISSUE-6: byte-identical).
  const legacyWithout = isReleaseModel(report) ? null : new Set(report.sections.map((s) => s.key));
  for (const field of answerableFields(form)) {
    const box = boxes.get(field.id);
    const state = box?.state;
    if (!state || state.kind === "referrer_use") continue;
    if (state.kind === "signoff") {
      answers[field.id] = field.fillSource.kind === "signoff" ? signoffAnswer(field.fillSource.part, signoff) : {};
      continue;
    }
    switch (state.kind) {
      case "answer":
        answers[field.id] = state.rows ? { text: state.text, rows: state.rows } : state.value === undefined ? { text: state.text } : { text: state.text, value: state.value };
        break;
      case "not_applicable":
        if (state.reason === "session_not_attended") answers[field.id] = { text: "", blank: true };
        else if (state.reason === "condition" && !box.frozenCondition) answers[field.id] = { leftBlank: true };
        else answers[field.id] = notAsked(field);
        break;
      case "blank":
        if (legacyWithout && !legacyWithout.has(field.id)) answers[field.id] = {};
        else if (state.reason === "record_empty") answers[field.id] = { text: "", blank: true };
        else answers[field.id] = final || approvedDraft || state.reason === "left_blank" || leftBlankByPerson(report, field.id) ? { leftBlank: true } : {};
        break;
    }
  }
  return answers;
}

/**
 * A box that is not asked prints nothing in its place: the placeholder (a merge code, a default, dots) is removed
 * (`blank`, the forms engine's clearPlaceholder) and a printed tick, mark or default is cleared (`leftBlank`). A "delete
 * as necessary" list is removed whole (`leftBlank` alone: `blank` would leave it as printed).
 */
function notAsked(field: Pick<FormField, "anchor">): FormFillAnswer {
  if (field.anchor.kind === "docx" && field.anchor.target === "delete_options") return { leftBlank: true };
  return { text: "", blank: true, leftBlank: true };
}
