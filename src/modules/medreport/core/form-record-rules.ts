/**
 * Record values on a referrer's form that need a rule, not just a lookup (used by
 * core/report-factory.ts createFormReport and the review screen). Pure; browser and server.
 *
 * - Fixed answers (fill source "fixed"): the same answer for every patient, set once in the form map by
 *   staff ("Physiotherapist", "United Kingdom"). Filled by code; a value that does not fit the question
 *   (a choice that is not printed, "maybe" for a Yes/No) is left blank with a gap – never guessed.
 * - Insurer identifiers (referral.membershipNumber / referral.authorisationNumber) belong to the
 *   patient's insurer on record. They are copied only onto a form issued by that insurer
 *   (referrerNamesMatch with insurerNameOnRecord); on any other organisation's form they are left blank
 *   for staff with a "-referrer" gap, and the review offers "Use the referral's reference" for the case
 *   where the form does belong to that insurer under another name.
 * - The referral party's own reference or name on a form from ANOTHER organisation of the SAME kind
 *   (one insurer's reference on a different insurer's form): the generic words that point at the
 *   referral party ("policy", "insurer", "client"…) describe the form's own issuer just as well, so only
 *   an explicit pointer – "instructing …" or the referral party's own name – lets code copy it.
 *
 * Owner: S4 (PMI data) – additive; keeps createFormReport's own changes to a few lines.
 */
import { ANSWER_TYPE_LABELS } from "./labels";
import {
  answerKindFor,
  asksForReferralPartyReference,
  distinctiveTokens,
  insurerNameOnRecord,
  parseFormAnswerValue,
  referrerNamesMatch,
  type ResolvedFormValue,
} from "./forms";
import type { EpisodeBundle, FormField, Gap, InstructingParty, ReferrerInfo, RegistrationPath, Report } from "./types";

/* ------------------------------------------------------------------------------------------------
 * Fixed answers
 * ----------------------------------------------------------------------------------------------*/

/**
 * The value a "fixed" fill source writes, shaped like a registration value so createFormReport treats
 * both alike (no source IDs: it comes from the form map, not the record). Null when no answer is set.
 * A structured answer that does not fit the question keeps its text but has value "", so toFormAnswer
 * leaves it blank (the caller raises fixedValueGap).
 */
export function resolveFixedValue(field: Pick<FormField, "answerType" | "options">, value: string): ResolvedFormValue | null {
  const text = value.trim();
  if (!text) return null;
  const kind = answerKindFor(field.answerType);
  if (kind === "text") return { text, value: text, sourceIds: [] };
  const parsed = parseFormAnswerValue(field, text);
  if (parsed.value === null || parsed.value === "") return { text, value: "", sourceIds: [] };
  if (typeof parsed.value === "boolean") return { text: parsed.value ? "Yes" : "No", value: parsed.value, sourceIds: [] };
  return { text, value: parsed.value, sourceIds: [] };
}

