/**
 * Referrer forms (Revision 2): pure helpers that let the existing template machinery (validators, AI
 * drafting, review, sign) work on a referrer's OWN form.
 *
 * A confirmed FormDefinition becomes a ReportTemplate (formToTemplate) with one section per answerable
 * field (key = field ID, e.g. "F-07"). A form report (core/report-factory.ts createFormReport) carries
 * `report.form` and one ReportSection per answerable field:
 *
 *   fillSource          → section kind          filled by
 *   registration        → from_records          CODE now (resolveRegistrationValue), never the AI
 *   computed_fact       → from_records          CODE now (resolveComputedFactValue)
 *   notes_narrative     → ai_narrative          Claude via POST /drafts, strictly from the notes, cited
 *   clinician_opinion   → clinician_opinion     only an opinion a clinician recorded (attributed); else blank + gap
 *   signoff             → declaration           the server-signed receipt at approval (blank on a DRAFT)
 *   leave_blank         → (no section)          nobody
 *   fixed               → from_records          CODE now (the map's fixed answer; core/form-record-rules.ts)
 *
 * Answers: for text answer types the section's paragraphs ARE the answer; for yes/no, tick box, choice,
 * date and number the structured value is `section.answer` (paragraphs then hold the cited support).
 * buildFormAnswers() turns a report into the `answers` map the forms engine writes into the original
 * file (forms/docx-fill.ts, forms/pdf-fill.ts).
 *
 * Pure: no React, no Node built-ins, no env. Safe in the browser and on the server.
 *
 * Owner: ai agent (contract-stage baseline; exported signatures are contract).
 */
import { bundleClinic } from "./clinic";
import { formatScore } from "./computed-facts";
import { ageOn, compareIsoDateTime, formatUkDate, isValidIsoDate, parseUkDate, todayIso } from "./dates";
import { isNonClinicParty, partyLabel } from "./parties";
import { ANSWER_TYPE_LABELS, FORM_KIND_LABELS } from "./labels";
import { hasRowContent, isTableAnchor, rowsToText } from "./form-tables";
import { isQuestionAnchor, isQuestionSet } from "./question-set";
import type {
  AnswerType,
  Clinician,
  ComputedFact,
  ComputedFactFormat,
  EpisodeBundle,
  FactId,
  FillSource,
  FormAnswer,
  FormAnswerKind,
  FormAnswerRow,
  FormDefinition,
  FormField,
  InstructingParty,
  ReferrerType,
  RegistrationPath,
  Report,
  ReportFormRef,
  ReportSection,
  ReportTemplate,
  SectionKind,
  SignReceipt,
  SignoffPart,
  TemplateScope,
  TemplateSection,
} from "./types";

/* ------------------------------------------------------------------------------------------------
 * Form ↔ template identity
 * ----------------------------------------------------------------------------------------------*/

/** Template IDs of form reports start with this prefix: "form:<formId>". */
export const FORM_TEMPLATE_PREFIX = "form:" as const;

/** "form:<formId>" – the `templateId` of a report that completes this form. */
export function formTemplateId(formId: string): string {
  return `${FORM_TEMPLATE_PREFIX}${formId}`;
}

/** The form ID inside a form template ID, or null for a built-in template ID. */
export function formIdFromTemplateId(templateId: string): string | null {
  return templateId.startsWith(FORM_TEMPLATE_PREFIX) ? templateId.slice(FORM_TEMPLATE_PREFIX.length) || null : null;
}

/** True when the report completes a referrer's own form (has `report.form`). */
export function isFormReport<R extends Pick<Report, "form">>(report: R): report is R & { form: ReportFormRef } {
  return report.form !== undefined && report.form !== null;
}

/** The `report.form` reference for a form definition. */
export function formRefOf(form: FormDefinition): ReportFormRef {
  return {
    formId: form.id,
    title: form.title,
    referrer: form.referrer,
    fileSha256: form.file.sha256,
    kind: form.kind,
    // The server-attested map this report is started from (bound into the signed content).
    ...(form.confirmed?.mapSha256 && form.confirmed.mac ? { mapSha256: form.confirmed.mapSha256 } : {}),
  };
}

/**
 * Whether the browser holds a server-attested confirmation for this map (status "confirmed" with the
 * server's map hash and MAC). The server re-verifies it on every request; this is for the UI only.
 */
export function hasAttestedConfirmation(form: Pick<FormDefinition, "status" | "confirmed">): boolean {
  return form.status === "confirmed" && Boolean(form.confirmed?.mapSha256 && form.confirmed?.mac);
}

