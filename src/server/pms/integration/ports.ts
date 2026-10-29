/**
 * What the integration module needs from the other clinic-system modules, as interfaces ("ports"). The integration
 * module never imports another module's code: each module (or the orchestrator, when the modules are put together)
 * provides an adapter in ./wiring.ts. A port that is not wired is simply absent:
 *
 *   records (clinical notes, outcome measures) – the native connector reads a case's signed notes and scores;
 *   diary   (appointments)                     – the native connector reads a case's appointments; data import
 *                                                 writes imported appointments through it;
 *   billing (invoices)                         – letters read invoice figures; data import writes imported invoices.
 *
 * Without a port the connector sends ClinForms what the shared record holds (registration, referral, payer,
 * consent) and empty lists for the rest, and the import of that kind can be checked but not run (the page says why).
 * Every adapter takes the tenant explicitly and returns that clinic's rows only (the same rules as the repositories).
 */
import type { PmsActor } from "../../../modules/pms/core/types";
import type {
  ImportAppointmentStatus,
  ImportInvoiceStatus,
} from "../../../modules/pms/integration/rows";
import type {
  AppointmentPlan,
  InvoicePlan,
} from "../../../modules/pms/integration/resolve";
import type { RepoContext } from "../../repos/context";

/** A signed (locked) clinical note, decrypted. Unsigned drafts are never given to ClinForms. */
export interface NativeNote {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" (24 h, Europe/London) */
  time: string | null;
  type:
    "initial_assessment" | "follow_up" | "discharge" | "telephone" | "other";
  practitionerId: string | null;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  freeText?: string | null;
  pastMedicalHistory?: string | null;
  socialHistory?: string | null;
}

export interface NativeOutcomeSeries {
  id: string;
  instrument: "NDI" | "ODI" | "NPRS" | "PSFS" | "QuickDASH";
  points: { date: string; value: number; noteId?: string | null }[];
}

export interface NativeAppointment {
  id: string;
  date: string;
  time: string;
  durationMinutes: number;
  status: ImportAppointmentStatus;
  /** Why it was missed or cancelled (decrypted), when recorded. */
  reason?: string | null;
  practitionerId: string | null;
  siteId?: string | null;
  /** The note written for this appointment, if any. */
  noteId?: string | null;
  chargePence?: number | null;
  paid?: boolean | null;
}

export interface NativeInvoice {
  id: string;
  number: string;
  issuedOn: string;
  totalPence: number;
  paidPence: number;
  balancePence: number;
  payerReferrerId: string | null;
  status: ImportInvoiceStatus;
}

/** An imported row written by a module: the earlier system's reference, the new record and its revision. */
export interface ImportedRecord {
  ref: string;
  id: string;
  rev: number;
}

export interface UndoResult {
  /** Records taken back (cancelled / voided, never deleted). */
  undone: string[];
  /** Records kept because they changed or were used after the import. */
  kept: string[];
}

export interface ClinicalRecordsPort {
  /** A case's signed notes, oldest first, decrypted. */
  caseNotes(
    ctx: RepoContext,
    tenantId: string,
    patientId: string,
    caseId: string,
  ): Promise<NativeNote[]>;
  /** A case's outcome measures (scores by date). */
  caseOutcomes(
    ctx: RepoContext,
    tenantId: string,
    patientId: string,
    caseId: string,
  ): Promise<NativeOutcomeSeries[]>;
  /** Which of these patients / cases have clinical notes (an undo keeps them). */
  patientsWithRecords?(
    ctx: RepoContext,
    tenantId: string,
    patientIds: readonly string[],
  ): Promise<Set<string>>;
  casesWithRecords?(
    ctx: RepoContext,
    tenantId: string,
    caseIds: readonly string[],
  ): Promise<Set<string>>;
}

export type ResolvedInvoice = Omit<InvoicePlan, "payer"> & {
  payerReferrerId: string | null;
};

export interface DiaryPort {
  caseAppointments(
    ctx: RepoContext,
    tenantId: string,
    patientId: string,
    caseId: string,
  ): Promise<NativeAppointment[]>;
  /** A patient's appointments (letters about a patient without a case). */
  patientAppointments?(
    ctx: RepoContext,
    tenantId: string,
    patientId: string,
  ): Promise<NativeAppointment[]>;
  /** Import references already in the diary. */
  existingAppointmentRefs?(
    ctx: RepoContext,
    tenantId: string,
    refs: readonly string[],
  ): Promise<Set<string>>;
  importAppointments?(
    ctx: RepoContext,
    tenantId: string,
    plans: readonly AppointmentPlan[],
    actor: PmsActor,
    detail: { batchId: string },
  ): Promise<ImportedRecord[]>;
  undoImportedAppointments?(
    ctx: RepoContext,
    tenantId: string,
    items: readonly { id: string; rev: number }[],
    actor: PmsActor,
  ): Promise<UndoResult>;
  patientsWithAppointments?(
    ctx: RepoContext,
    tenantId: string,
    patientIds: readonly string[],
  ): Promise<Set<string>>;
  casesWithAppointments?(
    ctx: RepoContext,
    tenantId: string,
    caseIds: readonly string[],
  ): Promise<Set<string>>;
}

export interface BillingPort {
  caseInvoices(
    ctx: RepoContext,
    tenantId: string,
    caseId: string,
  ): Promise<NativeInvoice[]>;
  patientInvoices?(
    ctx: RepoContext,
    tenantId: string,
    patientId: string,
  ): Promise<NativeInvoice[]>;
  existingInvoiceRefs?(
    ctx: RepoContext,
    tenantId: string,
    refs: readonly string[],
  ): Promise<Set<string>>;
  importInvoices?(
    ctx: RepoContext,
    tenantId: string,
    invoices: readonly ResolvedInvoice[],
    actor: PmsActor,
    detail: { batchId: string },
  ): Promise<ImportedRecord[]>;
  undoImportedInvoices?(
    ctx: RepoContext,
    tenantId: string,
    items: readonly { id: string; rev: number }[],
    actor: PmsActor,
  ): Promise<UndoResult>;
  patientsWithInvoices?(
    ctx: RepoContext,
    tenantId: string,
    patientIds: readonly string[],
  ): Promise<Set<string>>;
  casesWithInvoices?(
    ctx: RepoContext,
    tenantId: string,
    caseIds: readonly string[],
  ): Promise<Set<string>>;
}

export interface IntegrationPorts {
  records: ClinicalRecordsPort | null;
  diary: DiaryPort | null;
  billing: BillingPort | null;
}

/** Whether the import of appointments / invoices can run (its module provides the import). */
export function importTargetAvailable(
  kind: "patients" | "cases" | "appointments" | "invoices",
  ports: IntegrationPorts,
): boolean {
  if (kind === "appointments")
    return Boolean(
      ports.diary?.importAppointments && ports.diary.undoImportedAppointments,
    );
  if (kind === "invoices")
    return Boolean(
      ports.billing?.importInvoices && ports.billing.undoImportedInvoices,
    );
  return true;
}

/** Plain words for why an import kind cannot run yet. */
export function importTargetMissingMessage(
  kind: "appointments" | "invoices",
): string {
  return kind === "appointments"
    ? "Appointments cannot be imported into the diary here yet. You can check the file now and import it later."
    : "Invoices and balances cannot be imported yet: check the file now, and enter opening balances in Billing for the time being.";
}
