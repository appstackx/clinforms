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
import { notApplicable } from "./conditions";
import { formatScore } from "./computed-facts";
import { ageOn, compareIsoDateTime, formatUkDate, isValidIsoDate, parseUkDate, todayIso } from "./dates";
import { isNonClinicParty, partyLabel, prefillSigners, prefillSignersText } from "./parties";
import { ANSWER_TYPE_LABELS, FORM_KIND_LABELS, type RecordSource } from "./labels";
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

/**
 * A form the clinic only PREFILLS for someone else to complete and sign (core/parties.ts prefillSigners –
 * a patient's claim form, a GP's report): the clinician checks the prefilled answers, but nobody at the
 * clinic signs or issues it. The first three statements are FORM_ATTESTATIONS'.
 */
export const PREFILL_ATTESTATIONS = [
  FORM_ATTESTATIONS[0],
  FORM_ATTESTATIONS[1],
  FORM_ATTESTATIONS[2],
  "I have reviewed the prefilled form in the referrer's original layout. It is for the people named on it to complete and sign; the clinic does not sign it.",
] as const;

const NO_SCOPE: TemplateScope = { excludeFields: [], excludeTerms: [] };

/** Terms of the past medical history and of the social history (withheld together with their note fields). */
const PMH_TERMS = ["past medical history", "previous medical history", "medical history", "PMH"];
const SOCIAL_TERMS = ["social history", "smoker", "smoking", "alcohol", "units per week", "recreational drugs"];

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

/** A question that asks for the past medical history ("Past medical history", "Relevant medical history", "PMH"). */
const ASKS_PMH = /\b(?:past|previous|relevant|pre-?existing)\s+medical\s+history\b|^\s*(?:\d+[.)]\s*)?medical\s+history\b|\bPMH\b|\bco-?morbidit/i;
/**
 * A question that asks for the social history: "Social history", "Smoking status", "Alcohol intake", or a label that is
 * only "Smoker" / "Smoking" / "Alcohol" (security fix 24/10/2026, D3: a passing mention – "Was alcohol a factor in the
 * accident?" – no longer unlocks the whole social history).
 */
const ASKS_SOCIAL =
  /\bsocial\s+history\b|\b(?:smok(?:er|ing)|alcohol)\s+(?:status|history|intake|consumption|habits?|use)\b|^\s*(?:\d+[.)]\s*)?(?:smoker|smoking|alcohol)\s*[:?]?\s*$/i;
/**
 * A return-to-work / fitness-for-work form: it reaches the employer, so history stays withheld whatever it asks.
 * Security fix 24/10/2026 (D3): tested on normaliseScopeText() (hyphens, underscores, slashes and dots read as spaces:
 * "Return-to-Work", "TPN_RTW_Report", "Fitness-for-work"), and the usual wordings ("back to work", "return to full /
 * light / restricted duties", "workplace assessment") count too.
 */
const RETURN_TO_WORK =
  /\b(?:return(?:ing)?|back)\s+to\s+(?:work|employment|(?:full|normal|modified|light|restricted|amended)\s+duties)\b|\bfit(?:ness)?\s+(?:for|to)\s+(?:work|return|duties|(?:normal|modified|full|light|restricted)\s+duties)\b|\brtw\b|\bphased\s+return\b|\b(?:modified|restricted|amended|light)\s+(?:or\s+(?:modified|restricted|amended|light)\s+)?duties\b|\bwork\s+capacity\b|\bworkplace\s+assessment\b/i;

/** Hyphens, underscores, slashes and dots read as spaces (titles often come from file names: "TPN_RTW_Report"). */
export function normaliseScopeText(text: string): string {
  return text.replace(/[-_/.\u2010-\u2015]+/g, " ");
}

/**
 * Data scope applied before drafting a form for this kind of referrer.
 *
 * Fix 10/2026 (P3, scope by question): for an employer or case-manager referrer, history the form explicitly ASKS for
 * is no longer withheld – a personal-injury rehabilitation network's initial assessment form asks for the past
 * medical history, and its question was left blank as "outside the scope of this form". Such a question's history
 * (its note field and terms) is sent for drafting and its terms are confined to the answers of the asking questions
 * (TemplateScope.confineTerms: SCOPE_TERM anywhere else). Minimisation is kept for return-to-work / fitness-for-work
 * forms (they usually reach the employer) and for forms that do not ask. Other referrers: no scope, as before.
 *
 * Verify fix (10/2026): an EMPLOYER referrer's own form always keeps the minimisation, whatever it asks – the report
 * goes to the employer ("keep minimisation for employer-only forms", P3). Scope by question is for case managers
 * (personal-injury rehabilitation networks) only.
 */