/** Gap for a fixed answer that is missing or does not fit the question. */
export function fixedValueGap(field: Pick<FormField, "id" | "label" | "answerType" | "options">, value: string): Gap {
  const text = value.trim();
  const type = ANSWER_TYPE_LABELS[field.answerType].toLowerCase();
  const options = field.options?.length ? ` The form's options are: ${field.options.join(", ")}.` : "";
  return {
    id: `gap-${field.id}-fixed`,
    sectionKey: field.id,
    issue: text
      ? `The fixed answer set for “${field.label}” in the form map (“${text}”) does not fit this ${type} question, so it has been left blank.${options}`
      : `No fixed answer is set for “${field.label}” in the form map, so it has been left blank.`,
    suggestedQuestion: `What should be entered for “${field.label}”? Correct the fixed answer in the form map so it applies to every patient.`,
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

/* ------------------------------------------------------------------------------------------------
 * Insurer identifiers
 * ----------------------------------------------------------------------------------------------*/

export const INSURER_IDENTIFIER_PATHS = ["referral.membershipNumber", "referral.authorisationNumber"] as const;
export type InsurerIdentifierPath = (typeof INSURER_IDENTIFIER_PATHS)[number];

export function isInsurerIdentifierPath(path: RegistrationPath): path is InsurerIdentifierPath {
  return (INSURER_IDENTIFIER_PATHS as ReadonlyArray<RegistrationPath>).indexOf(path) >= 0;
}

const IDENTIFIER_WORDS: Record<InsurerIdentifierPath, string> = {
  "referral.membershipNumber": "membership number",
  "referral.authorisationNumber": "authorisation number",
};

/** The record's value for an insurer identifier (trimmed), or null. */
export function insurerIdentifierOnRecord(bundle: Pick<EpisodeBundle, "referral">, path: InsurerIdentifierPath): string | null {
  const raw = path === "referral.membershipNumber" ? bundle.referral.membershipNumber : bundle.referral.authorisationNumber;
  return raw?.trim() || null;
}

/**
 * True when the record holds this insurer identifier but the form is NOT from the patient's insurer on
 * record (or the record does not say which insurer issued it): code leaves it blank for staff.
 */
export function isInsurerIdentifierWithheld(formReferrerName: string, bundle: Pick<EpisodeBundle, "referral">, path: RegistrationPath): boolean {
  if (!isInsurerIdentifierPath(path) || !insurerIdentifierOnRecord(bundle, path)) return false;
  const insurer = insurerNameOnRecord(bundle);
  return !(insurer && referrerNamesMatch(formReferrerName, insurer));
}

/**
 * Whether code must leave an insurer identifier blank on this form (isInsurerIdentifierWithheld), with
 * the gap to raise when the question is required. Null when the identifier may be copied, when the path
 * is not an insurer identifier, or when the record holds no value (the usual "not in the record" gap
 * applies then).
 */
export function withheldInsurerIdentifier(input: {
  form: { referrer: Pick<ReferrerInfo, "name"> };
  field: Pick<FormField, "id" | "label">;
  path: RegistrationPath;
  bundle: Pick<EpisodeBundle, "referral">;
}): { gap: Gap } | null {
  const { form, field, path, bundle } = input;
  if (!isInsurerIdentifierPath(path) || !isInsurerIdentifierWithheld(form.referrer.name, bundle, path)) return null;
  const value = insurerIdentifierOnRecord(bundle, path) as string;
  const insurer = insurerNameOnRecord(bundle);
  const what = IDENTIFIER_WORDS[path];
  const formFrom = form.referrer.name;
  return {
    gap: {
      // "-referrer": the review shows the referrer box and offers "Use the referral's reference".
      id: `gap-${field.id}-referrer`,
      sectionKey: field.id,
      issue: insurer
        ? `This form is from ${formFrom}, but the ${what} on the clinic record (“${value}”) is ${insurer}'s, so it has not been copied into “${field.label}”.`
        : `The clinic record holds a ${what} (“${value}”) but does not say which insurer issued it, so it has not been copied onto ${formFrom}'s form.`,
      suggestedQuestion: insurer
        ? `What is the patient's ${formFrom} ${what}? If this form is in fact for ${insurer}, use “${value}”.`
        : `Is “${value}” the patient's ${formFrom} ${what}? If so, use it; otherwise enter ${formFrom}'s own.`,
      relatedNoteIds: [],
      raisedBy: "system",
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The referral party's own reference on another organisation's form
 * ----------------------------------------------------------------------------------------------*/

function mentionsToken(text: string, tokens: string[]): boolean {
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

/**
 * Whether code may copy the referral party's reference (or name) into a question on a form from a
 * DIFFERENT organisation: asksForReferralPartyReference(), and – when the form's issuer is the same kind
 * of organisation as the referral party – an explicit pointer at the referral party ("instructing …" or
 * its own name), because the generic words for that kind ("policy", "insurer") then fit the form's own
 * issuer too. A Bupa referral's reference is never copied into another insurer's "Policy number".
 */
export function mayCopyReferralPartyReference(
  field: Pick<FormField, "label" | "guidance">,
  party: Pick<InstructingParty, "name" | "type">,
  formReferrer: Pick<ReferrerInfo, "name" | "type">,
): boolean {
  if (!asksForReferralPartyReference(field, party, formReferrer.name)) return false;
  if (formReferrer.type !== party.type) return true;
  const text = `${field.label} ${field.guidance}`.toLowerCase();
  return /\binstruct(?:ing|ed|ion|ions)\b/.test(text) || mentionsToken(text, distinctiveTokens(party.name));
}

/* ------------------------------------------------------------------------------------------------
 * Review: which questions get the "referrer's own reference" treatment, and the record's value
 * ----------------------------------------------------------------------------------------------*/

/** Registration paths whose value belongs to the referral party or the patient's insurer. */
export function isReferralIdentifierPath(path: RegistrationPath): boolean {
  return path === "referral.reference" || path === "referral.referrerName" || isInsurerIdentifierPath(path);
}

/**
 * Whether the review shows the "uses its own reference" notice on an unanswered question: always for the
 * referral's reference and name (as before), and for an insurer identifier only when code withheld it
 * (a Bupa form whose record lacks the number gets the ordinary "not in the record" text instead).
 */
export function showsReferrerReferenceNotice(
  path: RegistrationPath,
  formReferrerName: string | null,
  bundle: Pick<EpisodeBundle, "referral"> | null | undefined,
): boolean {
  if (path === "referral.reference" || path === "referral.referrerName") return true;
  return Boolean(formReferrerName && bundle && isInsurerIdentifierWithheld(formReferrerName, bundle, path));
}

/** The record's value for such a path, offered by the review as "Use the referral's reference". */
export function referralValueForPath(
  path: RegistrationPath,
  report: Pick<Report, "instructingParty"> & { bundleSnapshot?: Pick<EpisodeBundle, "referral"> | null },
): string | null {
  switch (path) {
    case "referral.reference":
      return report.instructingParty.reference ?? null;
    case "referral.referrerName":
      return report.instructingParty.name;
    case "referral.membershipNumber":
      return report.bundleSnapshot?.referral.membershipNumber?.trim() || null;
    case "referral.authorisationNumber":
      return report.bundleSnapshot?.referral.authorisationNumber?.trim() || null;
    default:
      return null;
  }
}
