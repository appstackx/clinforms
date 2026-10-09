/**
 * Portal question sets (FormKind "questions"). Some insurers (Vitality, WPA, domestic AXA Health) take
 * treatment reports through an online portal, not a form. Staff paste or type the portal's questions
 * once; the question set is then a form map like any other – drafted from the notes, reviewed, gaps,
 * approval – but nothing is written into a file: the answers are copied into the portal (review screen
 * "Copy answers") and a PDF summary of the questions and approved answers is kept for the record.
 *
 * A FormDefinition always has a `file` and every field an `anchor` (shared contract), so a question
 * set uses two documented placeholders:
 *
 * - file: { fileName: QUESTION_SET_FILE_NAME, mimeType: "application/pdf" (its only output is the PDF
 *   summary), sha256: questionSetSha256(fields), sizeBytes: UTF-8 bytes of canonicalQuestionList }.
 *   The SHA-256 of the canonical question list (each question's wording, heading, answer type and
 *   options, in order) stands in for the file's SHA-256: it is the question set's "version". A report
 *   started from it is bound to exactly those questions (report.form.fileSha256), as a form report is
 *   bound to one file; changing a question's wording gives a new version. POST /forms/confirm
 *   recomputes it before attesting, so a confirmed question set always carries the canonical value.
 * - anchor: questionAnchor(n) = { kind: "docx", target: "after_paragraph", blockId: "p<n>" } – a
 *   virtual "after question n of the summary". It keeps answer spaces unique (formAnchorKeys) and is
 *   never used to write into a file: render / fill-preview produce the summary for a question set.
 *
 * Pure: no React, no Node built-ins, no env. Safe in the browser and on the server.
 */
import { DEMO_TENANT_ID } from "../config.public";
import { nowIso } from "./dates";
import { canonicalize, sha256Hex } from "./fingerprint";
import { createId } from "./ids";
import type {
  AnswerType,
  DocxAnchor,
  FillSource,
  FormDefinition,
  FormField,
  FormFieldConfidence,
  FormFile,
  FormMimeType,
  OutcomeInstrument,
  ReferrerInfo,
  RegistrationPath,
} from "./types";

/** `file.fileName` of every question set (there is no file). */
export const QUESTION_SET_FILE_NAME = "Portal questions – no file";
/** `file.mimeType` of every question set: its only output is the PDF summary. */
export const QUESTION_SET_MIME_TYPE: FormMimeType = "application/pdf";
/** `analysis.promptVersion` of a question set: the parser's version (no drafting prompt is involved). */
export const QUESTION_SET_PARSER_VERSION = "questions-1";
/** Most questions one question set may hold. */
export const MAX_PORTAL_QUESTIONS = 100;
/** Longest question (characters). */
export const MAX_PORTAL_QUESTION_LENGTH = 500;

/** True for a portal question set (no file). */
export function isQuestionSet(form: Pick<FormDefinition, "kind"> | { kind?: string } | null | undefined): boolean {
  return form?.kind === "questions";
}

/* ------------------------------------------------------------------------------------------------
 * Virtual anchors
 * ----------------------------------------------------------------------------------------------*/

/** "After question n of the summary" (0-based n): the placeholder anchor of a question-set field. */
export function questionAnchor(index: number): DocxAnchor {
  return { kind: "docx", target: "after_paragraph", blockId: `p${Math.max(0, Math.floor(index))}` };
}

/** True when an anchor is a question set's virtual anchor (questionAnchor). */
export function isQuestionAnchor(anchor: FormField["anchor"]): boolean {
  return anchor.kind === "docx" && anchor.target === "after_paragraph" && /^p\d+$/.test(anchor.blockId);
}

