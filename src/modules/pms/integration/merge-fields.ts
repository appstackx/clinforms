/**
 * Template field NAMES → the clinic system's one merge-field list (K2-LTR-007). Pure.
 *
 * There is ONE list of merge fields and ONE resolver of their values: the comms module's
 * (`../comms/merge-fields.ts` – `{{patient.full_name}}` in letters and messages, values built on the server by
 * `src/server/pms/comms/letters.ts`). This file adds only what a clinic's own Word or RTF letter templates need on
 * top: those carry fields such as «PatientName», <<DOB>> or Word MERGEFIELD codes, named however their earlier system
 * named them. resolveMergeName() matches such a name to a comms field key by the key itself, its label or a common
 * alias (compared after matchKey: case, spaces, "_" and punctuation do not matter; CamelCase is split). A name that
 * matches nothing is reported, never guessed – staff can point it at a field once (`overrides`).
 *
 * applyMergeToText() fills «Name» / <<Name>> tokens from the same values a `{{…}}` letter gets.
 */
import { MERGE_FIELDS as FIELDS, mergeField, type MergeValues } from "../comms/merge-fields";
import { matchKey } from "./values";

/** The letter fields (comms keys) a clinic's template may use. */
export const LETTER_FIELD_KEYS: readonly string[] = FIELDS.filter((f) => f.contexts.includes("letter")).map((f) => f.key);

/**
 * Other names a comms field goes by in clinics' own templates (compared with matchKey). Only letter fields.
 * The design's short chips ({patient_name}, {patient_dob}, {first_visit}, {discharge_date}, {practitioner}…) are
 * aliases too.
 */
export const MERGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "patient.full_name": ["patient name", "patientname", "name", "full name", "fullname", "client name", "clientname", "patient", "claimant", "claimant name"],
  "patient.title": ["title", "patient title", "salutation title"],
  "patient.first_name": ["forename", "first name", "firstname", "patient forename", "patient first name", "given name"],
  "patient.last_name": ["surname", "last name", "lastname", "patient surname", "patient last name", "family name"],
  "patient.date_of_birth": ["dob", "date of birth", "dateofbirth", "birth date", "birthdate", "patient dob"],
  "patient.number": ["patient number", "patient no", "patientno", "patient id", "patientid", "file number", "file no", "patient ref"],
  "patient.address": ["address", "patient address", "full address", "address block"],
  "gp.name": ["gp", "gp name", "doctor", "gp doctor"],
  "gp.surgery": ["gp surgery", "surgery", "gp practice"],
  "gp.address": ["gp address", "surgery address"],
  "case.title": ["case", "case title", "condition", "complaint", "injury", "episode"],
  "case.opened_on": ["case start", "start date", "referral start", "episode start", "date opened"],
  "case.discharge_date": ["discharge date", "date discharged", "case end", "end date", "date closed"],
  "case.claim_reference": ["claim number", "claim no", "claim ref", "claim reference", "your ref", "your reference", "their ref", "instruction ref", "instruction reference", "mlc ref", "reference", "ref"],
  "case.membership_number": ["membership number", "membership no", "policy number", "policy no", "member number"],
  "case.injury_on": ["date of accident", "accident date", "doa", "date of injury", "injury date", "incident date", "date of incident"],
  "case.payer": ["payer", "insurer", "insurer name", "insurance company", "solicitor", "solicitors", "mlc", "agency", "instructing party", "bill to"],
  "case.first_visit": ["first visit", "first appointment", "first appt", "initial assessment date", "ia date", "date first seen", "first seen", "assessment date"],
  "case.last_visit": ["last visit", "last appointment", "last appt", "date last seen", "last seen", "last attended"],
  "case.sessions": ["sessions", "sessions attended", "number of sessions", "treatments", "treatment sessions"],
  "appointments.attended": ["appointments attended", "attended dates", "dates attended"],
  "appointments.upcoming": ["next appointments", "upcoming appointments", "next appointment", "next appt"],
  latest_outcomes: ["latest outcomes", "outcomes", "outcome measures", "outcome scores", "scores"],
  "author.name": ["practitioner", "therapist", "physio", "physiotherapist", "clinician", "practitioner name", "therapist name", "clinician name", "treating clinician", "author"],
  "author.profession": ["profession", "practitioner profession", "job role"],
  "author.registration": ["hcpc", "hcpc number", "hcpc no", "registration number", "registration no", "reg no"],
  "site.name": ["site", "site name", "location", "branch"],
  "clinic.name": ["clinic", "clinic name", "practice name", "company name", "our name"],
  "clinic.address": ["clinic address", "our address", "practice address"],
  "clinic.phone": ["clinic phone", "clinic telephone", "our phone", "practice phone"],
  "clinic.email": ["clinic email", "our email", "practice email"],
  "recipient.name": ["recipient", "recipient name", "addressee"],
  "recipient.address": ["recipient address", "addressee address"],
  "recipient.salutation": ["dear", "greeting", "salutation"],
  today: ["today", "date", "todays date", "today s date", "current date", "date today", "letter date"],
};

