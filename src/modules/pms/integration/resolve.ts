/**
 * Turning a read row into what will be written, with the clinic's own data: which patient a reference points at,
 * which practitioner, site, room, appointment type and payer a name means, and whether the row is already in the
 * clinic. Pure – the server reads the clinic's data once per page of rows and passes it in (ImportLookups).
 *
 * Matching names: lower case, letters and digits only, words in brackets ignored ("Bletchley (fictional)" =
 * "Bletchley"), "Surname, First" = "First Surname"; practitioners also by registration number, sites by code,
 * appointment types by code. Only a single match counts – two candidates are "not found".
 */
import type { PayerType, ReferrerKind } from "../core/types";
import { issue, type RowIssue } from "./issues";
import type { AppointmentImportRecord, CaseImportRecord, ImportAppointmentStatus, InvoiceImportRecord, PatientImportRecord } from "./rows";
import { matchKey } from "./values";

export interface LookupPractitioner {
  id: string;
  displayName: string;
  registrationNumber: string | null;
  defaultSiteId: string | null;
  importRef: string | null;
}
export interface LookupSite {
  id: string;
  name: string;
  code: string | null;
  importRef: string | null;
}
export interface LookupRoom {
  id: string;
  siteId: string;
  name: string;
}
export interface LookupService {
  id: string;
  name: string;
  code: string | null;
  durationMinutes: number;
  importRef: string | null;
}
export interface LookupReferrer {
  id: string;
  name: string;
  kind: ReferrerKind;
}

export interface ImportLookups {
  /** "YYYY-MM-DD" (UK): appointments without a status are attended before it, booked from it. */
  today: string;
  /** References of this kind already in the clinic (the row is skipped as already imported). */
  existingRefs: ReadonlySet<string>;
  /** Patient reference (import_ref) → patient id. */
  patientsByRef: ReadonlyMap<string, string>;
  /** Case reference (import_ref) → case id and its patient. */
  casesByRef: ReadonlyMap<string, { id: string; patientId: string }>;
  practitioners: readonly LookupPractitioner[];
  sites: readonly LookupSite[];
  rooms: readonly LookupRoom[];
  services: readonly LookupService[];
  referrers: readonly LookupReferrer[];
}

/** A payer or referrer: one in the directory, or one the import adds (by name and kind, once per import). */
export type DirectoryRef = { id: string } | { add: { name: string; kind: ReferrerKind } };

export interface PatientPlan {
  kind: "patients";
  record: PatientImportRecord;
}
export interface CasePlan {
  kind: "cases";
  record: CaseImportRecord;
  patientId: string;
  payerType: PayerType;
  payer: DirectoryRef | null;
  referrer: DirectoryRef | null;
  practitionerId: string | null;
  siteId: string | null;
}
export interface AppointmentPlan {
  kind: "appointments";
  record: AppointmentImportRecord;
  patientId: string;
  caseId: string | null;
  practitionerId: string;
  siteId: string | null;
  roomId: string | null;
  serviceId: string | null;
  status: ImportAppointmentStatus;
  durationMinutes: number;
}
export interface InvoicePlan {
  kind: "invoices";
  record: InvoiceImportRecord;
  patientId: string;
  caseId: string | null;
  payerType: PayerType;
  payer: DirectoryRef | null;
}
export type ImportPlan = PatientPlan | CasePlan | AppointmentPlan | InvoicePlan;

export interface ResolveResult<P> {
  plan: P | null;
  issues: RowIssue[];
  /** The row's reference is already in the clinic. */
  duplicate: boolean;
}

/** Name key without words in brackets: "Bletchley (fictional)" → "bletchley". */
export function nameKey(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return matchKey(raw.replace(/\([^)]*\)/g, " "));
}

/** "Reid, Sarah" → "sarah reid" (else the plain name key). */
function personKey(raw: string): string {
  if (raw.includes(",")) {
    const [last, ...first] = raw.split(",");
    return nameKey(`${first.join(" ")} ${last}`);
  }
  return nameKey(raw);
}

function single<T>(matches: T[]): T | null {
  return matches.length === 1 ? matches[0] : null;
}

export function findPractitioner(list: readonly LookupPractitioner[], raw: string | null): LookupPractitioner | null {
  if (!raw) return null;
  const reg = raw.trim().toUpperCase();
  const byReg = single(list.filter((p) => (p.registrationNumber && p.registrationNumber.toUpperCase() === reg) || (p.importRef && p.importRef === raw.trim())));
  if (byReg) return byReg;
  // "Sarah Reid (PH-DEMO-01)": the number in brackets.
  const inBrackets = /\(([A-Za-z0-9-]{3,20})\)/.exec(raw)?.[1]?.toUpperCase();
  if (inBrackets) {
    const p = single(list.filter((x) => x.registrationNumber?.toUpperCase() === inBrackets));
    if (p) return p;
  }
  const key = personKey(raw);
  return key ? single(list.filter((p) => nameKey(p.displayName) === key)) : null;
}