/* ------------------------------------------------------------------------------------------------
 * Attestations and scope for form reports
 * ----------------------------------------------------------------------------------------------*/

/** Statements the approving clinician ticks before a completed form is issued (copied into the receipt). */
export const FORM_ATTESTATIONS = [
  "I have checked every answer on this form against the source records it cites.",
  "Opinions on this form are my own, or are clearly attributed to the clinician who recorded them.",
  "I understand that the automated checks cannot detect a paraphrase error that cites a valid note, and I have reviewed the drafted answers for that.",
  "I have reviewed the completed form in the referrer's original layout and it is ready to issue.",
] as const;

/**
 * A portal question set (FormKind "questions") has no layout to review: its last statement is about the
 * answers that staff will copy into the referrer's portal. The first three are FORM_ATTESTATIONS'.
 */
export const QUESTION_SET_ATTESTATIONS = [
  FORM_ATTESTATIONS[0],
  FORM_ATTESTATIONS[1],
  FORM_ATTESTATIONS[2],
  "I have reviewed every answer and they are ready to be entered in the referrer's portal.",
] as const;

const NO_SCOPE: TemplateScope = { excludeFields: [], excludeTerms: [] };

/**
 * Employer and case-manager referrers: fitness-for-work scope (same rules as the built-in employer
 * template). Case managers' return-to-work forms usually reach the employer, so unrelated past medical
 * and social history is withheld from the AI and flagged if it appears in an answer.
 */
const EMPLOYER_SCOPE: TemplateScope = {
  excludeFields: ["note.pastMedicalHistory", "note.socialHistory"],
  excludeTerms: [
    "past medical history",
    "previous medical history",
    "medical history",
    "PMH",
    "social history",
    "family history",
    "smoker",
    "smoking",
    "alcohol",
    "units per week",
    "recreational drugs",
  ],
};

/** Data scope applied before drafting a form for this kind of referrer. */
export function formScope(referrerType: ReferrerType): TemplateScope {
  return referrerType === "employer" || referrerType === "case_manager" ? EMPLOYER_SCOPE : NO_SCOPE;
}

/* ------------------------------------------------------------------------------------------------
 * Referrer names (pure; shared by the form picker and createFormReport)
 * ----------------------------------------------------------------------------------------------*/

/** Words that do not identify an organisation. */
const GENERIC_ORG_WORDS = new Set([
  "fictional", "ltd", "limited", "plc", "llp", "llc", "inc", "co", "company", "group", "the", "and", "of", "uk",
  "solicitors", "solicitor", "law", "legal", "medico", "medicolegal", "mlc", "services", "service", "solutions",
  "insurance", "assurance", "insurer", "claims", "claim", "case", "management", "managers", "manager", "rehab",
  "rehabilitation", "health", "healthcare", "occupational", "logistics", "freight", "partners", "associates", "consulting",
]);