/** Every name → comms key (key, key with spaces, label and aliases, after matchKey). Earlier entries win a clash. */
const BY_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const add = (name: string, key: string) => {
    const k = matchKey(name);
    if (k && !m.has(k)) m.set(k, key);
  };
  for (const key of LETTER_FIELD_KEYS) {
    add(key, key);
    add(key.replace(/[._]/g, " "), key);
  }
  for (const [key, aliases] of Object.entries(MERGE_ALIASES)) if (LETTER_FIELD_KEYS.includes(key)) for (const a of aliases) add(a, key);
  for (const key of LETTER_FIELD_KEYS) add((mergeField(key)?.label ?? "").replace(/\s*\([^)]*\)\s*$/, ""), key);
  return m;
})();

/** Normalised name of a merge field as written in a template ("Patient_Name" → "patient name"). */
export function mergeNameKey(name: string): string {
  // CamelCase → words before matchKey ("PatientName" → "Patient Name"), keeping runs of capitals ("DOB").
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return matchKey(spaced);
}

/** The comms field key a template's merge name means, or null. `overrides`: staff's own choices (normalised name → key). */
export function resolveMergeName(name: string, overrides: Readonly<Record<string, string>> = {}): string | null {
  const k = mergeNameKey(name);
  const compact = matchKey(name);
  const chosen = overrides[k] ?? overrides[compact];
  if (chosen) return LETTER_FIELD_KEYS.includes(chosen) ? chosen : null;
  return BY_NAME.get(k) ?? BY_NAME.get(compact) ?? BY_NAME.get(compact.replace(/ /g, "")) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Templates: finding and filling the fields
 * ----------------------------------------------------------------------------------------------*/

/** Typed merge fields in text: «Name» or <<Name>> – the same shape the ClinForms engine detects (core/merge-fields.ts). */
export const TYPED_MERGE_TOKEN = /«([A-Za-z][A-Za-z0-9 _.\-/]{0,39})»|<<([A-Za-z][A-Za-z0-9 _.\-/]{0,39})>>/g;

export interface MergeReport {
  /** Each distinct field name found, with what it was matched to (null = not recognised). */
  fields: { name: string; key: string | null; count: number; filled: boolean }[];
}

/** Adds one field use to a report. */
export function noteMergeUse(report: MergeReport, name: string, key: string | null, filled: boolean): void {
  const found = report.fields.find((f) => f.name === name);
  if (found) {
    found.count += 1;
    found.filled = found.filled && filled;
  } else {
    report.fields.push({ name, key, count: 1, filled });
  }
}

/**
 * Replaces the typed merge fields in a piece of text with their values (the comms letter values). Unrecognised
 * names are kept as they are (the report lists them); recognised ones with no value become "" (listed as not filled).
 */
export function applyMergeToText(text: string, values: MergeValues, report: MergeReport, overrides: Readonly<Record<string, string>> = {}): string {
  return text.replace(TYPED_MERGE_TOKEN, (whole, a: string | undefined, b: string | undefined) => {
    const name = (a ?? b ?? "").trim();
    const key = resolveMergeName(name, overrides);
    if (!key) {
      noteMergeUse(report, name, null, false);
      return whole;
    }
    const raw = values[key];
    const value = typeof raw === "string" ? raw : "";
    noteMergeUse(report, name, key, value.trim() !== "");
    return value;
  });
}

/** Whether a merge report leaves anything for staff to look at. */
export function mergeReportProblems(report: MergeReport): { unknown: string[]; empty: string[] } {
  return {
    unknown: report.fields.filter((f) => f.key === null).map((f) => f.name),
    empty: report.fields.filter((f) => f.key !== null && !f.filled).map((f) => f.name),
  };
}