export function findSite(list: readonly LookupSite[], raw: string | null): LookupSite | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  const key = nameKey(raw);
  return single(list.filter((s) => (s.code && s.code.toUpperCase() === code) || (s.importRef && s.importRef === raw.trim()))) ?? (key ? single(list.filter((s) => nameKey(s.name) === key)) : null);
}

export function findRoom(list: readonly LookupRoom[], siteId: string | null, raw: string | null): LookupRoom | null {
  if (!raw || !siteId) return null;
  const key = nameKey(raw);
  return key ? single(list.filter((r) => r.siteId === siteId && nameKey(r.name) === key)) : null;
}

export function findService(list: readonly LookupService[], raw: string | null): LookupService | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  const key = nameKey(raw);
  return single(list.filter((s) => (s.code && s.code.toUpperCase() === code) || (s.importRef && s.importRef === raw.trim()))) ?? (key ? single(list.filter((s) => nameKey(s.name) === key)) : null);
}

export function findReferrer(list: readonly LookupReferrer[], raw: string | null, kinds?: readonly ReferrerKind[]): LookupReferrer | null {
  if (!raw) return null;
  const key = nameKey(raw);
  if (!key) return null;
  const all = list.filter((r) => nameKey(r.name) === key);
  if (kinds) {
    const ofKind = single(all.filter((r) => kinds.includes(r.kind)));
    if (ofKind) return ofKind;
  }
  return single(all);
}

const PAYER_KIND: Record<PayerType, ReferrerKind | null> = {
  self_pay: null,
  insurer: "insurer",
  mlc: "mlc",
  solicitor: "solicitor",
  employer: "employer",
  other: "other",
};

const KIND_PAYER: Partial<Record<ReferrerKind, PayerType>> = {
  insurer: "insurer",
  mlc: "mlc",
  solicitor: "solicitor",
  employer: "employer",
  case_manager: "other",
  other: "other",
};

/** A payer's type from its name when the file does not say (null: cannot tell). */
export function guessPayerType(name: string): PayerType | null {
  const n = name.toLowerCase();
  if (/medico|medical reporting|\bmlc\b|rehabilitation|case management/.test(n)) return "mlc";
  if (/insur|medical cover|health ?care|\bhealth\b|assurance|\bpmi\b/.test(n)) return "insurer";
  if (/solicitor|\blaw\b|\blegal\b|\bllp\b|chambers/.test(n)) return "solicitor";
  return null;
}

/** The kind a referrer ("referred by") the import adds gets. */
export function guessReferrerKind(name: string): ReferrerKind {
  const n = name.toLowerCase();
  if (/\bgp\b|surgery|medical centre|health centre|medical practice/.test(n)) return "gp";
  if (/consultant|orthopaedic|surgeon/.test(n)) return "consultant";
  if (/self/.test(n)) return "self";
  return guessPayerType(name) === "insurer" ? "insurer" : guessPayerType(name) === "solicitor" ? "solicitor" : guessPayerType(name) === "mlc" ? "mlc" : "other";
}

/** Who pays, from the file's type and name and the directory. */
function resolvePayer(lookups: ImportLookups, payerType: PayerType | null, payerName: string | null, issues: RowIssue[]): { payerType: PayerType; payer: DirectoryRef | null } {
  if (payerType === "self_pay" || !payerName) return { payerType: payerType ?? "self_pay", payer: null };
  const wantedKinds = payerType ? [PAYER_KIND[payerType] ?? "other"] : undefined;
  const found = findReferrer(lookups.referrers, payerName, wantedKinds as ReferrerKind[] | undefined);
  if (found) return { payerType: payerType ?? KIND_PAYER[found.kind] ?? "other", payer: { id: found.id } };
  const type = payerType ?? guessPayerType(payerName) ?? "other";
  issues.push(issue("PAYER_ADDED", "warning", "payerName"));
  return { payerType: type, payer: { add: { name: payerName, kind: PAYER_KIND[type] ?? "other" } } };
}

export function resolvePatient(record: PatientImportRecord, lookups: ImportLookups): ResolveResult<PatientPlan> {
  if (lookups.existingRefs.has(record.ref)) return { plan: null, issues: [issue("ALREADY_IMPORTED", "warning", "ref")], duplicate: true };
  return { plan: { kind: "patients", record }, issues: [], duplicate: false };
}

export function resolveCase(record: CaseImportRecord, lookups: ImportLookups): ResolveResult<CasePlan> {
  if (lookups.existingRefs.has(record.ref)) return { plan: null, issues: [issue("ALREADY_IMPORTED", "warning", "ref")], duplicate: true };
  const issues: RowIssue[] = [];
  const patientId = lookups.patientsByRef.get(record.patientRef) ?? null;
  if (!patientId) issues.push(issue("PATIENT_NOT_FOUND", "error", "patientRef"));
  const { payerType, payer } = resolvePayer(lookups, record.payerType, record.payerName, issues);
  let referrer: DirectoryRef | null = null;
  if (record.referrerName) {
    const found = findReferrer(lookups.referrers, record.referrerName);
    if (found) referrer = { id: found.id };
    else {
      issues.push(issue("REFERRER_ADDED", "warning", "referrerName"));
      referrer = { add: { name: record.referrerName, kind: guessReferrerKind(record.referrerName) } };
    }
  }
  const practitioner = findPractitioner(lookups.practitioners, record.practitionerName);
  if (record.practitionerName && !practitioner) issues.push(issue("PRACTITIONER_NOT_FOUND", "warning", "practitionerName"));
  const site = findSite(lookups.sites, record.siteName);
  if (record.siteName && !site) issues.push(issue("SITE_NOT_FOUND", "warning", "siteName"));
  if (!patientId) return { plan: null, issues, duplicate: false };
  return {
    plan: {
      kind: "cases",
      record,
      patientId,
      payerType,
      payer,
      referrer,
      practitionerId: practitioner?.id ?? null,
      siteId: site?.id ?? practitioner?.defaultSiteId ?? null,
    },
    issues,
    duplicate: false,
  };
}

