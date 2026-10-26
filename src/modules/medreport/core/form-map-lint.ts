/**
 * Map lint (plan WE design 2, L1–L12): what makes a form map read wrong to the clinic or run wrong for a patient,
 * although it is a valid map. A schema check (checkFormDefinition) and the anchor check prove a map FITS its file; this
 * proves it SAYS the right thing – notes and guidance written for the clinic's staff, sources that match who may
 * answer, record values taken from the record, headings that match the printed ones.
 *
 * Heuristics live here, at authoring time, where a person reviews them – never at run time (RC-2: the runtime reads
 * the stored map as it is). Where it runs:
 * - admin:load-forms (create and replace): every finding is an error, overridden only per field and per rule through
 *   FormField.lintAccepted with a reason (recorded in the audit);
 * - the Studio's mapping page: the findings are hints;
 * - /forms/confirm and a store PUT to "confirmed": L5 (a clinical judgement filled by staff, a fixed value or an
 *   unaccepted draft) blocks unless a clinician member accepted it for that field (server-stamped, audited).
 *
 *   L1  a note written for whoever prepares the map (ask/tell someone, verify on a date, until someone confirms,
 *       implementation talk, an edit-log prefix such as "Corrected:")
 *   L2  guidance saying an unanswered box keeps what is printed (since B0-2 a blank box prints nothing)
 *   L3  "filled from the record" on a clinic detail (clinic.*) or a staff entry, in a note or in guidance
 *   L4  guidance naming a printed option in another case or number than printed
 *   L5  judgement wording (fitness for work, restrictions, causation, prognosis, recovery, permanence, barriers,
 *       psychosocial factors, yellow flags, declarations) with a staff-entry, fixed or (unaccepted) drafted source
 *   L6  a value the appointments hold (session dates and times, the first appointment) drafted or left to staff
 *   L7  headings: a box without a heading inside a run of one heading, row-mates under different headings, a heading
 *       that is only its own question's label
 *   L8  a "…" blank inside printed words whose printed lead is not known (analysis.printedLeads or quoted in guidance)
 *   L9  a "prepared by ClinForms" line other than load-forms' own single one
 *   L10 a conditional box whose own placeholder is a merge code
 *   L11 a converted form without a pin of its source file
 *   L12 vendor, product or technology names in a note, guidance or map warning
 *
 * Messages are ClinForms' own words and never quote the form's wording (load-forms prints rule + field id only).
 * Pure; browser and server.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { conditionText } from "./conditions";
import { parseBlockId } from "./forms";
import { hasMergeToken } from "./merge-fields";
import { isConvertedFromRtf, isRtfConversionNote } from "./rtf/notes";
import { sessionQuestionOf, suggestedRecordPath } from "./session-dates";
import type { FormDefinition, FormField } from "./types";
import { defineHook, hookEnabled } from "./validation/hooks";
import { BANNED_TERM_PATTERNS } from "./wording";

/**
 * Ledger hook (safety corpus ledger.json "lint-accepted", an exemption): a field's lintAccepted entry turns that rule's
 * finding on that field into "accepted". The corpus seam disables it to show the accepted PASS cases depend on it.
 */
const LINT_ACCEPTED_HOOK = defineHook("lint-accepted");

export const LINT_RULES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"] as const;
export type LintRule = (typeof LINT_RULES)[number];

/** What each rule checks, in the clinic's words (the mapping page's hint titles). */
export const LINT_RULE_TITLES: Record<LintRule, string> = {
  L1: "A note written for whoever prepared the map",
  L2: "Guidance says an unanswered box keeps what is printed",
  L3: "Wrong source wording",
  L4: "An option named differently from the form",
  L5: "A clinical judgement not left to the clinician",
  L6: "A value the appointments hold",
  L7: "Heading",
  L8: "Printed words before the blank",
  L9: "A second “prepared by ClinForms” line",
  L10: "A merge code in a question that may not apply",
  L11: "The source file is not pinned",
  L12: "A product or technology name",
};

/** The single line load-forms adds to a map it prepares (L9: any other "prepared" line duplicates it). */
export const PREPARED_NOTE = "Prepared by ClinForms when your account was set up – check each question against your form and confirm the mapping once.";

