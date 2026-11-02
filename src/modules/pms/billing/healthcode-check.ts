/**
 * "Ready / needs review" for insurer bills going through Healthcode (HC11, docs/clinic-system/healthcode.md). Pure.
 *
 * checkHealthcodeInvoice looks at one issued insurer invoice and lists what is still missing before Healthcode can
 * take it – each reason in plain English, worded as the next step, with a link to the screen that fixes it.
 * checkHealthcodeBatch does that for a list and adds the batch rule: one file holds one Healthcode Site ID.
 *
 * What is checked (in this order):
 *  - the invoice is issued (numbered, not voided) and addressed to an insurer;
 *  - the insurer's Healthcode identifier and the clinic's provider number with it; the payee provider number;
 *  - the Healthcode Site ID of the invoice's site (or the clinic's);
 *  - the patient's first name, last name, date of birth and postcode;
 *  - the membership number on the case;
 *  - an authorisation, active, valid on every treatment date, with no more sessions used than authorised;
 *  - a diagnosis code (the invoice's, else the case's) – needed when the insurer asks for one, and in ICD-10 format
 *    whenever one is given;
 *  - every treatment line: a date of service, a practitioner with their provider number for this insurer, and the
 *    insurer's treatment code (ISC) for the service.
 * Item and excess lines are not treatments and are not checked line by line.
 */
import { isValidIcd10 } from "./icd10";

const CLINIC = "/app/clinic";

export interface HealthcodeLineFacts {
  id: string;
  lineNo: number;
  kind: string;
  serviceId: string | null;
  serviceName: string | null;
  serviceOn: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  /** The practitioner's provider number with this insurer. */
  practitionerNumber: string | null;
  /** The insurer's treatment code (ISC) for the service. */
  iscCode: string | null;
}

export interface HealthcodeInvoiceFacts {
  invoiceId: string;
  number: string | null;
  status: string;
  voided: boolean;
  billTo: string;
  patientId: string;
  caseId: string | null;
  siteId: string | null;
  patient: { firstName: string | null; lastName: string | null; dateOfBirth: string | null; postcode: string | null };
  membershipNumber: string | null;
  authorisation: { code: string; status: string; validFrom: string | null; expiresOn: string | null; sessionsAuthorised: number | null; sessionsUsed: number } | null;
  /** The invoice's own code, else the case's (null = none). */
  diagnosisCode: string | null;
  /** null = not an insurer of the clinic (a solicitor, an MLC company…). */
  payer: { id: string; name: string; insurerCode: string | null; providerNumber: string | null; diagnosisRequired: boolean } | null;
  /** The Site ID and payee provider number the invoice's site uses (healthcodeForSite). */
  siteCode: string | null;
  payeeProviderNumber: string | null;
  lines: HealthcodeLineFacts[];
}

export type HealthcodeIssueCode =
  | "not_issued"
  | "not_insurer"
  | "insurer_code"
  | "provider_number"
  | "payee_number"
  | "site_code"
  | "patient_name"
  | "patient_dob"
  | "patient_postcode"
  | "membership"
  | "authorisation_missing"
  | "authorisation_cancelled"
  | "authorisation_dates"
  | "authorisation_sessions"
  | "diagnosis_missing"
  | "diagnosis_format"
  | "no_treatments"
  | "service_date"
  | "practitioner_missing"
  | "practitioner_number"
  | "isc_code";

export interface HealthcodeIssue {
  code: HealthcodeIssueCode;
  /** Plain English, worded as the next step. */
  message: string;
  /** Where to fix it. */
  fix: { label: string; href: string } | null;
}