export function normaliseOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(fictional\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function distinctiveTokens(name: string): string[] {
  return Array.from(new Set(normaliseOrgName(name).split(" ").filter((w) => w.length > 1 && !GENERIC_ORG_WORDS.has(w))));
}

/** Distinctive words two organisation names share (0 when either has none). */
export function sharedOrgTokens(a: string, b: string): number {
  const theirs = new Set(distinctiveTokens(b));
  return distinctiveTokens(a).filter((t) => theirs.has(t)).length;
}

/**
 * Whether a form's referrer is the organisation on the referral: the same name, or at least two
 * distinctive words in common ("Harrow & Pike Solicitors" ↔ "Harrow & Pike Medico-Legal"). One shared
 * word ("Northfield Freight" ↔ "Northfield Assurance") is not enough.
 */
export function referrerNamesMatch(a: string, b: string): boolean {
  return normaliseOrgName(a) === normaliseOrgName(b) || sharedOrgTokens(a, b) >= 2;
}

/** Words in a question that point at the referral party's own reference, by referral type. */
const PARTY_REFERENCE_WORDS: Record<InstructingParty["type"], RegExp> = {
  solicitor: /\b(?:solicitors?|law firm|legal representatives?)\b/,
  employer: /\b(?:employers?|employer's|company|client|client's)\b/,
  insurer: /\b(?:insurers?|insurer's|insurance|policy|policyholder|underwriters?)\b/,
  case_manager: /\bcase manage(?:r|rs|ment)\b/,
  mlc: /\b(?:agency|medico-?legal|mlc)\b/,
  other: /(?!)/,
};

function mentionsToken(text: string, tokens: string[]): boolean {
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

/**
 * Whether a referral-reference question on a form from ANOTHER organisation asks for the referral
 * party's reference ("Instructing party reference", "Employer / client reference" when the employer
 * referred) rather than the form issuer's own number ("Policy / claim no." on an insurer's form,
 * "Kingsway case no."). Only then may code copy the referral's reference into it; otherwise the answer
 * is left blank for staff to enter from the issuer's instruction letter.
 */
export function asksForReferralPartyReference(
  field: Pick<FormField, "label" | "guidance">,
  party: Pick<InstructingParty, "name" | "type">,
  formReferrerName: string,
): boolean {
  const text = `${field.label} ${field.guidance}`.toLowerCase();
  if (mentionsToken(text, distinctiveTokens(formReferrerName))) return false;
  if (/\binstruct(?:ing|ed|ion|ions)\b/.test(text)) return true;
  if (mentionsToken(text, distinctiveTokens(party.name))) return true;
  return PARTY_REFERENCE_WORDS[party.type].test(text);
}

/* ------------------------------------------------------------------------------------------------
 * Fields → sections
 * ----------------------------------------------------------------------------------------------*/

/** Report section kind for a fill source; null for leave_blank (no section). */
export function sectionKindForFillSource(source: FillSource): SectionKind | null {
  switch (source.kind) {
    case "registration":
    case "computed_fact":
    case "fixed":
    case "appointments_table":
      return "from_records";
    case "notes_narrative":
      return "ai_narrative";
    case "clinician_opinion":
      return "clinician_opinion";
    case "signoff":
      return "declaration";
    case "leave_blank":
      return null;
  }
}

/** A field gets a report section unless its fill source is leave_blank. */
export function isAnswerableField(field: FormField): boolean {
  return field.fillSource.kind !== "leave_blank";
}

/** The answerable fields, in form order. */
export function answerableFields(form: Pick<FormDefinition, "fields">): FormField[] {
  return form.fields.filter(isAnswerableField);
}

/** How the answer to a question of this type is stored on the report section. */
export function answerKindFor(answerType: AnswerType): FormAnswerKind {
  switch (answerType) {
    case "yes_no":
      return "yes_no";
    case "checkbox":
      return "checkbox";
    case "single_choice":
      return "choice";
    case "date":
    case "date_signed":
      return "date";
    case "number":
      return "number";
    case "table":
      return "rows";
    default:
      return "text";
  }
}

/** Guidance for the AI and the reviewer: the referrer's brief plus the expected answer shape. */
export function fieldGuidance(field: FormField): string {
  const parts = [field.guidance.trim()];
  if (field.section) parts.push(`Form section: ${field.section}.`);
  parts.push(`Answer type: ${ANSWER_TYPE_LABELS[field.answerType]}.`);
  if (field.options?.length) parts.push(`Options as printed: ${field.options.map((o) => `"${o}"`).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

/**
 * The ReportTemplate equivalent of a form, so validators, drafting, review and sign reuse the template
 * machinery. Sections: one per answerable field, key = field ID, title = label.
 */
export function formToTemplate(form: FormDefinition): ReportTemplate {
  const sections: TemplateSection[] = [];
  for (const field of answerableFields(form)) {
    const kind = sectionKindForFillSource(field.fillSource);
    if (!kind) continue;
    sections.push({ key: field.id, title: field.label, kind, guidance: fieldGuidance(field), required: field.required, answerType: field.answerType });
  }
  return {
    id: formTemplateId(form.id),
    name: form.title,
    documentTitle: form.title,
    audience: form.referrer.type,
    description: isQuestionSet(form)
      ? `${form.referrer.name}'s portal questions, answered for entry in the portal.`
      : `${form.referrer.name}'s own ${FORM_KIND_LABELS[form.kind].toLowerCase()}, completed in its original layout.`,
    version: form.versionLabel?.trim() || "1",
    scope: formScope(form.referrer.type),
    sections,
    declarationText: "",
    declarationNote: isQuestionSet(form)
      ? "The referrer's portal holds its own declaration; approval is recorded in the server-signed receipt."
      : "The referrer's own declaration wording is part of the form and is completed in place on approval.",
    attestations: isQuestionSet(form) ? [...QUESTION_SET_ATTESTATIONS] : [...FORM_ATTESTATIONS],
    docxTemplateId: formTemplateId(form.id),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Values filled by CODE (registration, computed facts)
 * ----------------------------------------------------------------------------------------------*/

export interface FormValueContext {
  /** The unscoped bundle. */
  bundle: EpisodeBundle;
  instructingParty: InstructingParty;
  computedFacts: ComputedFact[];
  /** Treating clinician for clinician.* paths (default: the clinician who wrote most notes, latest on a tie). */
  clinician?: Clinician;
  /** ISO date of the report (age, report.date). */
  reportDate: string;
}

/** A value resolved by code: `text` is written for text anchors, `value` for structured answers. */
export interface ResolvedFormValue {
  text: string;
  /** ISO date for dates, digits for numbers, boolean for yes/no and tick boxes, otherwise the text. */
  value: string | boolean;
  /** Citable IDs ("REG", "FACT-…", "N-…"). */
  sourceIds: string[];
}

function hasFact(facts: ComputedFact[], id: string): boolean {
  return facts.some((f) => f.id === id);
}

function withFact(facts: ComputedFact[], base: string[], id: FactId): string[] {
  return hasFact(facts, id) ? [...base, id] : base;
}

/** The clinician who wrote most notes (latest note wins a tie), if any. */
export function primaryTreatingClinician(bundle: EpisodeBundle): Clinician | null {
  const notes = [...bundle.notes].sort(compareIsoDateTime);
  const counts = new Map<string, { clinician: Clinician; n: number; last: number }>();
  notes.forEach((note, i) => {
    const key = `${note.author.name}|${note.author.hcpc}`;
    const entry = counts.get(key) ?? { clinician: note.author, n: 0, last: -1 };
    entry.n += 1;
    entry.last = i;
    counts.set(key, entry);
  });
  let best: { clinician: Clinician; n: number; last: number } | null = null;
  for (const entry of Array.from(counts.values())) {
    if (!best || entry.n > best.n || (entry.n === best.n && entry.last > best.last)) best = entry;
  }
  return best?.clinician ?? bundle.clinicians[0] ?? null;
}

function dateValue(iso: string, sourceIds: string[]): ResolvedFormValue {
  return { text: formatUkDate(iso), value: iso, sourceIds };
}

function textValue(text: string | undefined | null, sourceIds: string[]): ResolvedFormValue | null {
  const t = (text ?? "").trim();
  return t ? { text: t, value: t, sourceIds } : null;
}

/**
 * The patient's insurer as the record holds it: the referral's insurer name, or – for an insurer referral
 * that does not name one separately – the referring insurer itself. Null when the record names no insurer.
 */
export function insurerNameOnRecord(bundle: Pick<EpisodeBundle, "referral">): string | null {
  const named = bundle.referral.insurerName?.trim();
  if (named) return named;
  return bundle.referral.type === "insurer" && bundle.referral.name.trim() ? bundle.referral.name.trim() : null;
}

const SEX_TEXT: Record<EpisodeBundle["registration"]["sex"], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  not_recorded: "",
};

/**
 * Resolve a registration path from the bundle (code only, never AI). Returns null when the record does
 * not hold the value (the caller leaves the answer blank and raises a gap; it never guesses).
 */
export function resolveRegistrationValue(
  path: RegistrationPath,
  ctx: FormValueContext,
  answerType?: AnswerType,
): ResolvedFormValue | null {
  const { bundle, instructingParty: party, computedFacts: facts } = ctx;
  const reg = bundle.registration;
  const REG = ["REG"];
  const notes = [...bundle.notes].sort(compareIsoDateTime);
  const attended = bundle.appointments.filter((a) => a.status === "ATT").sort(compareIsoDateTime);
  const episodeIds = (fallbackNoteId?: string) =>
    hasFact(facts, "FACT-episode") ? ["FACT-episode"] : fallbackNoteId ? [fallbackNoteId] : [];

  switch (path) {
    case "patient.fullName":
      return textValue(reg.fullName, REG);
    case "patient.firstName":
      return textValue(reg.firstName, REG);
    case "patient.lastName":
      return textValue(reg.lastName, REG);
    case "patient.dob":
      return isValidIsoDate(reg.dob) ? dateValue(reg.dob, REG) : null;
    case "patient.age": {
      if (!isValidIsoDate(reg.dob)) return null;
      const age = ageOn(reg.dob, ctx.reportDate);
      return {
        text: answerType === "number" ? String(age) : `${age} years`,
        value: String(age),
        sourceIds: withFact(facts, REG, "FACT-age"),
      };
    }
    case "patient.sex":
      return textValue(SEX_TEXT[reg.sex], REG);
    case "patient.address":
      return textValue(reg.addressSummary, REG);
    case "patient.occupation":
      return textValue(reg.occupation, REG);
    case "patient.employer":
      return textValue(reg.employer, REG);
    case "patient.title":
      return textValue(reg.title, REG);
    case "patient.phone":
      return textValue(reg.contact?.phone, REG);
    case "patient.email":
      return textValue(reg.contact?.email, REG);
    case "referral.insurerName":
      return textValue(insurerNameOnRecord(bundle), REG);
    // Insurer identifiers: createFormReport copies them only onto the insurer's own form
    // (core/form-record-rules.ts withheldInsurerIdentifier).
    case "referral.membershipNumber":
      return textValue(bundle.referral.membershipNumber, REG);
    case "referral.authorisationNumber":
      return textValue(bundle.referral.authorisationNumber, REG);
    case "referral.referrerName":
      return textValue(party.name, REG);
    case "referral.reference":
      return textValue(party.reference, REG);
    case "incident.date":
      return bundle.incident?.date ? dateValue(bundle.incident.date, REG) : null;
    case "incident.mechanism":
      return textValue(bundle.incident?.mechanism, REG);
    case "episode.firstSeen": {
      const first = attended[0]?.date ?? notes[0]?.date;
      return first ? dateValue(first, episodeIds(notes[0]?.id)) : null;
    }
    case "episode.lastSeen": {
      const last = attended[attended.length - 1]?.date ?? notes[notes.length - 1]?.date;
      return last ? dateValue(last, episodeIds(notes[notes.length - 1]?.id)) : null;
    }
    case "episode.dischargeDate": {
      if (bundle.episodeStatus !== "discharged") return null;
      const discharge = notes.filter((n) => n.type === "discharge").pop() ?? notes[notes.length - 1];
      return discharge ? dateValue(discharge.date, episodeIds(discharge.id)) : null;
    }
    // The clinic's own details (a clinic's profile on its bundle; DEMO_CLINIC in the public demo; blank for a
    // clinic without a profile – never the fictional demo clinic): core/clinic.ts bundleClinic().
    case "clinic.name":
      return textValue(bundleClinic(bundle)?.name, []);
    case "clinic.address":
      return textValue(bundleClinic(bundle)?.addressLines.join(", "), []);
    case "clinic.phone":
      return textValue(bundleClinic(bundle)?.phone, []);
    case "clinic.email":
      return textValue(bundleClinic(bundle)?.email, []);
    case "report.date":
      return dateValue(ctx.reportDate.slice(0, 10), []);
    case "clinician.name":
    case "clinician.hcpc":
    case "clinician.profession": {
      const clinician = ctx.clinician ?? primaryTreatingClinician(bundle);
      if (!clinician) return null;
      const noteId = notes.filter((n) => n.author.name === clinician.name).pop()?.id;
      const ids = noteId ? [noteId] : [];
      if (path === "clinician.name") return textValue(clinician.name, ids);
      if (path === "clinician.hcpc") return textValue(clinician.hcpc, ids);
      return textValue(clinician.role ?? "Physiotherapist", ids);
    }
  }
}

/** Resolve a computed fact for a form answer (code only). Null when the record does not support it. */
export function resolveComputedFactValue(
  factId: FactId,
  format: ComputedFactFormat | undefined,
  ctx: FormValueContext,
  answerType?: AnswerType,
): ResolvedFormValue | null {
  const fact = ctx.computedFacts.find((f) => f.id === factId);
  const ids = fact ? [fact.id] : [];
  if (format === "sessions_attended" || format === "dna_count") {
    if (ctx.bundle.appointments.length === 0) return null;
    const status = format === "sessions_attended" ? "ATT" : "DNA";
    const n = ctx.bundle.appointments.filter((a) => a.status === status).length;
    return { text: String(n), value: String(n), sourceIds: hasFact(ctx.computedFacts, "FACT-attendance") ? ["FACT-attendance"] : ids };
  }
  if (format === "first_score" || format === "latest_score") {
    const instrument = /^FACT-outcomes-(.+)$/.exec(factId)?.[1];
    const points = ctx.bundle.outcomeMeasures
      .filter((m) => m.instrument === instrument)
      .flatMap((m) => m.points.map((p) => ({ ...p, unit: m.unit })))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const point = format === "first_score" ? points[0] : points[points.length - 1];
    if (!point || !instrument) return null;
    return textValue(`${instrument} ${formatScore(point.value, point.unit)} (${formatUkDate(point.date)})`, ids);
  }
  if (!fact) return null;
  const text = answerType === "long_text" && fact.detail ? `${formFactText(fact.value)}. ${formFactText(fact.detail)}` : formFactText(fact.value);
  return textValue(text, ids);
}

/**
 * A computed fact's value or detail as text for a referrer's form. The facts are written for citing
 * (FACT-*, N-###, A-### IDs, status codes, arrows); a form gets plain words: no internal note or
 * appointment IDs, no ATT/DNA/LCN/CNC codes after their words, and "→" read as "then".
 */
export function formFactText(text: string): string {
  return text
    .replace(/\s*\((?:[A-Z]{1,4}-\d{2,}(?:,\s*)?)+\)/g, "") // " (N-001)", " (N-001, N-003)"
    .replace(/\((?:[A-Z]{1,4}-\d{2,}),\s*/g, "(") // "(A-004, reason recorded: …)" → "(reason recorded: …)"
    .replace(/\s*\((?:ATT|DNA|LCN|CNC)\)/g, "") // "Attended (ATT): 5" → "Attended: 5"
    .replace(/\((?:CNC),\s*/g, "(") // "(CNC, not counted above)" → "(not counted above)"
    .replace(/\s*→\s*/g, ", then ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

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
export function isSectionAnswered(section: Pick<ReportSection, "paragraphs" | "answer">): boolean {
  if (section.answer?.kind === "rows") return hasRowContent(section.answer.value);
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

/**
 * The answers to write into the referrer's original file. Signoff fields are filled only when a
 * (verified) receipt is passed – on a DRAFT they stay blank. Unanswered fields map to {} (left blank).
 */
export function buildFormAnswers(
  report: Pick<Report, "sections">,
  form: Pick<FormDefinition, "fields">,
  opts: { receipt?: Pick<SignReceipt, "signer" | "signedAt"> | null } = {},
): FormFillAnswers {
  const signoff = opts.receipt ? signoffValuesFromReceipt(opts.receipt) : null;
  const answers: FormFillAnswers = {};
  for (const field of answerableFields(form)) {
    if (field.fillSource.kind === "signoff") {
      answers[field.id] = signoffAnswer(field.fillSource.part, signoff);
      continue;
    }
    const section = report.sections.find((s) => s.key === field.id);
    if (!section || !isSectionAnswered(section)) {
      answers[field.id] = {};
      continue;
    }
    const text = answerToText(section);
    const structured = section.answer && section.answer.kind !== "text" ? section.answer.value : undefined;
    if (Array.isArray(structured)) {
      answers[field.id] = { text, rows: structured };
      continue;
    }
    answers[field.id] = structured === undefined ? { text } : { text, value: structured };
  }
  return answers;
}

/* ------------------------------------------------------------------------------------------------
 * Block IDs (Word outline anchors)
 * ----------------------------------------------------------------------------------------------*/

export interface CellRef {
  t: number;
  r: number;
  c: number;
}

/**
 * Parsed block ID: a body paragraph ("p12"), or a table cell path ("t2.r3.c1", nested
 * "t2.r3.c1.t0.r0.c0") with an optional paragraph inside the cell ("t2.r3.c1.p0"). All indexes 0-based.
 */
export type ParsedBlockId = { kind: "paragraph"; p: number } | { kind: "cell"; cells: CellRef[]; p?: number };

export function formatParagraphBlockId(p: number): string {
  return `p${p}`;
}

export function formatCellBlockId(cells: readonly CellRef[], p?: number): string {
  const path = cells.map((c) => `t${c.t}.r${c.r}.c${c.c}`).join(".");
  return p === undefined ? path : `${path}.p${p}`;
}

/** Inverse of formatParagraphBlockId / formatCellBlockId; null if malformed. */
export function parseBlockId(id: string): ParsedBlockId | null {
  const body = /^p(\d+)$/.exec(id);
  if (body) return { kind: "paragraph", p: Number(body[1]) };
  const segs = id.split(".");
  const cells: CellRef[] = [];
  let i = 0;
  while (i + 2 < segs.length) {
    const t = /^t(\d+)$/.exec(segs[i]);
    const r = /^r(\d+)$/.exec(segs[i + 1] ?? "");
    const c = /^c(\d+)$/.exec(segs[i + 2] ?? "");
    if (!t || !r || !c) break;
    cells.push({ t: Number(t[1]), r: Number(r[1]), c: Number(c[1]) });
    i += 3;
  }
  if (cells.length === 0) return null;
  if (i === segs.length) return { kind: "cell", cells };
  const para = i === segs.length - 1 ? /^p(\d+)$/.exec(segs[i]) : null;
  return para ? { kind: "cell", cells, p: Number(para[1]) } : null;
}

/* ------------------------------------------------------------------------------------------------
 * Answer-space identity (comparing two maps of the same file)
 * ----------------------------------------------------------------------------------------------*/

/** Where an anchor writes, as a comparable string (block / placeholder / glyphs / PDF field / box). */
export function formAnchorKey(anchor: FormField["anchor"]): string {
  switch (anchor.kind) {
    case "docx":
      if (anchor.target === "checkbox_glyph") {
        return `glyph:${(anchor.optionGlyphs ?? []).map((g) => `${g.blockId}#${g.glyphIndex}`).join(",")}`;
      }
      return `docx:${anchor.target === "replace_placeholder" ? `${anchor.blockId}|${anchor.placeholderText ?? ""}` : anchor.blockId}`;
    case "pdf_field": {
      // One question across several tick-box fields: every box it uses (a plain field keeps "pdf:<name>").
      const names = formAnchorPdfFieldNames(anchor);
      return names.length > 1 ? `pdfopts:${names.join("+")}` : `pdf:${names[0] ?? anchor.fieldName}`;
    }
    case "pdf_overlay":
      return `overlay:${anchor.page}:${Math.round(anchor.x / 10)}:${Math.round(anchor.y / 10)}`;
    case "pdf_char_fields":
      return `pdfchars:${anchor.fieldNames.join("+")}`;
    case "pdf_table":
      return `pdftable:${anchor.rows.map((r) => anchor.columns.map((c) => r[c.key] ?? "").join("|")).join(",")}`;
    case "pdf_overlay_table":
      return `overlaytable:${anchor.page}:${Math.round((anchor.columns[0]?.x ?? 0) / 10)}:${Math.round((anchor.rowTops[0] ?? 0) / 10)}`;
    case "pdf_overlay_ticks":
      return `ticks:${anchor.page}:${anchor.options.map((o) => `${Math.round(o.x / 10)}:${Math.round(o.y / 10)}`).join(",")}`;
  }
}

/**
 * The AcroForm fields an anchor writes into (empty for Word and flat-PDF anchors): the field itself,
 * every box of a one-of-several tick-box question, every one-character box, or every cell of a
 * fillable table. For the preview's highlight and the answer-space checks.
 */
export function formAnchorPdfFieldNames(anchor: FormField["anchor"]): string[] {
  switch (anchor.kind) {
    case "pdf_field": {
      // With optionFields the boxes listed there are the answer space (fieldName is the first of them).
      const names = anchor.optionFields?.length ? anchor.optionFields.map((o) => o.fieldName) : [anchor.fieldName];
      return Array.from(new Set(names.filter(Boolean)));
    }
    case "pdf_char_fields":
      return anchor.fieldNames.slice();
    case "pdf_table": {
      const names: string[] = [];
      for (const row of anchor.rows) for (const col of anchor.columns) if (row[col.key]) names.push(row[col.key]);
      return Array.from(new Set(names));
    }
    default:
      return [];
  }
}

/**
 * Field ID → answer-space key for every field of a map. Repeated keys (several blanks or content
 * controls in one block, filled in order) get "#2", "#3"… in form order, so two maps of the same file
 * can be matched answer space by answer space even when their field IDs differ.
 */
export function formAnchorKeys(form: Pick<FormDefinition, "fields">): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const field of form.fields) {
    const base = formAnchorKey(field.anchor);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(field.id, n === 1 ? base : `${base}#${n}`);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Sanity checks before a mapping is confirmed
 * ----------------------------------------------------------------------------------------------*/

/**
 * Plain-English problems that should stop a form map being confirmed (empty = OK). Includes a sign-off
 * (signature, name, HCPC number or date of the clinician's approval) in an answer space the form gives to
 * someone other than the clinic (`completedBy`: the patient, policyholder, their doctor or the insurer).
 */
export function checkFormDefinition(form: FormDefinition): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const questionPlaces = new Map<string, string>();
  for (const field of form.fields) {
    const where = `${field.id} (“${field.label}”)`;
    if (seen.has(field.id)) problems.push(`${field.id} is used by more than one question.`);
    seen.add(field.id);

    const anchorKind = field.anchor.kind;
    if (form.kind === "docx" && anchorKind !== "docx") problems.push(`${where}: a Word form needs a Word anchor.`);
    if (form.kind === "pdf_flat" && anchorKind !== "pdf_overlay" && anchorKind !== "pdf_overlay_table" && anchorKind !== "pdf_overlay_ticks") {
      problems.push(`${where}: a flat PDF has no fillable fields, so the answer needs a position on the page.`);
    }
    if (form.kind === "pdf_acroform" && anchorKind === "docx") problems.push(`${where}: a PDF form cannot use a Word anchor.`);
    if (form.kind === "questions") {
      // Portal questions have no file: each keeps its virtual place in the summary (core/question-set.ts).
      if (!isQuestionAnchor(field.anchor)) problems.push(`${where}: a portal question cannot point into a file. Remove it and add it again.`);
      else {
        const key = formAnchorKey(field.anchor);
        if (questionPlaces.has(key)) problems.push(`${where}: shares its place in the summary with ${questionPlaces.get(key)}. Remove it and add it again.`);
        else questionPlaces.set(key, field.id);
      }
    }

    if (field.anchor.kind === "docx" && form.kind !== "questions") {
      if (field.anchor.target === "replace_placeholder" && !field.anchor.placeholderText) {
        problems.push(`${where}: say which placeholder text to replace.`);
      }
      if (field.anchor.target === "checkbox_glyph" && !field.anchor.optionGlyphs?.length) {
        problems.push(`${where}: no tick boxes are linked to this question.`);
      }
      if (!parseBlockId(field.anchor.blockId)) problems.push(`${where}: the location “${field.anchor.blockId}” is not valid.`);
    }
    if (field.anchor.kind === "pdf_field" && field.anchor.optionFields?.length) {
      const opts = field.anchor.optionFields;
      if (opts.some((o) => !o.option.trim() || !o.fieldName.trim())) problems.push(`${where}: every tick box needs its option and its field.`);
      const seenOpt = new Set<string>();
      for (const o of opts) {
        const k = `${o.fieldName}\u0000${o.onValue ?? ""}`;
        if (seenOpt.has(k)) problems.push(`${where}: the tick box “${o.fieldName}” is linked to more than one option.`);
        seenOpt.add(k);
      }
    }
    if (field.anchor.kind === "pdf_char_fields") {
      if (new Set(field.anchor.fieldNames).size !== field.anchor.fieldNames.length) problems.push(`${where}: a character box is listed twice.`);
      if (field.anchor.format !== "chars" && field.answerType !== "date" && field.answerType !== "date_signed") {
        problems.push(`${where}: the boxes are written as a date, so the answer type must be a date.`);
      }
    }
    if (field.answerType === "single_choice" && !field.options?.length) {
      problems.push(`${where}: a single-choice question needs its options.`);
    }
    if (field.fillSource.kind === "fixed") {
      const fixed = field.fillSource.value.trim();
      if (!fixed) problems.push(`${where}: enter the fixed answer, or choose another source.`);
      else if (field.answerType !== "table" && answerKindFor(field.answerType) !== "text" && parseFormAnswerValue(field, fixed).value === null) {
        problems.push(
          `${where}: the fixed answer “${fixed}” does not fit a ${ANSWER_TYPE_LABELS[field.answerType].toLowerCase()} question${field.options?.length ? ` (options: ${field.options.join(", ")})` : ""}.`,
        );
      }
    }
    // Tables (S2): a table question needs a table position, and is filled from the appointments or left blank.
    if ((field.answerType === "table") !== isTableAnchor(field.anchor)) {
      problems.push(field.answerType === "table" ? `${where}: a table question needs the table's rows and columns on the form.` : `${where}: only a table question can be written into a table.`);
    }
    if (field.answerType === "table" && field.fillSource.kind !== "appointments_table" && field.fillSource.kind !== "leave_blank") {
      problems.push(`${where}: a table is filled from the appointment record, or left blank.`);
    }
    if (field.fillSource.kind === "appointments_table" && field.answerType !== "table") {
      problems.push(`${where}: only a table question can list the appointments.`);
    }
    // Multi-party forms: the clinician's approval never goes into another party's signature or declaration.
    if (field.fillSource.kind === "signoff" && field.completedBy && isNonClinicParty(field.completedBy)) {
      problems.push(`${where}: this is for ${partyLabel(field.completedBy)} to complete, so the clinician's approval cannot be written here. Set it to “Leave blank”.`);
    }
  }
  if (!form.fields.some(isAnswerableField)) problems.push("No question on this form is set to be completed.");
  return problems;
}