export interface LintIssue {
  rule: LintRule;
  /** The field the finding is about (absent: the whole map). */
  fieldId?: string;
  /** "error" – a finding; "accepted" – the field's lintAccepted covers it (listed, never counted as an error). */
  severity: "error" | "accepted";
  /** ClinForms' own words; never the form's wording. */
  message: string;
  /** For "accepted": the acceptance's reason. */
  acceptedReason?: string;
}

export interface LintOptions {
  /** The file was converted from RTF (default: read from the map – convertedWith, the RTF notes, the file name). */
  convertedFromRtf?: boolean;
  /**
   * load-forms: what the MAPS FILE pins for this file (the map's own `file`), checked by L11 – the source file's
   * SHA-256, or the current conversion's. Absent: L11 reads the stored form's file.sourceSha256.
   */
  pin?: { sha256?: string; sourceSha256?: string };
  /** The current conversion's SHA-256 (with `pin`): a pinned sha256 equal to it counts as a pin. */
  conversionSha256?: string;
  /**
   * The template's printed text per Word block (load-forms has the parsed file; the mapping page may pass its
   * preview's): L8 then knows whether words are printed before a blank. Without it, a blank inside a block is taken
   * to complete printed words.
   */
  blockText?: (blockId: string) => string | null | undefined;
  /** Which rules to run (default: all). */
  rules?: readonly LintRule[];
}

/* ------------------------------------------------------------------------------------------------
 * Text helpers
 * ----------------------------------------------------------------------------------------------*/

/** Sentences of a note or guidance (split at . ! ? ; and at " – " / ": " after a short lead such as "Corrected:"). */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z(“"'])|\s[–—]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.normalize("NFC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quoted phrases in a text (“…”, "…", '…' – at least two letters). */
function quotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /“([^”]{2,120})”|"([^"]{2,120})"|(?:^|[\s(])'([^']{2,120})'(?=[\s).,;:!?]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (/[A-Za-z].*[A-Za-z]/.test(q)) out.push(q);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * L1 – notes written for whoever prepares the map
 * ----------------------------------------------------------------------------------------------*/