export function formScope(referrerType: ReferrerType, form?: Pick<FormDefinition, "title" | "fields">): TemplateScope {
  if (referrerType !== "employer" && referrerType !== "case_manager") return NO_SCOPE;
  if (!form || referrerType === "employer") return EMPLOYER_SCOPE;
  const drafted = form.fields.filter((f) => f.fillSource.kind === "notes_narrative" || f.fillSource.kind === "clinician_opinion");
  const printed = (f: FormField) => normaliseScopeText(`${f.section ?? ""}\n${f.label}`);
  if (RETURN_TO_WORK.test(normaliseScopeText(form.title)) || form.fields.some((f) => RETURN_TO_WORK.test(printed(f)))) return EMPLOYER_SCOPE;
  const pmh = drafted.filter((f) => ASKS_PMH.test(f.label) || ASKS_PMH.test(f.section ?? ""));
  const social = drafted.filter((f) => ASKS_SOCIAL.test(f.label) || ASKS_SOCIAL.test(f.section ?? ""));
  if (pmh.length === 0 && social.length === 0) return EMPLOYER_SCOPE;
  const asked = new Set<string>([...(pmh.length ? PMH_TERMS : []), ...(social.length ? SOCIAL_TERMS : [])].map((t) => t.toLowerCase()));
  return {
    excludeFields: EMPLOYER_SCOPE.excludeFields.filter((f) => !(f === "note.pastMedicalHistory" && pmh.length) && !(f === "note.socialHistory" && social.length)),
    excludeTerms: EMPLOYER_SCOPE.excludeTerms.filter((t) => !asked.has(t.toLowerCase())),
    confineTerms: [
      ...(pmh.length ? [{ terms: PMH_TERMS, sectionKeys: pmh.map((f) => f.id) }] : []),
      ...(social.length ? [{ terms: SOCIAL_TERMS, sectionKeys: social.map((f) => f.id) }] : []),
    ],
  };
}

/**
 * Security fix 24/10/2026 (D8): the scope of ONE drafting call. History a case-manager form asks for (confineTerms) is
 * sent only in the calls that draft an asking question; every other call of the same form keeps the minimisation for
 * that history (its note field and its terms withheld), so it cannot leak into the other answers. Pure.
 */