/** The next free virtual anchor for a question added to a question set. */
export function nextQuestionAnchor(fields: readonly Pick<FormField, "anchor">[]): DocxAnchor {
  let max = -1;
  for (const f of fields) {
    if (f.anchor.kind !== "docx") continue;
    const m = /^p(\d+)$/.exec(f.anchor.blockId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return questionAnchor(max + 1);
}

/* ------------------------------------------------------------------------------------------------
 * The placeholder file: SHA-256 of the canonical question list
 * ----------------------------------------------------------------------------------------------*/

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * The canonical question list (stable JSON): version, then each question's wording, heading, answer
 * type and options, in order. Fill sources, "required" and guidance are not part of it (they are part
 * of the confirmed map's own hash).
 */
export function canonicalQuestionList(fields: readonly Pick<FormField, "label" | "section" | "answerType" | "options">[]): string {
  return canonicalize({
    v: 1,
    kind: "questions",
    questions: fields.map((f) => ({ label: clean(f.label), section: clean(f.section), answerType: f.answerType, options: (f.options ?? []).map(clean) })),
  });
}

/** SHA-256 (hex) of the canonical question list: the question set's stand-in for a file SHA-256. */
export function questionSetSha256(fields: readonly Pick<FormField, "label" | "section" | "answerType" | "options">[]): Promise<string> {
  return sha256Hex(canonicalQuestionList(fields));
}

/** The placeholder `file` of a question set with these questions. */
export async function questionSetFile(fields: readonly Pick<FormField, "label" | "section" | "answerType" | "options">[]): Promise<FormFile> {
  const list = canonicalQuestionList(fields);
  return {
    fileName: QUESTION_SET_FILE_NAME,
    mimeType: QUESTION_SET_MIME_TYPE,
    sha256: await sha256Hex(list),
    sizeBytes: new TextEncoder().encode(list).byteLength,
  };
}

/** The question set with its placeholder `file` recomputed from its questions (unchanged otherwise). */
export async function withQuestionSetFile<F extends Pick<FormDefinition, "kind" | "fields" | "file">>(form: F): Promise<F> {
  if (!isQuestionSet(form)) return form;
  const file = await questionSetFile(form.fields);
  return file.sha256 === form.file.sha256 && file.sizeBytes === form.file.sizeBytes && file.fileName === form.file.fileName && file.mimeType === form.file.mimeType
    ? form
    : { ...form, file };
}

/* ------------------------------------------------------------------------------------------------
 * Parsing pasted questions
 * ----------------------------------------------------------------------------------------------*/

export interface ParsedQuestion {
  label: string;
  /** Heading set by a preceding "# Heading" line. */
  section?: string;
  answerType: AnswerType;
  options?: string[];
  required: boolean;
  /** The line gave its answer type ([date], [yes/no]…); otherwise it was inferred from the wording. */
  hinted: boolean;
  /** 1-based line number in the pasted text. */
  line: number;
}

export interface ParsedQuestions {
  questions: ParsedQuestion[];
  /** Plain-English notes that do not stop the questions being added. */
  warnings: string[];
  /** Plain-English problems that must be fixed first (empty = OK). */
  errors: string[];
}

type Hint = { type: AnswerType; options?: string[] } | { required: boolean };

/** A recognised [hint], or null (kept as part of the question). */
function readHint(inner: string): Hint | null {
  const t = inner.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(?:date|dd\/mm\/yyyy)$/.test(t)) return { type: "date" };
  if (/^(?:yes ?\/ ?no|yes-no|yesno|yes or no|y ?\/ ?n)$/.test(t)) return { type: "yes_no" };
  if (/^(?:number|num|numeric|digits|integer)$/.test(t)) return { type: "number" };
  if (/^(?:long|long text|long answer|paragraph|free text)$/.test(t)) return { type: "long_text" };
  if (/^(?:short|short text|short answer|text)$/.test(t)) return { type: "short_text" };
  if (/^(?:tick|tick box|checkbox)$/.test(t)) return { type: "checkbox" };
  if (/^optional$/.test(t)) return { required: false };
  if (/^(?:required|mandatory)$/.test(t)) return { required: true };
  const choice = /^(?:choice|choose|options?|select|one of)\s*:\s*(.+)$/.exec(inner.trim().replace(/\s+/g, " "));
  if (choice) {
    const raw = choice[1];
    const sep = raw.includes("|") ? "|" : raw.includes(";") ? ";" : raw.includes("/") ? "/" : ",";
    const options = Array.from(new Set(raw.split(sep).map((o) => o.trim()).filter(Boolean)));
    return options.length >= 2 ? { type: "single_choice", options } : null;
  }
  return null;
}

/** "1.", "1)", "Q1:", "Question 3 -", "a)", "•", "-", "*" at the start of a pasted line. */
const LIST_MARKER = /^(?:(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):–-]\s+|q(?:uestion)?\s*\d{1,3}\s+|[a-z]\s*[.)]\s+|[-•*–—]\s+)/i;

