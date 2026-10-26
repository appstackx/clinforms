/**
 * Mail-merge fields for letters filled from the clinic system: the patient, the case and its payer, the treating
 * practitioner, appointments, invoices, the clinic and today's date. Pure.
 *
 * A clinic's letter templates (Word or RTF) carry fields such as «PatientName», <<DOB>> or Word MERGEFIELD codes,
 * named however their earlier system named them. resolveMergeName() matches a name to a field here by its key, its
 * label or a common alias (compared after matchKey: case, spaces, "_" and punctuation do not matter). A name that
 * matches nothing is reported, never guessed – staff can point it at a field once (`overrides`).
 *
 * Values are plain text in UK formats (DD/MM/YYYY, £1,234.50). An empty value is written as nothing and reported,
 * so a letter is never sent with a field silently left out.
 */
import { formatPence, formatUkDate, yearsBetween } from "../core/text";
import { matchKey } from "./values";

export const MERGE_GROUPS = ["patient", "case", "payer", "practitioner", "appointments", "invoices", "clinic", "today"] as const;
export type MergeGroup = (typeof MERGE_GROUPS)[number];

export const MERGE_GROUP_LABELS: Readonly<Record<MergeGroup, string>> = {
  patient: "Patient",
  case: "Case",
  payer: "Payer or referrer",
  practitioner: "Practitioner",
  appointments: "Appointments",
  invoices: "Invoices",
  clinic: "Clinic and site",
  today: "Today",
};

export interface MergeFieldDef {
  key: string;
  label: string;
  group: MergeGroup;
  /** Other names the field goes by in templates (lower case is fine: compared with matchKey). */
  aliases: readonly string[];
}

const F = (group: MergeGroup, key: string, label: string, aliases: string[] = []): MergeFieldDef => ({ group, key, label, aliases });

