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
 * W0.4 module split (bh2): most of the answer and record code now lives in core/forms/*, re-exported here so every
 * existing import keeps working –
 *   forms/fields.ts        fields → sections, how an answer is stored   (shared)
 *   forms/guidance.ts      fieldGuidance   (owner WE)
 *   forms/headings.ts      sectionHeadings   (WE)
 *   forms/record-paths.ts  values filled by code from the record, recordSourceOf   (WE)
 *   forms/answers.ts       printed options, structured answers, answer text, left blank, buildFormAnswers   (WA1)
 *   forms/answer-shape.ts  compactPlace (where a drafted answer goes)   (WD)
 * This file keeps the form ↔ template identity, attestations, scope, referrer names, formToTemplate, reportKindOf,
 * block IDs, answer-space keys and checkFormDefinition (owner: integrator). Owners: docs/bh2-ownership.json.
 *
 * Owner: ai agent (contract-stage baseline; exported signatures are contract).
 */
import { isNonClinicParty, partyLabel, prefillSigners, prefillSignersText } from "./parties";
import { ANSWER_TYPE_LABELS, FORM_KIND_LABELS } from "./labels";
import { isTableAnchor } from "./form-tables";
import { isQuestionAnchor, isQuestionSet } from "./question-set";
import { answerKindFor, answerableFields, isAnswerableField, sectionKindForFillSource } from "./forms/fields";
import { fieldGuidance } from "./forms/guidance";
import { parseFormAnswerValue } from "./forms/answers";
import type { FormDefinition, FormField, InstructingParty, ReferrerType, Report, ReportFormRef, ReportTemplate, TemplateScope, TemplateSection } from "./types";

// bh2-base2 (W0 follow-up): whole-module re-exports of the split files, so a workstream changes its own file's exports
// without editing this barrel.
export * from "./forms/fields";
export * from "./forms/guidance";
export * from "./forms/headings";
export * from "./forms/record-paths";
export * from "./forms/answers";

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