export function scopeForDraftCall(scope: TemplateScope, sectionKeys: readonly string[]): TemplateScope {
  const groups = scope.confineTerms ?? [];
  if (groups.length === 0) return scope;
  const keys = new Set(sectionKeys);
  const elsewhere = groups.filter((g) => !g.sectionKeys.some((k) => keys.has(k)));
  if (elsewhere.length === 0) return scope;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t.toLowerCase() === b[i].toLowerCase());
  const fields = new Set(scope.excludeFields);
  const terms = [...scope.excludeTerms];
  for (const g of elsewhere) {
    if (same(g.terms, PMH_TERMS)) fields.add("note.pastMedicalHistory");
    if (same(g.terms, SOCIAL_TERMS)) fields.add("note.socialHistory");
    for (const t of g.terms) if (!terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  }
  return { ...scope, excludeFields: Array.from(fields), excludeTerms: terms };
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
  const signers = prefillSigners(form);
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
    scope: formScope(form.referrer.type, form),
    sections,
    declarationText: "",
    declarationNote: isQuestionSet(form)
      ? "The referrer's portal holds its own declaration; approval is recorded in the server-signed receipt."
      : signers
        ? `Nobody at the clinic signs this form: it is prefilled for ${prefillSignersText(signers)} to check, complete and sign. The clinician's check is recorded in the server-signed receipt.`
        : "The referrer's own declaration wording is part of the form and is completed in place on approval.",
    attestations: isQuestionSet(form) ? [...QUESTION_SET_ATTESTATIONS] : signers ? [...PREFILL_ATTESTATIONS] : [...FORM_ATTESTATIONS],
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
  /** 10/2026: the record leaves this answer space empty on purpose (an address line it does not have). */
  blank?: boolean;
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
  /** 10/2026: one line of an address printed over several lines (a registration fill source's `part`). */
  part?: AddressPart,
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
    case "patient.addressLines":
      if (part) return addressPartValue(splitUkAddress(reg.addressSummary).lines, part, REG);
      return textValue(splitUkAddress(reg.addressSummary).lines.join("\n"), REG);
    case "patient.postcode":
      return textValue(splitUkAddress(reg.addressSummary).postcode, REG);
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
    // Fix round 1 (B0-15): the appointments' times are in the record (Check the notes shows them).
    case "episode.firstSeenTime":
      return attended[0]?.time ? textValue(attended[0].time, attended[0].noteId ? [attended[0].noteId] : episodeIds()) : null;
    case "episode.attendedDate":
    case "episode.attendedTime": {
      const n = Math.max(1, Math.floor(part?.index ?? 1));
      const appt = attended[n - 1];
      // A session the record does not have (the 7th of 6) is written as nothing; the first must be there.
      if (!appt) return n >= 2 && attended.length > 0 ? { text: "", value: "", sourceIds: episodeIds(), blank: true } : null;
      const ids = appt.noteId ? [appt.noteId] : episodeIds();
      if (path === "episode.attendedDate") return dateValue(appt.date, ids);
      return appt.time ? textValue(appt.time, ids) : null;
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
    // 10/2026 (a clinic system's <<P_LOCATION_…>> codes): the clinic's address lines without the postcode, and the
    // postcode, from the same lines ("postcode last").
    case "clinic.addressLines": {
      const lines = clinicAddress(bundle).lines;
      if (part) return addressPartValue(lines, part, []);
      return textValue(lines.join("\n"), []);
    }
    case "clinic.postcode":
      return textValue(clinicAddress(bundle).postcode, []);
    // A detail the record here does not hold: never filled by code – staff enter it (the caller raises the gap).
    case "staff.entry":
      return null;
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

/** One line of a postal address printed over `of` lines: which line, 1-based (a registration fill source's `part`). */
export interface AddressPart {
  index: number;
  of: number;
}

/** The clinic's address lines (postcode last in its settings) split into lines and postcode. */
function clinicAddress(bundle: EpisodeBundle): { lines: string[]; postcode: string } {
  const lines = (bundleClinic(bundle)?.addressLines ?? []).map((l) => l.trim()).filter(Boolean);
  return splitUkAddress(lines.join(", "));
}

/**
 * Line `part.index` of an address printed over `part.of` lines: the record's lines in order; the last printed line
 * takes every line left over (joined with commas); a printed line the record has no line for is BLANK on purpose
 * (`blank: true` – written as nothing, the clinic system's code removed). An address the record does not hold at all
 * leaves the first line unanswered (one gap for staff) and the others blank.
 */
export function addressPartValue(lines: readonly string[], part: AddressPart, sourceIds: string[]): ResolvedFormValue | null {
  const of = Math.max(1, Math.floor(part.of));
  const index = Math.min(of, Math.max(1, Math.floor(part.index)));
  if (lines.length === 0) return index === 1 ? null : { text: "", value: "", sourceIds, blank: true };
  const text = index < of ? (lines[index - 1] ?? "") : lines.slice(index - 1).join(", ");
  return text.trim() ? { text: text.trim(), value: text.trim(), sourceIds } : { text: "", value: "", sourceIds, blank: true };
}

/** A UK postcode at the end of an address ("MK5 8ZZ", "SW1A 1AA"). */
const UK_POSTCODE_AT_END = /[,\s]*\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s*$/i;

/**
 * "22 Larkspur Mews, Loughton, Milton Keynes, MK5 8ZZ" → lines ["22 Larkspur Mews", "Loughton", "Milton
 * Keynes"] and postcode "MK5 8ZZ" – for a form with printed address lines and a separate postcode box.
 * Commas inside brackets ("(fictional)") never split a line. No postcode found: all parts are lines.
 */
export function splitUkAddress(address: string): { lines: string[]; postcode: string } {
  const text = address.trim();
  const m = UK_POSTCODE_AT_END.exec(text);
  const postcode = m ? m[1].toUpperCase().replace(/^(\S+?)(\d[A-Z]{2})$/, "$1 $2") : "";
  const rest = m ? text.slice(0, m.index) : text;
  const lines: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of Array.from(rest)) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "\n") && depth === 0) {
      if (cur.trim()) lines.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) lines.push(cur.trim());
  return { lines, postcode };
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
  if (format === "first_scores" || format === "latest_scores") {
    // Every outcome measure the record holds, in the record's order: its first (or latest) score.
    const first = format === "first_scores";
    const picked = ctx.bundle.outcomeMeasures
      .map((m) => {
        const sorted = m.points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const point = first ? sorted[0] : sorted[sorted.length - 1];
        return point ? { instrument: m.instrument, unit: m.unit, point } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (picked.length === 0) return null;
    const sameDate = picked.every((p) => p.point.date === picked[0].point.date);
    const parts = picked.map((p) => `${p.instrument} ${formatScore(p.point.value, p.unit)}${sameDate ? "" : ` (${formatUkDate(p.point.date)})`}`);
    const sourceIds = picked.map((p) => `FACT-outcomes-${p.instrument}`).filter((id) => hasFact(ctx.computedFacts, id));
    return textValue(`${parts.join(" · ")}${sameDate ? ` (${formatUkDate(picked[0].point.date)})` : ""}`, sourceIds.length ? sourceIds : ids);
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

/**
 * Fix round 1 (B0-19): where a registration-filled question's value really comes from (core/labels.ts RecordSource) –
 * "staff.entry" is typed by staff on each report, or chosen by the physiotherapist when the map's guidance says so;
 * "clinic.*" comes from the clinic's own details. Null for the patient's record and everything else.
 */
export function recordSourceOf(field: Pick<FormField, "fillSource" | "guidance">): RecordSource | null {
  if (field.fillSource.kind !== "registration") return null;
  const path = field.fillSource.path;
  if (path === "staff.entry") return /\bchosen by the (?:physiotherapist|clinician)\b/i.test(field.guidance ?? "") ? "physio_choice" : "staff_entry";
  return path.startsWith("clinic.") ? "clinic" : null;
}

/**
 * Fix round 1 (B0-21): each question's section heading for grouping on screen. A run of questions the map gives no
 * section takes the heading around it when the questions before and after it share one (10Bridge's address lines
 * between two "CLAIMANT DETAILS" questions); otherwise it keeps none ("" – its own group).
 */
export function sectionHeadings(fields: ReadonlyArray<Pick<FormField, "section">>): string[] {
  const own = fields.map((f) => f.section?.trim() ?? "");
  return own.map((h, i) => {
    if (h) return h;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = own[j];
    let after = "";
    for (let j = i + 1; j < own.length && !after; j++) after = own[j];
    return before && before === after ? before : "";
  });
}

/**
 * Fix round 1 (B0-20, B0-6): whether a form is an initial assessment or a discharge / final report, from its title – a
 * referrer usually sends both. Null for anything else (progress, interim, a return-to-work assessment, a portal).
 */
export type ReportKind = "initial" | "discharge";

export function reportKindOf(title: string | undefined): ReportKind | null {
  const t = (title ?? "").toLowerCase();
  if (/\b(?:discharge|final|end of treatment|eots|closing)\b/.test(t)) return "discharge";
  if (/\binitial\b/.test(t)) return "initial";
  if (/\bassessment\b/.test(t) && !/\b(?:return to work|progress|interim|review|functional|capacity|ergonomic|workplace)\b/.test(t)) return "initial";
  return null;
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
 * The answers to write into the referrer's original file. Signoff fields are filled only when a
 * (verified) receipt is passed – on a DRAFT they stay blank. Unanswered fields map to {} (left as printed) – or, fix
 * round 1 (B0-2), to {leftBlank: true} when a person left the question blank or the report is approved (a receipt is
 * passed, or the report is signed): then no printed default reads as an answer.
 */
export function buildFormAnswers(
  report: Pick<Report, "sections"> & Partial<Pick<Report, "gaps" | "flags" | "status">>,
  form: Pick<FormDefinition, "fields">,
  opts: { receipt?: Pick<SignReceipt, "signer" | "signedAt"> | null } = {},
): FormFillAnswers {
  const signoff = opts.receipt ? signoffValuesFromReceipt(opts.receipt) : null;
  const approved = Boolean(opts.receipt) || report.status === "signed";
  const answers: FormFillAnswers = {};
  for (const field of answerableFields(form)) {
    if (field.fillSource.kind === "signoff") {
      answers[field.id] = signoffAnswer(field.fillSource.part, signoff);
      continue;
    }
    const section = report.sections.find((s) => s.key === field.id);
    const blankByDesign = isBlankByDesign(section, field);
    // Fix round 1 (B0-7): a conditional question that does not apply prints nothing, whatever it holds.
    if (section && notApplicable(report.sections, field.id)) {
      answers[field.id] = { leftBlank: true };
      continue;
    }
    if (!section || !isSectionAnswered({ paragraphs: section.paragraphs, answer: section.answer, blankFromRecords: blankByDesign })) {
      answers[field.id] = section && (approved || leftBlankByPerson(report, field.id)) ? { leftBlank: true } : {};
      continue;
    }
    const text = answerToText(section);
    // 10/2026: left empty on purpose by the record – the forms engine removes the clinic system's code there.
    if (blankByDesign && text.trim() === "") {
      answers[field.id] = { text: "", blank: true };
      continue;
    }
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

/**
 * Every Word block an anchor writes into (10/2026): the tick boxes' blocks, the cells a mark_cell question marks, the
 * lines of a one-option-per-line delete_options list – otherwise its own block. For ordering, highlighting the
 * answer space, the merge-code checks and the load checks.
 */
export function docxAnchorBlockIds(anchor: Extract<FormField["anchor"], { kind: "docx" }>): string[] {
  if (anchor.target === "checkbox_glyph" && anchor.optionGlyphs?.length) return Array.from(new Set(anchor.optionGlyphs.map((g) => g.blockId)));
  if (anchor.target === "mark_cell" && anchor.optionCells?.length) return Array.from(new Set(anchor.optionCells.map((c) => c.blockId)));
  if (anchor.target === "delete_options" && anchor.optionTexts?.length && !anchor.placeholderText) return Array.from(new Set(anchor.optionTexts.map((o) => o.blockId)));
  return [anchor.blockId];
}

/** Where an anchor writes, as a comparable string (block / placeholder / glyphs / PDF field / box). */
export function formAnchorKey(anchor: FormField["anchor"]): string {
  switch (anchor.kind) {
    case "docx":
      if (anchor.target === "checkbox_glyph") {
        return `glyph:${(anchor.optionGlyphs ?? []).map((g) => `${g.blockId}#${g.glyphIndex}`).join(",")}`;
      }
      if (anchor.target === "mark_cell") return `cells:${(anchor.optionCells ?? []).map((c) => c.blockId).join(",")}`;
      if (anchor.target === "delete_options") {
        return anchor.placeholderText
          ? `delete:${anchor.blockId}|${anchor.placeholderText}`
          : `delete:${(anchor.optionTexts ?? []).map((o) => `${o.blockId}|${o.text}`).join(",")}`;
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
      // 10/2026: "mark the column" tables and "delete as necessary" lists.
      if (field.anchor.target === "mark_cell") {
        const cells = field.anchor.optionCells ?? [];
        if (!cells.length) problems.push(`${where}: no cells to mark are linked to this question.`);
        if (cells.some((c) => !c.option.trim() || !parseBlockId(c.blockId))) problems.push(`${where}: every cell to mark needs its option and a valid place.`);
        if (new Set(cells.map((c) => c.blockId)).size !== cells.length) problems.push(`${where}: a cell is linked to more than one option.`);
        if (field.answerType !== "yes_no" && field.answerType !== "single_choice" && field.answerType !== "checkbox" && field.answerType !== "short_text") {
          problems.push(`${where}: a marked cell answers a choice, so the answer type must be yes / no, a single choice, a tick box, or short text naming every option that applies.`);
        }
        if (field.anchor.mark !== undefined && !field.anchor.mark.trim()) problems.push(`${where}: say which mark to write.`);
      }
      if (field.anchor.target === "delete_options") {
        const list = field.anchor.placeholderText ?? "";
        const lines = field.anchor.optionTexts ?? [];
        if (!list && !lines.length) problems.push(`${where}: say where the options to keep or delete are printed.`);
        if (lines.some((o) => !o.option.trim() || !o.text.trim() || !parseBlockId(o.blockId))) problems.push(`${where}: every printed option needs its option, its text and a valid place.`);
        if (list && !(field.options ?? []).length) problems.push(`${where}: list the options printed in “${list}”.`);
        if (list && (field.options ?? []).some((o) => !list.toLowerCase().includes(o.trim().toLowerCase()))) {
          problems.push(`${where}: every option must be printed in “${list}”.`);
        }
        if (field.answerType !== "yes_no" && field.answerType !== "single_choice" && field.answerType !== "checkbox") {
          problems.push(`${where}: keeping one printed option answers a choice, so the answer type must be yes / no, a single choice or a tick box.`);
        }
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