export const MERGE_FIELDS: readonly MergeFieldDef[] = [
  F("patient", "patient.fullName", "Patient's full name", ["patient name", "patientname", "name", "full name", "fullname", "client name", "clientname", "patient", "claimant", "claimant name"]),
  F("patient", "patient.title", "Title", ["title", "patient title", "salutation title"]),
  F("patient", "patient.firstName", "First name", ["forename", "first name", "firstname", "patient forename", "patient first name", "given name"]),
  F("patient", "patient.lastName", "Last name", ["surname", "last name", "lastname", "patient surname", "patient last name", "family name"]),
  F("patient", "patient.formalName", "Title and last name (Mrs Hart)", ["formal name", "title surname", "title and surname"]),
  F("patient", "patient.salutation", "Salutation (Dear Mrs Hart)", ["salutation", "dear", "greeting"]),
  F("patient", "patient.dateOfBirth", "Date of birth", ["dob", "date of birth", "dateofbirth", "birth date", "birthdate", "patient dob"]),
  F("patient", "patient.age", "Age", ["age", "patient age"]),
  F("patient", "patient.number", "Patient number", ["patient number", "patient no", "patientno", "patient id", "patientid", "file number", "file no", "patient ref"]),
  F("patient", "patient.address", "Address (one line)", ["address", "patient address", "full address", "address block"]),
  F("patient", "patient.address1", "Address line 1", ["address1", "address 1", "address line 1", "street"]),
  F("patient", "patient.address2", "Address line 2", ["address2", "address 2", "address line 2"]),
  F("patient", "patient.address3", "Address line 3", ["address3", "address 3", "address line 3", "town", "city"]),
  F("patient", "patient.postcode", "Postcode", ["postcode", "post code", "patient postcode"]),
  F("patient", "patient.phone", "Phone", ["phone", "telephone", "tel", "mobile", "phone number", "contact number"]),
  F("patient", "patient.email", "Email", ["email", "email address", "e mail"]),
  F("patient", "patient.occupation", "Occupation", ["occupation", "job", "job title"]),
  F("patient", "patient.employer", "Employer", ["employer", "employer name"]),
  F("patient", "patient.gpName", "GP", ["gp", "gp name", "doctor", "gp doctor"]),
  F("patient", "patient.gpPractice", "GP surgery", ["gp surgery", "surgery", "gp practice"]),
  F("case", "case.title", "Case", ["case", "case title", "condition", "complaint", "injury", "episode"]),
  F("case", "case.openedOn", "Case start date", ["case start", "start date", "referral start", "episode start", "date opened"]),
  F("case", "case.closedOn", "Discharge date", ["discharge date", "date discharged", "case end", "end date", "date closed"]),
  F("case", "case.status", "Case status", ["case status", "status"]),
  F("case", "case.claimReference", "Claim or instruction reference", ["claim number", "claim no", "claim ref", "claim reference", "your ref", "your reference", "their ref", "instruction ref", "instruction reference", "mlc ref", "reference", "ref"]),
  F("case", "case.membershipNumber", "Membership or policy number", ["membership number", "membership no", "policy number", "policy no", "member number"]),
  F("case", "case.injuryOn", "Date of injury or accident", ["date of accident", "accident date", "doa", "date of injury", "injury date", "incident date", "date of incident"]),
  F("case", "case.referralReceivedOn", "Referral received", ["referral date", "date referred", "referral received"]),
  F("case", "case.authorisationCode", "Authorisation code", ["authorisation code", "authorisation", "auth code", "authcode", "preauth", "authorization code"]),
  F("case", "case.sessionsAuthorised", "Sessions authorised", ["sessions authorised", "authorised sessions", "sessions authorized"]),
  F("case", "case.sessionsUsed", "Sessions used", ["sessions used"]),
  F("case", "case.sessionsRemaining", "Sessions remaining", ["sessions remaining", "sessions left", "remaining sessions"]),
  F("case", "case.authorisationExpiresOn", "Authorisation expiry", ["authorisation expiry", "auth expiry", "expiry date"]),
  F("payer", "payer.name", "Payer (insurer, medico-legal company, solicitor, employer)", ["payer", "insurer", "insurer name", "insurance company", "solicitor", "solicitors", "mlc", "agency", "company", "instructing party", "instructing party name", "account name", "bill to"]),
  F("payer", "payer.contactName", "Payer's contact", ["payer contact", "contact", "contact name", "fao", "for the attention of", "case handler", "handler"]),
  F("payer", "payer.address", "Payer's address (one line)", ["payer address", "insurer address", "solicitor address", "company address", "recipient address"]),
  F("payer", "payer.email", "Payer's email", ["payer email", "insurer email", "solicitor email"]),
  F("payer", "payer.phone", "Payer's phone", ["payer phone", "insurer phone", "solicitor phone"]),
  F("payer", "referrer.name", "Referred by", ["referrer", "referred by", "referrer name", "referring doctor", "referring gp", "referring clinician"]),
  F("practitioner", "practitioner.name", "Treating practitioner", ["practitioner", "therapist", "physio", "physiotherapist", "clinician", "practitioner name", "therapist name", "clinician name", "treating clinician", "treating physiotherapist"]),
  F("practitioner", "practitioner.registrationNumber", "Registration number", ["hcpc", "hcpc number", "hcpc no", "registration number", "registration no", "reg no"]),
  F("practitioner", "practitioner.profession", "Profession", ["profession", "practitioner profession", "job role"]),
  F("appointments", "appointments.firstDate", "First appointment", ["first appointment", "first appt", "initial assessment date", "ia date", "date first seen", "first seen", "assessment date"]),
  F("appointments", "appointments.lastDate", "Last appointment attended", ["last appointment", "last appt", "date last seen", "last seen", "last attended"]),
  F("appointments", "appointments.nextDate", "Next appointment date", ["next appointment", "next appt", "next appointment date", "next appt date"]),
  F("appointments", "appointments.nextTime", "Next appointment time", ["next appointment time", "next appt time", "appointment time"]),
  F("appointments", "appointments.nextSite", "Next appointment site", ["next appointment site", "next appointment location", "appointment location"]),
  F("appointments", "appointments.attended", "Appointments attended", ["sessions attended", "appointments attended", "number of sessions", "treatments", "treatment sessions", "attended"]),
  F("appointments", "appointments.didNotAttend", "Did not attend", ["dnas", "dna", "did not attend", "missed appointments"]),
  F("invoices", "invoices.latestNumber", "Latest invoice number", ["invoice number", "invoice no", "invoiceno", "invoice"]),
  F("invoices", "invoices.latestDate", "Latest invoice date", ["invoice date"]),
  F("invoices", "invoices.latestTotal", "Latest invoice total", ["invoice total", "invoice amount", "amount"]),
  F("invoices", "invoices.balance", "Balance owed", ["balance", "outstanding", "amount due", "balance due", "amount owed", "outstanding balance"]),
  F("clinic", "clinic.name", "Clinic name", ["clinic", "clinic name", "practice name", "company name", "our name"]),
  F("clinic", "clinic.address", "Clinic address (one line)", ["clinic address", "our address", "practice address"]),
  F("clinic", "clinic.phone", "Clinic phone", ["clinic phone", "clinic telephone", "our phone", "practice phone"]),
  F("clinic", "clinic.email", "Clinic email", ["clinic email", "our email", "practice email"]),
  F("clinic", "site.name", "Site", ["site", "site name", "location", "branch"]),
  F("clinic", "site.address", "Site address (one line)", ["site address", "location address", "branch address"]),
  F("clinic", "site.phone", "Site phone", ["site phone", "branch phone"]),
  F("today", "today.date", "Today's date (DD/MM/YYYY)", ["today", "date", "todays date", "today s date", "current date", "date today", "letter date"]),
  F("today", "today.long", "Today's date (24 October 2026)", ["today long", "long date", "date long"]),
];