/** The case a row names, when it is the same patient's (else a warning and no case). */
function resolveCaseLink(lookups: ImportLookups, caseRef: string | null, patientId: string | null, issues: RowIssue[]): string | null {
  if (!caseRef) return null;
  const found = lookups.casesByRef.get(caseRef);
  if (!found) {
    issues.push(issue("CASE_NOT_FOUND", "warning", "caseRef"));
    return null;
  }
  if (patientId && found.patientId !== patientId) {
    issues.push(issue("CASE_OF_OTHER_PATIENT", "warning", "caseRef"));
    return null;
  }
  return found.id;
}

export function resolveAppointment(record: AppointmentImportRecord, lookups: ImportLookups): ResolveResult<AppointmentPlan> {
  if (lookups.existingRefs.has(record.ref)) return { plan: null, issues: [issue("ALREADY_IMPORTED", "warning", "ref")], duplicate: true };
  const issues: RowIssue[] = [];
  const patientId = lookups.patientsByRef.get(record.patientRef) ?? null;
  if (!patientId) issues.push(issue("PATIENT_NOT_FOUND", "error", "patientRef"));
  const caseId = resolveCaseLink(lookups, record.caseRef, patientId, issues);
  const practitioner = findPractitioner(lookups.practitioners, record.practitionerName);
  if (!practitioner) issues.push(issue("PRACTITIONER_NOT_FOUND", "error", "practitionerName"));
  const site = findSite(lookups.sites, record.siteName);
  if (record.siteName && !site) issues.push(issue("SITE_NOT_FOUND", "warning", "siteName"));
  const siteId = site?.id ?? practitioner?.defaultSiteId ?? null;
  const room = findRoom(lookups.rooms, siteId, record.roomName);
  if (record.roomName && !room) issues.push(issue("ROOM_NOT_FOUND", "warning", "roomName"));
  const service = findService(lookups.services, record.serviceName);
  if (record.serviceName && !service) issues.push(issue("SERVICE_NOT_FOUND", "warning", "serviceName"));
  const durationMinutes = record.durationMinutes ?? service?.durationMinutes ?? null;
  if (durationMinutes === null) issues.push(issue("LENGTH_UNKNOWN", "error", "durationMinutes"));
  const status: ImportAppointmentStatus = record.status ?? (record.date < lookups.today ? "attended" : "booked");
  if (!patientId || !practitioner || durationMinutes === null) return { plan: null, issues, duplicate: false };
  return {
    plan: { kind: "appointments", record, patientId, caseId, practitionerId: practitioner.id, siteId, roomId: room?.id ?? null, serviceId: service?.id ?? null, status, durationMinutes },
    issues,
    duplicate: false,
  };
}

export function resolveInvoice(record: InvoiceImportRecord, lookups: ImportLookups): ResolveResult<InvoicePlan> {
  if (lookups.existingRefs.has(record.ref)) return { plan: null, issues: [issue("ALREADY_IMPORTED", "warning", "ref")], duplicate: true };
  const issues: RowIssue[] = [];
  const patientId = lookups.patientsByRef.get(record.patientRef) ?? null;
  if (!patientId) issues.push(issue("PATIENT_NOT_FOUND", "error", "patientRef"));
  const caseId = resolveCaseLink(lookups, record.caseRef, patientId, issues);
  const { payerType, payer } = resolvePayer(lookups, record.payerType, record.payerName, issues);
  if (!patientId) return { plan: null, issues, duplicate: false };
  return { plan: { kind: "invoices", record, patientId, caseId, payerType, payer }, issues, duplicate: false };
}

/** Resolves a row of any kind. */
export function resolveImportRecord(plan: { kind: "patients"; record: PatientImportRecord } | { kind: "cases"; record: CaseImportRecord } | { kind: "appointments"; record: AppointmentImportRecord } | { kind: "invoices"; record: InvoiceImportRecord }, lookups: ImportLookups): ResolveResult<ImportPlan> {
  switch (plan.kind) {
    case "patients":
      return resolvePatient(plan.record, lookups);
    case "cases":
      return resolveCase(plan.record, lookups);
    case "appointments":
      return resolveAppointment(plan.record, lookups);
    case "invoices":
      return resolveInvoice(plan.record, lookups);
  }
}