/** Why a sentence is written for the map's preparer (null: written for the clinic's staff). */
function preparerSentence(sentence: string): string | null {
  const s = sentence.trim();
  // An edit log: the note says how the map was changed, not what the question is.
  if (/^\(?(?:corrected|fixed|changed|updated|amended|edited|revised|previously|was|todo|fixme|note to self)\b\s*[:\-–)]/i.test(s)) return "it records how the map was changed";
  if (/\b(?:TODO|FIXME|TBC|TBD)\b/.test(s)) return "it is a reminder for later";
  // An instruction to contact or consult someone (never the patient: staff may ask the patient).
  // ("Phone", "email" and "call" are left out: they start ordinary labels – "phone number", "email address".)
  const contact = /(?:^|[:;(–—]\s*|\bplease\s+)(?:ask|tell|warn|remind|inform|notify|chase|check with|confirm with|clarify with|verify with|raise (?:it )?with|discuss (?:it )?with|agree (?:it )?with)\b\s*(.{0,40})/i.exec(s);
  if (contact && !/^(?:the\s+)?(?:patient|claimant|client)\b/i.test(contact[1].trim())) return "it asks the reader to contact someone";
  // A dated verification memo.
  if (/^\(?verif(?:y|ied)\b/i.test(s) || /\b(?:verif(?:y|ied)|checked|confirmed|re-?check(?:ed)?)\s+(?:on\s+|by\s+)?\d{1,2}[/.]\d{1,2}\b/i.test(s)) return "it is a verification memo";
  // A decision someone still has to make.
  if (/\buntil\b[^.;]*\b(?:confirms?|confirmed|says|said|decides|decided|agrees|agreed|answers|answered|replies|replied|tells|told)\b/i.test(s)) return "it waits for someone's decision";
  if (/\b(?:to be confirmed|still to confirm|open point|open question|awaiting (?:an? )?(?:answer|reply|confirmation|decision))\b/i.test(s) || /\(\s*[\w .'-]{1,30}\s+to confirm\s*\)/i.test(s)) return "it waits for someone's decision";
  // Implementation talk (how the product works inside, not what staff see).
  if (/\b(?:from|by|in) the code\b|\bthe code (?:should|must|will|would|needs?|has to|fills?|does|can(?:not|'t)?|puts?|writes?|reads?)\b/i.test(s)) return "it talks about the product's code";
  if (/\b(?:anchor(?:s|ed|ing)?|regex|parser|schema|json|blockid|fillsource|placeholdertext|enum)\b/i.test(s)) return "it talks about how the map is built";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * L2 – "unanswered … stays"
 * ----------------------------------------------------------------------------------------------*/

const NO_ANSWER = /\b(?:un-?answered|not answered|no answer|nobody answers|no one answers|no-one answers|if (?:it is |it's |this is )?(?:left )?(?:blank|empty)|left (?:blank|empty)|when (?:left )?(?:blank|empty)|without an answer|if not (?:completed|filled in))\b/i;
const KEEPS_PRINTED = /\b(?:stays?|staying|remains?|is kept|are kept|kept as (?:printed|it is)|left as (?:it is|printed|on the form)|unchanged|still prints?|keeps? (?:its|the) printed)\b/i;

function keepsPrintedWhenUnanswered(guidance: string): boolean {
  return sentencesOf(guidance.replace(/[()]/g, " ")).some((s) => {
    const m = NO_ANSWER.exec(s);
    return Boolean(m && KEEPS_PRINTED.test(s));
  });
}

/* ------------------------------------------------------------------------------------------------
 * L4 – options named in another case or number
 * ----------------------------------------------------------------------------------------------*/

const PLAIN_OPTION = /^(?:yes|no|n\/a|na|none|other|not applicable|unknown)$/i;

function optionNamingProblem(field: Pick<FormField, "options" | "guidance" | "answerType">): string | null {
  if (!field.options?.length || field.answerType === "yes_no" || !field.guidance.trim()) return null;
  const g = norm(field.guidance);
  const options = field.options.map((o) => norm(o)).filter((o) => o.length >= 3 && !PLAIN_OPTION.test(o));
  const known = new Set(field.options.map((o) => norm(o).toLowerCase()));
  for (const o of options) {
    const word = (s: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])`, flags);
    const any = g.match(word(o, "gi")) ?? [];
    if (any.length > 0 && !any.some((m) => m === o)) return "it names a printed option in another case than printed";
    // The option in another number ("Exercises" for the printed "Exercise", "mobilisation" for "mobilisations").
    const variants = o.endsWith("s") && o.length > 3 ? [o.replace(/e?s$/, "")] : [`${o}s`, `${o}es`];
    for (const v of variants) {
      if (known.has(v.toLowerCase())) continue;
      if (word(v, "i").test(g) && !word(o, "i").test(g)) return "it names a printed option in another number than printed";
    }
  }
  // A quoted name that is no option but an option in another case or number.
  for (const q of quotedPhrases(g)) {
    if (known.has(q.toLowerCase()) && !field.options.some((o) => norm(o) === q)) return "it quotes a printed option in another case than printed";
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * L5 – judgement wording on a source that is not the clinician's
 * ----------------------------------------------------------------------------------------------*/

/** The kinds of clinical judgement a question can ask for (plan WE design 2; form-analysis.ts's clinician_opinion rule). */
export const JUDGEMENT_KINDS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: "fitness for work", pattern: /\b(?:un)?fit(?:ness)?\b|\b(?:able|unable|capable|incapable)\s+(?:of|to)\s+(?:do(?:ing)?|work(?:ing)?|return(?:ing)?|carry(?:ing)? out|perform(?:ing)?|fulfil(?:l?ing)?|undertak(?:e|ing)|resum(?:e|ing)|continu(?:e|ing))\b|\bcan\s+(?:the\s+(?:patient|claimant|client|employee)|he|she|they|you)\s+(?:do|return|work|perform|carry out|resume|manage)\b/i },
  // A restriction of movement or range is an examination finding, not a restriction on what the patient may do.
  { kind: "restrictions", pattern: /\brestrict(?:ion|ions|ed)?\b(?!\s+(?:to|of|in|on)\s+(?:the\s+)?(?:movement|motion|range|rom)\b|\s+(?:range|movement|motion|rom)\b)|\b(?:modified|adjusted|amended|light|lighter|alternative|reduced|phased)\s+(?:duties|hours|work|return)\b|\bwork(?:place)?\s+adjustments?\b/i },
  { kind: "causation", pattern: /\bcaus(?:e|ed|es|ation|al|ally)\b|\bdue to\b|\bbecause of\b|\b(?:related|attributable|attributed|linked|secondary|consequent)\s+to\b|\bas a (?:direct )?(?:result|consequence) of\b|\b(?:work|accident|injury|incident)[- ](?:related|aggravated|induced|caused)\b|\baggravat(?:ed|ion|ing)\b|\bbrought on\b|\bconsistent with the (?:mechanism|accident|incident|injury)\b/i },
  { kind: "prognosis", pattern: /\bprognos(?:is|es|tic)\b|\boutlook\b|\b(?:expected|anticipated|estimated|predicted|likely)\s+(?:recovery|return|date|time|duration|outcome|resolution|timescale|improvement|length)\b/i },
  { kind: "recovery", pattern: /\brecover(?:y|ed|ing|s)?\b|\bgetting better\b|\b(?:has|have)\s+(?:the\s+\w+\s+)?resolved\b|\bfull return\b|\bpre-?(?:injury|accident) (?:level|status|state|function)\b|\bback to normal\b/i },
  { kind: "permanence", pattern: /\bpermanen(?:t|ce|tly)\b|\blong[- ]term (?:effects?|disability|damage|impairment|problems?)\b|\bresidual (?:symptoms?|disability|impairment)\b/i },
  { kind: "barriers to recovery", pattern: /\bbarriers?\b|\bobstacles?\b|\bhinder(?:s|ing|ed|ance)?\b|\bimped(?:e|es|ing|iment|iments)\b|\bpreventing (?:recovery|progress)\b/i },
  { kind: "psychosocial factors", pattern: /\bpsycho-?social\b|\bpsycholog(?:ical|y)\b|\bfear[- ]avoidance\b|\bcatastrophi[sz]/i },
  { kind: "yellow flags", pattern: /\b(?:yellow|blue|black|orange)\s+flags?\b/i },
  { kind: "a declaration", pattern: /\bdeclar(?:e|es|ed|ation)\b|\bI (?:confirm|certify|declare|attest)\b|\bconfirmation of\b|\bcertif(?:y|ies|ied|ication)\b|\battest(?:s|ed|ation)?\b/i },
];

/** The judgement a question asks for, read from its printed label and options – or null. */
export function judgementOf(field: Pick<FormField, "label"> & Partial<Pick<FormField, "options">>): string | null {
  const text = [field.label, ...(field.options ?? [])].join(" · ");
  return JUDGEMENT_KINDS.find((j) => j.pattern.test(text))?.kind ?? null;
}

/** Sources that are not the clinician's own answer: a staff entry, a fixed value, a draft from the notes. */
function nonClinicianSource(field: Pick<FormField, "fillSource">): "staff" | "fixed" | "drafted" | null {
  const s = field.fillSource;
  if (s.kind === "registration" && s.path === "staff.entry") return "staff";
  if (s.kind === "fixed") return "fixed";
  if (s.kind === "notes_narrative") return "drafted";
  return null;
}

/**
 * L5 for one field, as /forms/confirm and the store check it: the judgement it asks for and who would answer it
 * instead of the clinician – or null.
 */
export function judgementOnNonClinicianSource(field: Pick<FormField, "label" | "options" | "fillSource">): { kind: string; source: "staff" | "fixed" | "drafted" } | null {
  const source = nonClinicianSource(field);
  if (!source) return null;
  const kind = judgementOf(field);
  return kind ? { kind, source } : null;
}

/* ------------------------------------------------------------------------------------------------
 * L7 – headings
 * ----------------------------------------------------------------------------------------------*/

const headingOf = (f: Pick<FormField, "section">) => (typeof f.section === "string" ? norm(f.section) : "");

/** The table row a Word anchor sits in ("t2.r5"; nested rows keep their path), or null. */
function rowKeyOf(field: Pick<FormField, "anchor">): string | null {
  if (field.anchor.kind !== "docx") return null;
  const parsed = parseBlockId(field.anchor.blockId);
  if (!parsed || parsed.kind !== "cell") return null;
  return parsed.cells.map((c, i) => (i === parsed.cells.length - 1 ? `t${c.t}.r${c.r}` : `t${c.t}.r${c.r}.c${c.c}`)).join(".");
}

function headingProblems(fields: readonly FormField[]): Array<{ fieldId: string; message: string }> {
  const out: Array<{ fieldId: string; message: string }> = [];
  const headings = fields.map(headingOf);
  if (!headings.some(Boolean)) return out; // a form that prints no headings: nothing to check
  const seen = new Set<string>();
  const flag = (id: string, message: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ fieldId: id, message });
  };
  // A box without a heading inside a run of one heading.
  fields.forEach((f, i) => {
    if (headings[i]) return;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = headings[j];
    let after = "";
    for (let j = i + 1; j < fields.length && !after; j++) after = headings[j];
    if (before && before === after) flag(f.id, "This box has no heading, but the boxes before and after it share one: give it the heading it is printed under.");
  });
  // Boxes of one printed row under different headings.
  const rows = new Map<string, number[]>();
  fields.forEach((f, i) => {
    const key = rowKeyOf(f);
    if (key) rows.set(key, [...(rows.get(key) ?? []), i]);
  });
  for (const idx of Array.from(rows.values())) {
    if (new Set(idx.map((i) => headings[i])).size < 2) continue;
    // The row's heading: the one most of its boxes have (a heading before none on a tie).
    const count = new Map<string, number>();
    for (const i of idx) count.set(headings[i], (count.get(headings[i]) ?? 0) + 1);
    const rowHeading = Array.from(count.entries()).sort((a, b) => b[1] - a[1] || (a[0] ? -1 : 1))[0][0];
    for (const i of idx) {
      if (headings[i] !== rowHeading) flag(fields[i].id, "This box sits in one printed row with boxes under another heading: give the row's boxes the same heading.");
    }
  }
  // A heading that is only its own question's label (a label made into a heading) – unless the form's own convention is
  // "each numbered question is its own heading" (a heading that is its first question's label and holds more questions).
  const isOwnLabel = (i: number) => Boolean(headings[i]) && headings[i].toLowerCase() === norm(fields[i].label).toLowerCase();
  const questionHeadings = fields.some((_, i) => isOwnLabel(i) && headings.filter((x) => x === headings[i]).length > 1);
  fields.forEach((f, i) => {
    if (!isOwnLabel(i) || questionHeadings) return;
    const h = headings[i];
    const others = headings.filter((x, j) => j !== i && x === h).length;
    const subQuestions = fields.some((g, j) => j > i && headings[j].toLowerCase() === norm(f.label).toLowerCase());
    if (others === 0 && !subQuestions) flag(f.id, "This box's heading is only its own question: give it the heading it is printed under, or none.");
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * L8 – a blank inside printed words, and its printed lead
 * ----------------------------------------------------------------------------------------------*/

/** A placeholder that is only a blank: dots, an ellipsis, underscores. */
export const BLANK_PLACEHOLDER = /^[\s.…_-]*(?:…|\.{2,}|_{2,})[\s.…_-]*$/;
/**
 * A short blank ("…", "...") sits inside a printed sentence; a long dotted or ruled line is a "write here" space after
 * a label. Without the template's text (the mapping page), only a short blank is taken to complete printed words.
 */
const SHORT_BLANK = /^\s*(?:…|\.{2,3}|…\.|\.…)\s*$/;

/**
 * The words printed before a blank in its block ("To return to" before "…"), from the template's text – the printed
 * lead the answer completes (analysis.printedLeads, read by the drafting checks). Null: no words before it, or the
 * placeholder is not printed there. At most the last 80 characters of the clause it sits in.
 */
export function printedLeadIn(blockText: string, placeholder: string, occurrence = 0): string | null {
  const text = blockText.replace(/\s+/g, " ");
  const needle = placeholder.replace(/\s+/g, " ");
  let at = text.indexOf(needle);
  for (let k = 0; k < occurrence && at >= 0; k++) at = text.indexOf(needle, at + needle.length);
  if (at < 0) return null;
  const before = text.slice(0, at);
  // The clause the blank completes: after the last sentence end, label colon, tab-like gap, an earlier blank, or a
  // comma before a capital (“Plan agreed, To return to …”).
  const clause = before.split(/(?:[.!?]\s|:\s|\s{2,}|[|•]|…|\.{2,}|_{2,}|,\s+(?=[A-Z]))/).pop() ?? "";
  const lead = clause.replace(/^[\s\-–—,;]+/, "").trimEnd().slice(-80).trim();
  return /[A-Za-z]/.test(lead) ? lead : null;
}

function leadIsKnown(form: Pick<FormDefinition, "analysis">, field: FormField, printedBefore: string | null): boolean {
  const stored = form.analysis.printedLeads?.[field.id];
  if (stored && stored.trim()) return true;
  const quoted = quotedPhrases(field.guidance);
  if (quoted.length === 0) return false;
  if (printedBefore === null) return true; // no template text to compare with: a quoted lead is taken as given
  const tail = norm(printedBefore).toLowerCase();
  return quoted.some((q) => tail.endsWith(norm(q).toLowerCase()));
}

/* ------------------------------------------------------------------------------------------------
 * L12 – vendor, product and technology names
 * ----------------------------------------------------------------------------------------------*/

/** Clinic-system (practice-management) product names: the clinic sees "your clinic system", never a vendor. */
const PRODUCT_NAMES = /\b(?:TM3|Cliniko|WriteUpp|Pabau|Semble|Jane App|Physitrack|Rehab My Patient)\b/i;
const MODEL_NAMES = /\b(?:opus|sonnet|haiku|fable|chatgpt|openai|gemini|copilot)\b/i;

function vendorName(text: string): boolean {
  return PRODUCT_NAMES.test(text) || MODEL_NAMES.test(text) || BANNED_TERM_PATTERNS.some((re) => re.test(text));
}

/* ------------------------------------------------------------------------------------------------
 * The lint
 * ----------------------------------------------------------------------------------------------*/

function isConverted(form: Pick<FormDefinition, "analysis" | "file">, opts: LintOptions): boolean {
  if (opts.convertedFromRtf !== undefined) return opts.convertedFromRtf;
  if (form.analysis.convertedWith) return true;
  if (form.analysis.warnings.some(isRtfConversionNote)) return true;
  return isConvertedFromRtf(form.file);
}

const PREPARED_LINE = /\bprepared\b[^.]*\bClinForms\b|\bClinForms\b[^.]*\bprepared\b/i;

/**
 * Every finding of the map lint, in field order then map-level. Findings a field's lintAccepted covers (same rule) are
 * returned with severity "accepted"; map-level findings cannot be accepted.
 */
export function lintFormMap(form: Pick<FormDefinition, "fields" | "analysis" | "file">, opts: LintOptions = {}): LintIssue[] {
  const want = new Set<LintRule>(opts.rules ?? LINT_RULES);
  const issues: LintIssue[] = [];
  const fields = form.fields;
  const push = (rule: LintRule, field: FormField | null, message: string) => {
    if (!want.has(rule)) return;
    const accepted = hookEnabled(LINT_ACCEPTED_HOOK) ? field?.lintAccepted?.find((a) => a.rule === rule) : undefined;
    issues.push({
      rule,
      ...(field ? { fieldId: field.id } : {}),
      severity: accepted ? "accepted" : "error",
      message,
      ...(accepted ? { acceptedReason: accepted.reason } : {}),
    });
  };

  const headingIssues = new Map(headingProblems(fields).map((h) => [h.fieldId, h.message] as const));

  for (const f of fields) {
    const note = f.note ?? "";
    const guidance = f.guidance ?? "";
    // L1
    const preparer = note ? sentencesOf(note).map(preparerSentence).find(Boolean) : null;
    if (preparer) push("L1", f, `The note is written for whoever prepared the map (${preparer}): write it for the clinic's staff, or remove it.`);
    // L2
    if (guidance && keepsPrintedWhenUnanswered(guidance)) push("L2", f, "The guidance says an unanswered box keeps what is printed; a box left blank prints nothing. Say what leaving it blank does.");
    // L3
    if (f.fillSource.kind === "registration" && (f.fillSource.path.startsWith("clinic.") || f.fillSource.path === "staff.entry")) {
      // "filled from the record", "from the patient's record", "from the clinic record" – not "From the clinic system's …".
      const fromRecord = /\bfrom the (?:patient(?:'s|’s)? )?record\b|\bfrom the (?:patient|clinic) record\b/i;
      const where = [fromRecord.test(note) ? "note" : "", fromRecord.test(guidance) ? "guidance" : ""].filter(Boolean).join(" and ");
      if (where) {
        push(
          "L3",
          f,
          f.fillSource.path === "staff.entry"
            ? `The ${where} says it is filled from the record, but staff enter it on each report: say “Entered by staff on each report”.`
            : `The ${where} says it is filled from the record, but it comes from the clinic's own details: say “From your Clinic details”.`,
        );
      }
    }
    // L4
    const naming = optionNamingProblem(f);
    if (naming) push("L4", f, `The guidance ${naming.replace(/^it /, "")}: name each option exactly as the form prints it.`);
    // L5
    const judgement = judgementOnNonClinicianSource(f);
    if (judgement) {
      const by = judgement.source === "staff" ? "entered by staff" : judgement.source === "fixed" ? "a fixed answer" : "drafted from the notes";
      push("L5", f, `This question asks for a clinical judgement (${judgement.kind}) but is ${by}: make it the clinician's own answer, or accept it with the reason (for example, the patient reports it).`);
    }
    // L6
    const session = sessionQuestionOf(f);
    const s = f.fillSource;
    const recordPathNamed = s.kind === "registration" && s.path !== "staff.entry";
    if (session && !recordPathNamed && (s.kind === "notes_narrative" || s.kind === "clinician_opinion" || (s.kind === "registration" && s.path === "staff.entry"))) {
      const suggested = suggestedRecordPath(session);
      push("L6", f, `The appointments in the record hold this value: take it from the record (${suggested.path}) instead of ${s.kind === "registration" ? "staff typing it" : "drafting it"}.`);
    }
    // L7
    const heading = headingIssues.get(f.id);
    if (heading) push("L7", f, heading);
    // L8
    if (f.anchor.kind === "docx" && f.anchor.target === "replace_placeholder" && !f.anchor.writeAfter && f.anchor.placeholderText && BLANK_PLACEHOLDER.test(f.anchor.placeholderText)) {
      const text = opts.blockText?.(f.anchor.blockId);
      const before = typeof text === "string" ? printedLeadIn(text, f.anchor.placeholderText) : null;
      const wordsBefore = typeof text === "string" ? before !== null : SHORT_BLANK.test(f.anchor.placeholderText);
      if (wordsBefore && !leadIsKnown(form, f, typeof text === "string" ? before : null)) {
        push("L8", f, "This blank completes words printed before it, which the map does not know: quote them in the guidance (or let ClinForms record them from the form).");
      }
    }
    // L10
    if (
      f.anchor.kind === "docx" &&
      (f.anchor.target === "replace_placeholder" || f.anchor.target === "delete_options") &&
      !f.anchor.clearPlaceholder &&
      hasMergeToken(f.anchor.placeholderText ?? "") &&
      conditionText(fields, f.id) !== null
    ) {
      push("L10", f, "This question applies only when the question before it says so, and its own place holds a clinic-system merge code: when it does not apply the code would stay printed. Clear the place, or anchor it elsewhere.");
    }
    // L12
    if (vendorName(note) || vendorName(guidance)) push("L12", f, "A note or the guidance names a product or technology: say “your clinic system” or what it does instead.");
  }

  // Map-level: L1, L12 in the map's own warnings (not the RTF conversion notes, not load-forms' own line).
  const warnings = form.analysis.warnings ?? [];
  const own = warnings.filter((w) => !isRtfConversionNote(w) && w !== PREPARED_NOTE);
  if (own.some((w) => sentencesOf(w).some((x) => preparerSentence(x)))) push("L1", null, "A note on the map is written for whoever prepared it: write it for the clinic's staff, or remove it.");
  if (warnings.some(vendorName)) push("L12", null, "A note on the map names a product or technology.");
  // L9
  const prepared = warnings.filter((w) => PREPARED_LINE.test(w));
  if (prepared.length > 1 || prepared.some((w) => w !== PREPARED_NOTE)) push("L9", null, "The map carries a “prepared by ClinForms” line besides the one ClinForms adds when it loads the form: remove it.");
  // L11
  if (isConverted(form, opts)) {
    const pinned = opts.pin
      ? Boolean(opts.pin.sourceSha256) || Boolean(opts.pin.sha256 && opts.conversionSha256 && opts.pin.sha256 === opts.conversionSha256)
      : Boolean(form.file.sourceSha256);
    if (!pinned) push("L11", null, "The form was converted from RTF, but the map does not pin the source file (file.sourceSha256): a later conversion could not be matched to it.");
  }
  return issues;
}

/** Errors only (what blocks a load). */
export function lintErrors(issues: readonly LintIssue[]): LintIssue[] {
  return issues.filter((i) => i.severity === "error");
}

/** "L5@F-12, L9" – rule and field ids only, for load-forms' output and audit rows (never the form's wording). */
export function lintSummary(issues: readonly LintIssue[]): string {
  return issues.map((i) => `${i.rule}${i.fieldId ? `@${i.fieldId}` : ""}`).join(", ");
}