const BY_KEY = new Map(MERGE_FIELDS.map((f) => [f.key, f]));

/** Every name → field key (key, label and aliases, after matchKey). Earlier definitions win a clash. */
const BY_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const add = (name: string, key: string) => {
    const k = matchKey(name);
    if (k && !m.has(k)) m.set(k, key);
  };
  for (const f of MERGE_FIELDS) {
    add(f.key, f.key);
    add(f.key.replace(".", " "), f.key);
  }
  for (const f of MERGE_FIELDS) add(f.label.replace(/\s*\([^)]*\)\s*$/, ""), f.key);
  for (const f of MERGE_FIELDS) for (const a of f.aliases) add(a, f.key);
  return m;
})();

/** Normalised name of a merge field as written in a template ("Patient_Name" → "patient name"). */
export function mergeNameKey(name: string): string {
  // CamelCase → words before matchKey ("PatientName" → "Patient Name"), keeping runs of capitals ("DOB").
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return matchKey(spaced);
}

/** The field a template's merge name means, or null. `overrides`: staff's own choices (normalised name → key). */
export function resolveMergeName(name: string, overrides: Readonly<Record<string, string>> = {}): string | null {
  const k = mergeNameKey(name);
  const compact = matchKey(name);
  const chosen = overrides[k] ?? overrides[compact];
  if (chosen && BY_KEY.has(chosen)) return chosen;
  return BY_NAME.get(k) ?? BY_NAME.get(compact) ?? BY_NAME.get(compact.replace(/ /g, "")) ?? null;
}

export function mergeField(key: string): MergeFieldDef | undefined {
  return BY_KEY.get(key);
}

/* ------------------------------------------------------------------------------------------------
 * Values
 * ----------------------------------------------------------------------------------------------*/

export interface MergeAddress {
  lines: readonly string[] | null;
  postcode: string | null;
}

