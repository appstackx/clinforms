/**
 * What can be imported, field by field: patients, cases (episodes of care with their payer), appointments (past and
 * future) and invoices (with what is paid and what is still owed). Pure.
 *
 * ASSUMPTIONS (documented in docs/clinic-system/integration.md): there is no published file layout for the export
 * of an earlier clinic system, so nothing here depends on one. Each field lists column names commonly seen in
 * clinic-software exports ("Forename", "Surname", "DOB", "Postcode"…) only to SUGGEST a match; staff confirm or
 * change every match in the mapping step, and any column can be chosen for any field. Our own CSV templates
 * (import page → "Download a template") use each field's label (templateHeader) and always match exactly.
 */

export const IMPORT_KINDS = ["patients", "cases", "appointments", "invoices"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportFieldType = "text" | "longtext" | "date" | "time" | "money" | "yesno" | "sex" | "email" | "phone" | "postcode" | "int" | "enum";

export interface ImportField {
  key: string;
  label: string;
  type: ImportFieldType;
  /** The row cannot be imported without it (a "one of" group may stand in – see `requiredGroup`). */
  required?: boolean;
  /** Fields of which at least one must be mapped (e.g. a full name OR first and last name). */
  requiredGroup?: string;
  /** Header names that suggest this field (compared after matchKey: lower case, letters and digits). */
  synonyms: readonly string[];
  hint?: string;
  /** Free text that may hold health or personal detail: encrypted when it is stored. */
  sensitive?: boolean;
  /** For "text"/"longtext": the longest value kept (longer values are shortened, with a warning). */
  max?: number;
}

export interface ImportKindInfo {
  kind: ImportKind;
  label: string;
  /** "patients" (lower case, plural) for sentences. */
  noun: string;
  description: string;
  /** Kinds whose records must be imported first (rows refer to them by the earlier system's reference). */
  dependsOn: readonly ImportKind[];
  fields: readonly ImportField[];
}

const PATIENT_REF: ImportField = {
  key: "patientRef",
  label: "Patient reference",
  type: "text",
  required: true,
  synonyms: ["patient id", "patient ref", "patient reference", "patient no", "patient number", "client id", "client no", "patient"],
  hint: "The patient's number or id in the earlier system – the same value as in the patients file.",
  max: 80,
};
const CASE_REF: ImportField = {
  key: "caseRef",
  label: "Case reference",
  type: "text",
  synonyms: ["case id", "case ref", "case reference", "case no", "case number", "episode id", "episode ref", "episode no", "referral id"],
  hint: "Links the row to a case imported earlier (optional).",
  max: 80,
};
const PRACTITIONER: ImportField = {
  key: "practitionerName",
  label: "Practitioner",
  type: "text",
  synonyms: ["practitioner", "clinician", "therapist", "physio", "physiotherapist", "treating clinician", "diary", "with", "practitioner name"],
  hint: "Matched to the clinic's practitioners by name or registration number.",
  max: 120,
};
const SITE: ImportField = {
  key: "siteName",
  label: "Site",
  type: "text",
  synonyms: ["site", "clinic", "location", "branch", "site name", "clinic name"],
  hint: "Matched to the clinic's sites by name or short code.",
  max: 120,
};
const PAYER_TYPE: ImportField = {
  key: "payerType",
  label: "Who pays",
  type: "enum",
  synonyms: ["payer type", "funding", "funding type", "billing type", "account type", "case type", "payment type"],
  hint: "Self-pay, insurance, medico-legal, solicitor, employer or other. Left blank: worked out from the payer.",
};
const PAYER_NAME: ImportField = {
  key: "payerName",
  label: "Payer (insurer, medico-legal company, solicitor, employer)",
  type: "text",
  synonyms: ["insurer", "payer", "insurance company", "insurance", "account", "bill to", "funder", "debtor", "payer name", "insurer name"],
  hint: "Matched to the clinic's referrers and payers by name; a name not found is added to the directory.",
  max: 160,
};

const PATIENT_FIELDS: readonly ImportField[] = [
  { key: "ref", label: "Patient reference", type: "text", required: true, synonyms: ["patient id", "patient no", "patient number", "patient ref", "patient reference", "client id", "client no", "id", "ref", "reference", "account number", "account no", "legacy id", "previous system id", "old id", "external id"], hint: "The patient's number or id in the earlier system. Kept on the record and used to link cases, appointments and invoices.", max: 80 },
  { key: "title", label: "Title", type: "text", synonyms: ["title", "salutation"], max: 20 },
  { key: "firstName", label: "First name", type: "text", requiredGroup: "name", synonyms: ["first name", "forename", "forenames", "given name", "given names", "first"], max: 80 },
  { key: "lastName", label: "Last name", type: "text", requiredGroup: "name", synonyms: ["last name", "surname", "family name", "last"], max: 80 },
  { key: "fullName", label: "Full name (when there is one name column)", type: "text", requiredGroup: "name", synonyms: ["name", "full name", "patient name", "client name"], hint: "\"Megan Hart\" or \"Hart, Megan\" – split into first and last name.", max: 160 },
  { key: "preferredName", label: "Preferred name", type: "text", synonyms: ["preferred name", "known as", "nickname"], max: 80 },
  { key: "dateOfBirth", label: "Date of birth", type: "date", synonyms: ["date of birth", "dob", "birth date", "birthdate", "d o b"] },
  { key: "sex", label: "Sex", type: "sex", synonyms: ["sex", "gender"] },
  { key: "email", label: "Email", type: "email", synonyms: ["email", "e mail", "email address", "e mail address", "email addr"] },
  { key: "phoneMobile", label: "Mobile phone", type: "phone", synonyms: ["mobile", "mobile phone", "mobile number", "mobile no", "mobile tel", "mobile telephone", "cell", "cell phone"] },
  { key: "phoneHome", label: "Home phone", type: "phone", synonyms: ["home phone", "home tel", "home telephone", "telephone", "phone", "tel", "landline"] },
  { key: "phoneWork", label: "Work phone", type: "phone", synonyms: ["work phone", "work tel", "work telephone", "daytime phone", "business phone"] },
  { key: "address1", label: "Address line 1", type: "text", synonyms: ["address 1", "address line 1", "address1", "address", "street", "house"], max: 120 },
  { key: "address2", label: "Address line 2", type: "text", synonyms: ["address 2", "address line 2", "address2"], max: 120 },
  { key: "address3", label: "Address line 3", type: "text", synonyms: ["address 3", "address line 3", "address3", "locality", "district"], max: 120 },
  { key: "town", label: "Town", type: "text", synonyms: ["town", "city", "post town", "town city"], max: 120 },
  { key: "county", label: "County", type: "text", synonyms: ["county", "region"], max: 120 },
  { key: "postcode", label: "Postcode", type: "postcode", synonyms: ["postcode", "post code", "postal code", "zip", "zip code", "p code"] },
  { key: "occupation", label: "Occupation", type: "text", synonyms: ["occupation", "job", "job title", "profession"], max: 120 },
  { key: "employer", label: "Employer", type: "text", synonyms: ["employer", "company", "employer name"], max: 160 },
  { key: "gpName", label: "GP", type: "text", synonyms: ["gp", "gp name", "doctor", "family doctor", "gp doctor"], max: 120 },
  { key: "gpPractice", label: "GP surgery", type: "text", synonyms: ["gp surgery", "surgery", "medical centre", "health centre", "gp address"], max: 160 },
  { key: "emergencyName", label: "Emergency contact", type: "text", synonyms: ["emergency contact", "next of kin", "nok", "emergency contact name", "nok name"], max: 120 },
  { key: "emergencyPhone", label: "Emergency contact phone", type: "phone", synonyms: ["emergency phone", "emergency contact phone", "nok phone", "next of kin phone", "emergency tel"] },
  { key: "emergencyRelationship", label: "Emergency contact relationship", type: "text", synonyms: ["relationship", "nok relationship", "emergency relationship"], max: 60 },
  { key: "reminderSms", label: "Text reminders", type: "yesno", synonyms: ["sms reminders", "text reminders", "sms", "text message reminders"], hint: "Blank: on (appointment reminders are a service message)." },
  { key: "reminderEmail", label: "Email reminders", type: "yesno", synonyms: ["email reminders", "e mail reminders"], hint: "Blank: on." },
  { key: "marketingEmail", label: "Marketing by email (opted in)", type: "yesno", synonyms: ["marketing email", "email marketing", "newsletter", "email opt in"], hint: "Only a clear yes counts as consent; recorded as consent given in the earlier system." },
  { key: "marketingSms", label: "Marketing by text (opted in)", type: "yesno", synonyms: ["marketing sms", "sms marketing", "text marketing", "sms opt in"], hint: "Only a clear yes counts as consent." },
  { key: "alerts", label: "Medical alerts", type: "longtext", sensitive: true, synonyms: ["alerts", "medical alerts", "warnings", "allergies", "alert", "medical warnings"], max: 4000 },
  { key: "notes", label: "Notes", type: "longtext", sensitive: true, synonyms: ["notes", "comments", "admin notes", "patient notes"], max: 8000 },
  { key: "status", label: "Status", type: "enum", synonyms: ["status", "patient status", "active"], hint: "Active, archived (inactive) or deceased. Blank: active." },
];

const CASE_FIELDS: readonly ImportField[] = [
  { key: "ref", label: "Case reference", type: "text", required: true, synonyms: ["case id", "case ref", "case reference", "case no", "case number", "episode id", "episode ref", "episode no", "referral id", "id"], hint: "The case's id in the earlier system (unique). Used to link appointments and invoices.", max: 80 },
  PATIENT_REF,
  { key: "title", label: "Title", type: "text", synonyms: ["title", "condition", "complaint", "case name", "episode name", "description", "problem", "injury", "body part"], hint: "A short label such as \"Right knee\". Blank: \"Case from the earlier system\".", max: 120 },
  { key: "openedOn", label: "Start date", type: "date", required: true, synonyms: ["start date", "opened", "date opened", "opened on", "episode start", "created", "case start", "start"] },
  { key: "closedOn", label: "End date", type: "date", synonyms: ["end date", "closed", "date closed", "closed on", "discharge date", "discharged", "episode end", "end"] },
  { key: "status", label: "Status", type: "enum", synonyms: ["status", "case status", "episode status"], hint: "Open, discharged or closed. Blank: open, or discharged when there is an end date." },
  PAYER_TYPE,
  PAYER_NAME,
  { key: "membershipNumber", label: "Membership or policy number", type: "text", synonyms: ["membership number", "membership no", "policy number", "policy no", "member number", "member no"], max: 40 },
  { key: "claimReference", label: "Claim or instruction reference", type: "text", synonyms: ["claim number", "claim no", "claim reference", "claim ref", "instruction reference", "mlc reference", "solicitor reference", "their reference"], max: 60 },
  { key: "authorisationCode", label: "Authorisation code", type: "text", synonyms: ["authorisation code", "authorisation", "auth code", "authorization code", "pre authorisation", "preauth", "auth no", "authorisation number"], hint: "An insurer's authorisation: added to the case with the sessions and expiry below.", max: 60 },
  { key: "sessionsAuthorised", label: "Sessions authorised", type: "int", synonyms: ["sessions authorised", "sessions authorized", "authorised sessions", "sessions", "number of sessions"] },
  { key: "sessionsUsed", label: "Sessions used", type: "int", synonyms: ["sessions used", "used sessions", "sessions taken"] },
  { key: "authorisationExpiresOn", label: "Authorisation expiry", type: "date", synonyms: ["authorisation expiry", "auth expiry", "expiry date", "expires", "authorisation end"] },
  { key: "excess", label: "Excess", type: "money", synonyms: ["excess", "policy excess", "excess amount"] },
  { key: "referrerName", label: "Referred by", type: "text", synonyms: ["referrer", "referred by", "referral source", "referring gp", "referring doctor", "referring clinician"], hint: "Matched to the clinic's referrers by name; a name not found is added to the directory.", max: 160 },
  { key: "referralReceivedOn", label: "Referral received", type: "date", synonyms: ["referral date", "referral received", "date referred", "referred on"] },
  { key: "injuryOn", label: "Date of injury or accident", type: "date", synonyms: ["injury date", "date of injury", "accident date", "date of accident", "incident date", "date of incident"] },
  { key: "referralReason", label: "Reason for referral", type: "longtext", sensitive: true, synonyms: ["reason for referral", "referral reason", "presenting complaint", "diagnosis", "reason"], max: 4000 },
  PRACTITIONER,
  SITE,
  { key: "notes", label: "Case notes (administrative)", type: "longtext", sensitive: true, synonyms: ["notes", "case notes", "comments"], max: 8000 },
];

const APPOINTMENT_FIELDS: readonly ImportField[] = [
  { key: "ref", label: "Appointment reference", type: "text", required: true, synonyms: ["appointment id", "appointment ref", "appointment no", "booking id", "booking ref", "booking no", "id"], hint: "The appointment's id in the earlier system (unique).", max: 80 },
  PATIENT_REF,
  CASE_REF,
  { key: "date", label: "Date", type: "date", required: true, synonyms: ["date", "appointment date", "start date", "start", "booking date", "appt date"] },
  { key: "startTime", label: "Start time", type: "time", synonyms: ["time", "start time", "appointment time", "appt time", "from"], hint: "Blank: the time in the date column, if it has one." },
  { key: "endTime", label: "End time", type: "time", synonyms: ["end time", "finish time", "end", "finish", "to"] },
  { key: "durationMinutes", label: "Length (minutes)", type: "int", synonyms: ["duration", "length", "minutes", "mins", "duration mins", "duration minutes"], hint: "Blank: from the end time, else the appointment type's length." },
  { ...PRACTITIONER, required: true },
  SITE,
  { key: "roomName", label: "Room", type: "text", synonyms: ["room", "resource", "room name"], max: 80 },
  { key: "serviceName", label: "Appointment type", type: "text", synonyms: ["appointment type", "type", "service", "treatment", "category", "appt type", "treatment type"], hint: "Matched to the clinic's appointment types by name or code.", max: 120 },
  { key: "status", label: "Status", type: "enum", synonyms: ["status", "outcome", "attendance", "appointment status", "arrived"], hint: "Attended, did not attend, late cancellation, cancelled or booked. Blank: attended for past dates, booked for future ones." },
  { key: "cancellationReason", label: "Reason (cancellation or non-attendance)", type: "longtext", sensitive: true, synonyms: ["cancellation reason", "dna reason", "reason", "cancel reason"], max: 500 },
  { key: "charge", label: "Fee", type: "money", synonyms: ["fee", "charge", "price", "amount", "cost", "appointment fee"] },
  { key: "notes", label: "Booking notes", type: "longtext", sensitive: true, synonyms: ["notes", "booking notes", "comments"], max: 2000 },
];

const INVOICE_FIELDS: readonly ImportField[] = [
  { key: "ref", label: "Invoice number", type: "text", required: true, synonyms: ["invoice number", "invoice no", "invoice id", "inv no", "invoice ref", "invoice", "number"], max: 80 },
  PATIENT_REF,
  CASE_REF,
  { key: "issuedOn", label: "Invoice date", type: "date", required: true, synonyms: ["invoice date", "date", "issued", "date issued", "issue date", "raised"] },
  { key: "dueOn", label: "Due date", type: "date", synonyms: ["due date", "due", "payment due"] },
  PAYER_TYPE,
  { ...PAYER_NAME, hint: "Who the invoice is addressed to. Blank: the patient (self-pay)." },
  { key: "total", label: "Total", type: "money", required: true, synonyms: ["total", "invoice total", "amount", "gross", "value", "total amount", "net"] },
  { key: "paid", label: "Paid", type: "money", synonyms: ["paid", "amount paid", "payments", "received", "paid amount"] },
  { key: "balance", label: "Balance owed", type: "money", synonyms: ["balance", "outstanding", "amount due", "owed", "balance due", "outstanding balance"], hint: "Blank: total minus paid." },
  { key: "description", label: "Description", type: "text", synonyms: ["description", "details", "items", "treatment", "narrative"], max: 200 },
  { key: "status", label: "Status", type: "enum", synonyms: ["status", "invoice status", "state"], hint: "Paid, part paid, unpaid, written off or void. Blank: worked out from the balance." },
];

export const IMPORT_KIND_INFO: Readonly<Record<ImportKind, ImportKindInfo>> = {
  patients: {
    kind: "patients",
    label: "Patients",
    noun: "patients",
    description: "Names, dates of birth, contact details, GP, reminders and marketing choices, alerts.",
    dependsOn: [],
    fields: PATIENT_FIELDS,
  },
  cases: {
    kind: "cases",
    label: "Cases",
    noun: "cases",
    description: "Episodes of care with who pays (self-pay, insurer, medico-legal company…), references and authorisations.",
    dependsOn: ["patients"],
    fields: CASE_FIELDS,
  },
  appointments: {
    kind: "appointments",
    label: "Appointments",
    noun: "appointments",
    description: "Past appointments (attended, did not attend, cancelled) and future bookings, with practitioner and site.",
    dependsOn: ["patients"],
    fields: APPOINTMENT_FIELDS,
  },
  invoices: {
    kind: "invoices",
    label: "Invoices and balances",
    noun: "invoices",
    description: "Invoices with what was paid and what is still owed – patients' and payers' balances.",
    dependsOn: ["patients"],
    fields: INVOICE_FIELDS,
  },
};

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

export function importField(kind: ImportKind, key: string): ImportField | undefined {
  return IMPORT_KIND_INFO[kind].fields.find((f) => f.key === key);
}

/** A field's column name in our CSV template: its label without the part in brackets ("Payer", "Length"). */
export function templateHeader(field: ImportField): string {
  return field.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Our CSV template's header line for a kind (the mapping step matches these exactly). */
export function templateHeaders(kind: ImportKind): string[] {
  return IMPORT_KIND_INFO[kind].fields.map(templateHeader);
}
