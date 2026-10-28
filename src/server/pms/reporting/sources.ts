/**
 * Where the reports get the diary's and invoicing's figures. The reporting module never reads another module's
 * tables: the module that owns the data implements a source (aggregated facts – src/modules/pms/reporting/facts.ts)
 * and it is registered here – by default the diary's (src/server/pms/diary/reporting-source.ts) and billing's
 * (src/server/pms/billing/reporting-source.ts). Tests may swap a source (registerReportingSource); with null the
 * reports that need it say so ("These figures come from the diary…") instead of showing empty figures.
 *
 * The reports check every fact they are given (src/modules/pms/reporting/fact-checks.ts) and leave out – and log –
 * any that break the contract, so a faulty source cannot show another site's figures.
 */
import "server-only";
import type { RepoContext } from "../../repos/context";
import { BILLING_REPORTING_SOURCE } from "../billing/reporting-source";
import { DIARY_REPORTING_SOURCE } from "../diary/reporting-source";
import type { AppointmentFact, AttendedPatientsFact, AvailabilityFact, DebtFact, RevenueFact } from "../../../modules/pms/reporting/facts";
export type { ReportingQuery } from "./query";
import type { ReportingQuery } from "./query";

export interface DiaryReportingSource {
  /** Appointments that START in [query.start, query.end), aggregated by UK month, site, room, practitioner and outcome. */
  appointmentFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AppointmentFact[]>;
  /** Practitioners' working time in the period from the rota, by practitioner, site and UK month. */
  availabilityFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AvailabilityFact[]>;
  /** Patients who attended in the period, and how many of them for the first time ever (any site). */
  attendedPatients(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AttendedPatientsFact>;
}

export interface BillingReportingSource {
  /** Invoiced, credited and received in the period, by UK month, site, practitioner, payer type and kind. */
  revenueFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<RevenueFact[]>;
  /** What is owed NOW (query.now) on unpaid invoices, by payer, site and due date (the period is ignored). */
  debtFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<DebtFact[]>;
}

export interface ReportingSources {
  diary: DiaryReportingSource | null;
  billing: BillingReportingSource | null;
}

const DEFAULT_SOURCES: ReportingSources = { diary: DIARY_REPORTING_SOURCE, billing: BILLING_REPORTING_SOURCE };

let current: ReportingSources = { ...DEFAULT_SOURCES };

/** The sources the reports use. */
export function reportingSources(): ReportingSources {
  return current;
}

/** Registers (or clears, with null) a module's source. For integration wiring and tests. */
export function registerReportingSource<K extends keyof ReportingSources>(kind: K, source: ReportingSources[K]): void {
  current = { ...current, [kind]: source };
}

/** Back to the built-in sources (tests). */
export function resetReportingSources(): void {
  current = { ...DEFAULT_SOURCES };
}