/**
 * Parse the portal's questions as pasted or typed: one question per line; blank lines are ignored;
 * "# Heading" starts a heading for the questions below it; list numbering is removed; optional hints
 * in square brackets give the answer type ([date], [yes/no], [number], [long], [short],
 * [choice: A | B | C], [tick]) and [optional] / [required]. A line without a type hint gets one from
 * its wording (dates, counts, identifiers), else long text.
 */
export function parsePortalQuestions(text: string): ParsedQuestions {
  const questions: ParsedQuestion[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let section: string | undefined;
  const seen = new Map<string, number>();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    let line = rawLine.replace(/\t/g, " ").trim();
    if (!line) return;
    const heading = /^#+\s*(.*)$/.exec(line);
    if (heading) {
      section = clean(heading[1]).replace(/[:\s]+$/, "") || undefined;
      return;
    }
    line = line.replace(LIST_MARKER, "").trim();

    let type: { type: AnswerType; options?: string[] } | null = null;
    let required = true;
    line = line.replace(/\[([^\]]{1,120})\]/g, (whole, inner: string) => {
      const hint = readHint(inner);
      if (!hint) {
        warnings.push(`Line ${lineNo}: “${whole}” is not a recognised answer type, so it is kept as part of the question.`);
        return whole;
      }
      if ("required" in hint) required = hint.required;
      else if (type && type.type !== hint.type) warnings.push(`Line ${lineNo}: more than one answer type – “${ANSWER_HINT_NAMES[type.type]}” is used.`);
      else type = hint;
      return " ";
    });
    const label = clean(line);
    if (!label) {
      warnings.push(`Line ${lineNo} has an answer type but no question, so it was skipped.`);
      return;
    }
    if (label.length > MAX_PORTAL_QUESTION_LENGTH) {
      errors.push(`Line ${lineNo} is longer than ${MAX_PORTAL_QUESTION_LENGTH} characters. Shorten it, or split it into two questions.`);
      return;
    }
    const key = `${(section ?? "").toLowerCase()}|${label.toLowerCase()}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) warnings.push(`Line ${lineNo} repeats line ${earlier}; both are kept.`);
    else seen.set(key, lineNo);

    const chosen = type as { type: AnswerType; options?: string[] } | null;
    questions.push({
      label,
      ...(section ? { section } : {}),
      answerType: chosen?.type ?? inferAnswerType(label),
      ...(chosen?.options ? { options: chosen.options } : {}),
      required,
      hinted: chosen !== null,
      line: lineNo,
    });
  });

  if (questions.length === 0 && errors.length === 0) errors.push("Paste or type at least one question.");
  if (questions.length > MAX_PORTAL_QUESTIONS) {
    errors.push(`A question set can hold up to ${MAX_PORTAL_QUESTIONS} questions; this has ${questions.length}. Split it into two question sets.`);
  }
  return { questions, warnings, errors };
}

const ANSWER_HINT_NAMES: Record<AnswerType, string> = {
  short_text: "short",
  long_text: "long",
  date: "date",
  yes_no: "yes/no",
  checkbox: "tick",
  single_choice: "choice",
  number: "number",
  signature: "signature",
  clinician_name: "name",
  hcpc_number: "HCPC number",
  date_signed: "date signed",
  table: "table",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Answer type from the wording alone: dates, counts and identifiers; long text otherwise. */
export function inferAnswerType(label: string): AnswerType {
  const classified = classifyPortalQuestion(label);
  if (classified.answerType) return classified.answerType;
  const l = norm(label);
  if (/^date\b|\bdate\s*\??:?$|\bdate of\b|\bdates? (?:of|when)\b/.test(l)) return "date";
  if (/^(?:number|no\.?|total) of\b|^how many\b/.test(l)) return "number";
  return "long_text";
}

/* ------------------------------------------------------------------------------------------------
 * Where each answer comes from (a conservative subset of the form classifier's rules: identifiers
 * from the clinic record by code, figures computed by code, opinions only from the clinician)
 * ----------------------------------------------------------------------------------------------*/

export interface PortalQuestionClass {
  fillSource: FillSource;
  /** Answer type the wording implies (null = no implication). */
  answerType: AnswerType | null;
  confidence: FormFieldConfidence;
  note?: string;
}

const reg = (path: RegistrationPath, answerType: AnswerType | null, note?: string): PortalQuestionClass => ({
  fillSource: { kind: "registration", path },
  answerType,
  confidence: "medium",
  ...(note ? { note } : {}),
});

const OUTCOME_WORDS: Array<[RegExp, OutcomeInstrument]> = [
  [/\bndi\b|neck disability index/, "NDI"],
  [/\bodi\b|oswestry/, "ODI"],
  [/\bnprs\b|numeric(?:al)? pain rating|pain score/, "NPRS"],
  [/\bpsfs\b|patient[- ]specific functional scale/, "PSFS"],
  [/quick ?dash/, "QuickDASH"],
];

const REFERENCE_NOTE = "The clinic record holds one referral reference – check it is the number this question asks for.";
const FORWARD_LOOKING = /\b(?:expected|estimated|anticipated|planned|predicted|likely|projected|proposed)\b/;
const OPINION =
  /\b(?:prognos\w*|opinion|recommend\w*|fit (?:for|to) (?:work|return|drive|duties)|fitness (?:for|to) work|return to (?:work|normal|full) (?:duties|activities)?|return to work|restrictions?|adjustments?|causation|caused by|attributable|further (?:treatment|sessions|physiotherapy)|additional (?:treatment|sessions)|more sessions|future treatment|recovery (?:period|time)|long[- ]term|permanent\w*|maximum (?:medical )?improvement)\b/;

/** Where the answer to a portal question comes from (the mapping screen lets staff change it). */
export function classifyPortalQuestion(label: string): PortalQuestionClass {
  const l = norm(label);
  const narrative: PortalQuestionClass = { fillSource: { kind: "notes_narrative" }, answerType: null, confidence: "high" };

  if (/\b(?:office use|official use|internal use|invoice|payment|bank|sort code|account (?:no|number)|iban|bic|swift|vat|fee|billing)\b/.test(l)) {
    return { fillSource: { kind: "leave_blank" }, answerType: null, confidence: "medium", note: "Looks like a payment or office-use question, so it is left blank." };
  }
  if (/\bsignature\b|^signed\b/.test(l)) return { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", confidence: "medium" };
  if (/\bdate signed\b|\bdate of signature\b/.test(l)) return { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", confidence: "medium" };
  if (FORWARD_LOOKING.test(l)) {
    return { fillSource: { kind: "clinician_opinion" }, answerType: /\bdate\b/.test(l) ? "date" : null, confidence: "medium" };
  }

  // Identifiers and record values: filled by code, never drafted.
  if (/\b(?:date of birth|d\.?o\.?b\.?|birth date)\b/.test(l)) return reg("patient.dob", "date");
  if (/\b(?:forename|first name|given name)s?\b/.test(l)) return reg("patient.firstName", "short_text");
  if (/\b(?:surname|last name|family name)\b/.test(l)) return reg("patient.lastName", "short_text");
  if (/\b(?:patient|member|client|claimant|policy ?holder|insured|customer)(?:'s)? (?:full )?name\b|^(?:full )?name\s*:?$/.test(l)) return reg("patient.fullName", "short_text");
  if (/\b(?:patient|member|client|home)(?:'s)? address\b|^address\s*:?$/.test(l)) return reg("patient.address", "long_text");
  if (/^age\b|\bage of (?:the )?(?:patient|member|client)\b/.test(l)) return reg("patient.age", "number");
  if (/^(?:sex|gender)\b/.test(l)) return reg("patient.sex", "short_text");
  if (/\b(?:occupation|job title|job role)\b/.test(l)) return reg("patient.occupation", "short_text");
  if (/\bemployer(?:'s name)?\s*:?$|\bname of (?:the )?employer\b/.test(l)) return reg("patient.employer", "short_text");
  // The insurer's membership and authorisation numbers have their own record values (filled only on
  // the matching insurer's questions – core/form-record-rules.ts); the same wording as ai/form-classify.ts.
  if (/\b(?:membership|member|customer|scheme)(?:'s)? ?(?:no\.?|number|id)\b/.test(l)) return reg("referral.membershipNumber", "short_text");
  if (/\b(?:pre-?)?authori[sz]ation (?:no\.?|number|code|reference|ref)\b|\bauth(?:orisation)? code\b/.test(l)) {
    return reg("referral.authorisationNumber", "short_text");
  }
  if (
    /\b(?:membership|member|policy|claim|case|authori[sz]ation|pre-?authori[sz]ation|referral|your|insurer'?s?)(?:'s)? ?(?:no\.?|number|code|ref(?:erence)?)\b/.test(l) ||
    /^(?:reference|ref)(?: no\.?| number)?\s*:?$/.test(l)
  ) {
    return { ...reg("referral.reference", "short_text", REFERENCE_NOTE), confidence: "low" };
  }
  if (/\bdate of (?:the )?(?:accident|incident|injury)\b|\b(?:accident|incident|injury) date\b/.test(l)) return reg("incident.date", "date");
  if (
    /\bdate (?:of )?(?:the )?(?:first|initial) (?:seen|appointment|assessment|treatment|session|consultation|attendance)\b|\b(?:first|initial) (?:appointment|assessment|treatment|session|consultation) date\b|\bdate first seen\b|\btreatment start date\b|\bdate (?:treatment )?(?:started|commenced|began)\b/.test(l)
  ) {
    return reg("episode.firstSeen", "date");
  }
  if (/\bdate (?:of )?(?:the )?(?:last|latest|most recent|final) (?:seen|appointment|assessment|treatment|session|consultation|attendance)\b|\bdate last seen\b/.test(l)) {
    return reg("episode.lastSeen", "date");
  }
  if (/\b(?:date of discharge|discharge date)\b/.test(l)) return reg("episode.dischargeDate", "date");
  if (/\b(?:clinic|practice|provider)(?:'s)? name\b|\bname of (?:the )?(?:clinic|practice|provider)\b/.test(l)) return reg("clinic.name", "short_text");
  if (/\b(?:clinic|practice|provider)(?:'s)? address\b/.test(l)) return reg("clinic.address", "long_text");
  if (
    /\b(?:treating )?(?:physiotherapist|physio|clinician|therapist|practitioner)(?:'s)? name\b|\bname of (?:the )?(?:treating )?(?:physiotherapist|physio|clinician|therapist|practitioner)\b/.test(l)
  ) {
    return reg("clinician.name", "clinician_name");
  }
  if (/\bhcpc\b|\b(?:professional )?registration (?:no\.?|number)\b/.test(l)) return reg("clinician.hcpc", "hcpc_number");

  // Figures computed by code from the appointments and outcome scores.
  const countQuestion = l.length <= 90 && !/\b(?:further|more|additional|remaining|requested|planned|describe|details)\b/.test(l);
  if (countQuestion && /\b(?:missed|dna|did not attend|failed to attend)\b/.test(l) && /\b(?:number|no\.?|how many)\b/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" }, answerType: "number", confidence: "medium" };
  }
  if (
    countQuestion &&
    !/\b(?:missed|dna|did not attend|cancel\w*)\b/.test(l) &&
    (/\b(?:number|no\.?|total) of (?:sessions|appointments|treatments|treatment sessions|visits|consultations)\b|\b(?:sessions|appointments|treatments) (?:attended|used|completed)\b/.test(l) ||
      /^how many (?:sessions|appointments|treatments)\b.*\b(?:attended|used|completed|had|so far|to date)\b/.test(l))
  ) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" }, answerType: "number", confidence: "medium" };
  }
  for (const [re, instrument] of OUTCOME_WORDS) {
    if (re.test(l)) return { fillSource: { kind: "computed_fact", factId: `FACT-outcomes-${instrument}`, format: "summary" }, answerType: null, confidence: "medium" };
  }

  if (OPINION.test(l)) return { fillSource: { kind: "clinician_opinion" }, answerType: null, confidence: "medium" };
  return narrative;
}

/* ------------------------------------------------------------------------------------------------
 * Building the question set (a proposed form map with no file)
 * ----------------------------------------------------------------------------------------------*/

/** One form field per parsed question: F-01…, the virtual anchor, the inferred fill source. */
export function questionFields(questions: readonly ParsedQuestion[]): FormField[] {
  return questions.map((q, i) => {
    const c = classifyPortalQuestion(q.label);
    const answerType = q.hinted ? q.answerType : c.answerType ?? q.answerType;
    return {
      id: `F-${String(i + 1).padStart(2, "0")}`,
      label: q.label,
      ...(q.section ? { section: q.section } : {}),
      guidance: "",
      answerType,
      ...(q.options?.length ? { options: q.options } : {}),
      anchor: questionAnchor(i),
      fillSource: c.fillSource,
      required: q.required && c.fillSource.kind !== "leave_blank",
      confidence: c.confidence,
      ...(c.note ? { note: c.note } : {}),
    };
  });
}

export interface CreateQuestionSetInput {
  referrer: ReferrerInfo;
  /** Default: "<referrer> – portal questions". */
  title?: string;
  questions: readonly ParsedQuestion[];
  /** Parse warnings, kept with the map ("Notes from the analysis"). */
  warnings?: readonly string[];
  id?: string;
  tenantId?: string;
  now?: Date;
}

/**
 * A PROPOSED question set (status "proposed"): staff check it in the mapping screen and confirm it
 * (POST /forms/confirm attests it), exactly like an uploaded form.
 */
export async function createQuestionSet(input: CreateQuestionSetInput): Promise<FormDefinition> {
  const at = nowIso(input.now);
  const referrer: ReferrerInfo = { name: clean(input.referrer.name), type: input.referrer.type };
  const fields = questionFields(input.questions);
  return {
    id: input.id ?? createId("form"),
    tenantId: input.tenantId ?? DEMO_TENANT_ID,
    referrer,
    title: clean(input.title) || `${referrer.name} – portal questions`,
    file: await questionSetFile(fields),
    kind: "questions",
    fields,
    status: "proposed",
    analysis: {
      mode: "rules",
      promptVersion: QUESTION_SET_PARSER_VERSION,
      at,
      warnings: Array.from(input.warnings ?? []),
    },
    createdAt: at,
    updatedAt: at,
  };
}

/** Fictional, generic example questions (the "Insert example questions" button). */
export const EXAMPLE_PORTAL_QUESTIONS = [
  "# Patient and treatment details",
  "Patient's full name",
  "Date of birth",
  "Membership number",
  "Date of initial assessment",
  "Number of sessions attended to date",
  "# Clinical update",
  "Presenting condition and how it started [long]",
  "Current symptoms and progress since the initial assessment [long]",
  "Objective findings at the latest session [long]",
  "Outcome measure scores (initial and latest)",
  "Is the patient back at work? [yes/no]",
  "# Plan",
  "Is further treatment requested? [yes/no]",
  "Number of further sessions requested [number]",
  "Expected discharge date [date] [optional]",
  "Prognosis [long]",
].join("\n");