/** What the server reads for one letter (every part optional: a letter about the patient only needs the patient). */
export interface MergeData {
  /** "YYYY-MM-DD" (UK). */
  today: string;
  clinic: { name: string; address: MergeAddress; phone: string | null; email: string | null } | null;
  site: { name: string; address: MergeAddress; phone: string | null } | null;
  patient: {
    patientNumber: number;
    title: string | null;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    address: MergeAddress;
    phoneMobile: string | null;
    phoneHome: string | null;
    email: string | null;
    occupation: string | null;
    employer: string | null;
    gpName: string | null;
    gpPractice: string | null;
  } | null;
  case: {
    title: string;
    openedOn: string;
    closedOn: string | null;
    status: string;
    claimReference: string | null;
    membershipNumber: string | null;
    injuryOn: string | null;
    referralReceivedOn: string | null;
  } | null;
  authorisation: { code: string; sessionsAuthorised: number | null; sessionsUsed: number; expiresOn: string | null } | null;
  payer: { name: string; contactName: string | null; address: MergeAddress; email: string | null; phone: string | null } | null;
  referrer: { name: string } | null;
  practitioner: { name: string; registrationNumber: string | null; profession: string | null } | null;
  appointments: { firstDate: string | null; lastAttendedDate: string | null; next: { date: string; time: string; site: string | null } | null; attended: number; didNotAttend: number } | null;
  invoices: { latest: { number: string; issuedOn: string; totalPence: number } | null; balancePence: number } | null;
}

const PROFESSION_LABELS: Record<string, string> = {
  physiotherapist: "Physiotherapist",
  sports_therapist: "Sports therapist",
  osteopath: "Osteopath",
  chiropractor: "Chiropractor",
  podiatrist: "Podiatrist",
  massage_therapist: "Massage therapist",
  other: "Practitioner",
};

const CASE_STATUS_LABELS: Record<string, string> = { open: "Open", discharged: "Discharged", closed: "Closed" };

function oneLine(a: MergeAddress | null | undefined): string {
  if (!a) return "";
  return [...(a.lines ?? []), a.postcode ?? ""].map((l) => l.trim()).filter(Boolean).join(", ");
}

function line(a: MergeAddress, i: number): string {
  return a.lines?.[i] ?? "";
}

/** "2026-10-24" → "24 October 2026". */
export function longUkDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return Number.isFinite(y) && m >= 1 && m <= 12 ? `${d} ${months[m - 1]} ${y}` : "";
}