export interface HealthcodeCheck {
  invoiceId: string;
  ready: boolean;
  issues: HealthcodeIssue[];
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const blank = (v: string | null | undefined): boolean => typeof v !== "string" || v.trim() === "";

export function checkHealthcodeInvoice(f: HealthcodeInvoiceFacts): HealthcodeCheck {
  const issues: HealthcodeIssue[] = [];
  const add = (code: HealthcodeIssueCode, message: string, fix: HealthcodeIssue["fix"] = null) => {
    if (!issues.some((i) => i.code === code && i.message === message)) issues.push({ code, message, fix });
  };
  const invoiceHref = `${CLINIC}/billing/invoices/${f.invoiceId}`;
  const patientHref = `${CLINIC}/patients/${f.patientId}/edit`;
  const caseHref = f.caseId ? `${CLINIC}/patients/${f.patientId}/cases/${f.caseId}` : `${CLINIC}/patients/${f.patientId}/cases`;

  if (f.status !== "issued" || !f.number || f.voided) add("not_issued", f.voided ? "This invoice is voided – it is not sent." : "Issue the invoice first – only issued invoices go to Healthcode.", { label: "Open the invoice", href: invoiceHref });
  if (f.billTo !== "payer" || !f.payer) {
    add("not_insurer", "Address the invoice to an insurer – Healthcode handles insurer bills only.", { label: "Open the invoice", href: invoiceHref });
    return { invoiceId: f.invoiceId, ready: false, issues };
  }
  const payerHref = `${CLINIC}/setup/referrers?referrer=${f.payer.id}`;
  if (blank(f.payer.insurerCode)) add("insurer_code", `Add ${f.payer.name}'s Healthcode insurer identifier.`, { label: "Insurer set-up", href: payerHref });
  if (blank(f.payer.providerNumber)) add("provider_number", `Add the clinic's provider number with ${f.payer.name}.`, { label: "Insurer set-up", href: payerHref });
  if (blank(f.payeeProviderNumber)) add("payee_number", "Add the clinic's payee provider number.", { label: "Billing settings", href: `${CLINIC}/setup/billing` });
  if (blank(f.siteCode)) add("site_code", "Add the clinic's Healthcode Site ID.", { label: "Billing settings", href: `${CLINIC}/setup/billing` });

  if (blank(f.patient.firstName) || blank(f.patient.lastName)) add("patient_name", "Add the patient's first and last name.", { label: "Patient details", href: patientHref });
  if (blank(f.patient.dateOfBirth)) add("patient_dob", "Add the patient's date of birth.", { label: "Patient details", href: patientHref });
  if (blank(f.patient.postcode)) add("patient_postcode", "Add the patient's postcode.", { label: "Patient details", href: patientHref });

  if (blank(f.membershipNumber)) add("membership", "Add the patient's membership number to the case.", { label: "Open the case", href: caseHref });

  const treatments = f.lines.filter((l) => l.kind === "service");
  const dates = treatments.map((l) => l.serviceOn).filter((d): d is string => typeof d === "string").sort();
  const a = f.authorisation;
  if (!a) add("authorisation_missing", `Add ${f.payer.name}'s authorisation code to the case and the invoice.`, { label: "Open the case", href: caseHref });
  else {
    if (a.status === "cancelled") add("authorisation_cancelled", `Authorisation ${a.code} is cancelled – use the one in force.`, { label: "Open the case", href: caseHref });
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first && a.validFrom && first < a.validFrom) add("authorisation_dates", `Authorisation ${a.code} starts on ${ukDate(a.validFrom)}, after the first treatment (${ukDate(first)}).`, { label: "Open the case", href: caseHref });
    if (last && a.expiresOn && last > a.expiresOn) add("authorisation_dates", `Authorisation ${a.code} ended on ${ukDate(a.expiresOn)}, before the last treatment (${ukDate(last)}) – ask ${f.payer.name} to extend it.`, { label: "Open the case", href: caseHref });
    if (a.sessionsAuthorised !== null && a.sessionsUsed > a.sessionsAuthorised)
      add("authorisation_sessions", `Authorisation ${a.code} covers ${a.sessionsAuthorised} sessions and ${a.sessionsUsed} are used – ask ${f.payer.name} for more sessions.`, { label: "Open the case", href: caseHref });
  }

  if (blank(f.diagnosisCode)) {
    if (f.payer.diagnosisRequired) add("diagnosis_missing", `Add a diagnosis code – ${f.payer.name} needs one on every bill.`, { label: "Open the invoice", href: invoiceHref });
  } else if (!isValidIcd10(f.diagnosisCode)) add("diagnosis_format", `Change the diagnosis code "${f.diagnosisCode}" to ICD-10 format (for example M54.5).`, { label: "Open the invoice", href: invoiceHref });

  if (treatments.length === 0) add("no_treatments", "Add the treatments to the invoice – Healthcode bills list each one.", { label: "Open the invoice", href: invoiceHref });
  for (const l of treatments) {
    const what = `${l.serviceName ?? "treatment"} on line ${l.lineNo}`;
    if (blank(l.serviceOn)) add("service_date", `Add the date of the ${what}.`, { label: "Open the invoice", href: invoiceHref });
    if (!l.practitionerId) add("practitioner_missing", `Add the practitioner who gave the ${what}.`, { label: "Open the invoice", href: invoiceHref });
    else if (blank(l.practitionerNumber))
      add("practitioner_number", `Add ${l.practitionerName ?? "the practitioner"}'s provider number with ${f.payer.name}.`, { label: "Practitioner set-up", href: `${CLINIC}/setup/practitioners?practitioner=${l.practitionerId}` });
    if (blank(l.iscCode))
      add("isc_code", l.serviceId ? `Add ${f.payer.name}'s treatment code for ${l.serviceName ?? "this service"}.` : `Link the ${what} to a service so it gets ${f.payer.name}'s treatment code.`, {
        label: "Insurer treatment codes",
        href: `${CLINIC}/setup/insurer-codes?insurer=${f.payer.id}`,
      });
  }
  return { invoiceId: f.invoiceId, ready: issues.length === 0, issues };
}

export interface HealthcodeBatch {
  ready: HealthcodeCheck[];
  needsReview: HealthcodeCheck[];
  /** The Site IDs of the ready invoices (a file holds one; more than one = more than one file). */
  siteCodes: string[];
  /** Ready invoices grouped by Site ID, in the order first seen. */
  groups: { siteCode: string; invoiceIds: string[] }[];
  /** Plain notes about the batch as a whole. */
  notes: string[];
}

/** Every invoice checked, and the batch rule: one Healthcode Site ID per file. */
export function checkHealthcodeBatch(invoices: readonly HealthcodeInvoiceFacts[]): HealthcodeBatch {
  const checks = invoices.map((f) => ({ f, c: checkHealthcodeInvoice(f) }));
  const ready = checks.filter((x) => x.c.ready);
  const groups: HealthcodeBatch["groups"] = [];
  for (const { f } of ready) {
    const code = f.siteCode as string;
    const g = groups.find((x) => x.siteCode === code);
    if (g) g.invoiceIds.push(f.invoiceId);
    else groups.push({ siteCode: code, invoiceIds: [f.invoiceId] });
  }
  const notes: string[] = [];
  if (groups.length > 1) notes.push(`These ready invoices are for ${groups.length} Healthcode Site IDs (${groups.map((g) => g.siteCode).join(", ")}). Each file holds one Site ID, so they go in ${groups.length} files.`);
  return { ready: ready.map((x) => x.c), needsReview: checks.filter((x) => !x.c.ready).map((x) => x.c), siteCodes: groups.map((g) => g.siteCode), groups, notes };
}