/** Every field's value for one letter ("" where the record holds nothing). */
export function buildMergeValues(data: MergeData): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of MERGE_FIELDS) v[f.key] = "";
  v["today.date"] = formatUkDate(data.today);
  v["today.long"] = longUkDate(data.today);
  const p = data.patient;
  if (p) {
    v["patient.fullName"] = [p.firstName, p.lastName].join(" ");
    v["patient.title"] = p.title ?? "";
    v["patient.firstName"] = p.firstName;
    v["patient.lastName"] = p.lastName;
    v["patient.formalName"] = p.title ? `${p.title} ${p.lastName}` : `${p.firstName} ${p.lastName}`;
    v["patient.salutation"] = `Dear ${v["patient.formalName"]}`;
    v["patient.dateOfBirth"] = formatUkDate(p.dateOfBirth);
    v["patient.age"] = p.dateOfBirth ? String(yearsBetween(p.dateOfBirth, data.today)) : "";
    v["patient.number"] = String(p.patientNumber);
    v["patient.address"] = oneLine(p.address);
    v["patient.address1"] = line(p.address, 0);
    v["patient.address2"] = line(p.address, 1);
    v["patient.address3"] = (p.address.lines ?? []).slice(2).join(", ");
    v["patient.postcode"] = p.address.postcode ?? "";
    v["patient.phone"] = p.phoneMobile ?? p.phoneHome ?? "";
    v["patient.email"] = p.email ?? "";
    v["patient.occupation"] = p.occupation ?? "";
    v["patient.employer"] = p.employer ?? "";
    v["patient.gpName"] = p.gpName ?? "";
    v["patient.gpPractice"] = p.gpPractice ?? "";
  }
  const c = data.case;
  if (c) {
    v["case.title"] = c.title;
    v["case.openedOn"] = formatUkDate(c.openedOn);
    v["case.closedOn"] = formatUkDate(c.closedOn);
    v["case.status"] = CASE_STATUS_LABELS[c.status] ?? c.status;
    v["case.claimReference"] = c.claimReference ?? "";
    v["case.membershipNumber"] = c.membershipNumber ?? "";
    v["case.injuryOn"] = formatUkDate(c.injuryOn);
    v["case.referralReceivedOn"] = formatUkDate(c.referralReceivedOn);
  }
  const a = data.authorisation;
  if (a) {
    v["case.authorisationCode"] = a.code;
    v["case.sessionsAuthorised"] = a.sessionsAuthorised === null ? "" : String(a.sessionsAuthorised);
    v["case.sessionsUsed"] = String(a.sessionsUsed);
    v["case.sessionsRemaining"] = a.sessionsAuthorised === null ? "" : String(Math.max(0, a.sessionsAuthorised - a.sessionsUsed));
    v["case.authorisationExpiresOn"] = formatUkDate(a.expiresOn);
  }
  if (data.payer) {
    v["payer.name"] = data.payer.name;
    v["payer.contactName"] = data.payer.contactName ?? "";
    v["payer.address"] = oneLine(data.payer.address);
    v["payer.email"] = data.payer.email ?? "";
    v["payer.phone"] = data.payer.phone ?? "";
  }
  if (data.referrer) v["referrer.name"] = data.referrer.name;
  if (data.practitioner) {
    v["practitioner.name"] = data.practitioner.name;
    v["practitioner.registrationNumber"] = data.practitioner.registrationNumber ?? "";
    v["practitioner.profession"] = data.practitioner.profession ? (PROFESSION_LABELS[data.practitioner.profession] ?? "") : "";
  }
  const ap = data.appointments;
  if (ap) {
    v["appointments.firstDate"] = formatUkDate(ap.firstDate);
    v["appointments.lastDate"] = formatUkDate(ap.lastAttendedDate);
    v["appointments.nextDate"] = ap.next ? formatUkDate(ap.next.date) : "";
    v["appointments.nextTime"] = ap.next?.time ?? "";
    v["appointments.nextSite"] = ap.next?.site ?? "";
    v["appointments.attended"] = String(ap.attended);
    v["appointments.didNotAttend"] = String(ap.didNotAttend);
  }
  const inv = data.invoices;
  if (inv) {
    v["invoices.latestNumber"] = inv.latest?.number ?? "";
    v["invoices.latestDate"] = inv.latest ? formatUkDate(inv.latest.issuedOn) : "";
    v["invoices.latestTotal"] = inv.latest ? formatPence(inv.latest.totalPence) : "";
    v["invoices.balance"] = formatPence(inv.balancePence);
  }
  if (data.clinic) {
    v["clinic.name"] = data.clinic.name;
    v["clinic.address"] = oneLine(data.clinic.address);
    v["clinic.phone"] = data.clinic.phone ?? "";
    v["clinic.email"] = data.clinic.email ?? "";
  }
  if (data.site) {
    v["site.name"] = data.site.name;
    v["site.address"] = oneLine(data.site.address);
    v["site.phone"] = data.site.phone ?? "";
  }
  return v;
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
 * Replaces the typed merge fields in a piece of text with their values. Unrecognised names are kept as they are
 * (the report lists them); recognised ones with no value become "" (listed as not filled).
 */
export function applyMergeToText(text: string, values: Readonly<Record<string, string>>, report: MergeReport, overrides: Readonly<Record<string, string>> = {}): string {
  return text.replace(TYPED_MERGE_TOKEN, (whole, a: string | undefined, b: string | undefined) => {
    const name = (a ?? b ?? "").trim();
    const key = resolveMergeName(name, overrides);
    if (!key) {
      noteMergeUse(report, name, null, false);
      return whole;
    }
    const value = values[key] ?? "";
    noteMergeUse(report, name, key, value !== "");
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
