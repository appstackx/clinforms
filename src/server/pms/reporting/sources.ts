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
import type {
  AppointmentFact,
  AttendedPatientsFact,
  AvailabilityFact,
  CourseFact,
  CourseSaleFact,
  DebtFact,
  GiftCardFact,
  ProductSaleFact,
  ReportProduct,
  RevenueFact,
  StockFact,
  VisitFact,
} from "../../../modules/pms/reporting/facts";
export type { ReportingQuery } from "./query";
import type { ReportingQuery } from "./query";

export interface DiaryReportingSource {
  /** Appointments that START in [query.start, query.end), aggregated by UK month, site, room, practitioner and outcome. */
  appointmentFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AppointmentFact[]>;
  /**
   * Practitioners' available time in the period by practitioner, site and UK date: the rota (inside the opening
   * hours, less closures) joined with the time booked, less blocked time – with the booked minutes inside it.
   */
  availabilityFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AvailabilityFact[]>;
  /** Patients who attended in the period, and how many of them for the first time ever (any site). */
  attendedPatients(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<AttendedPatientsFact>;
  /** Attended appointments by UK date, site and practitioner: the patient's first ever (new) or not (returning). */
  visitFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<VisitFact[]>;
}

export interface BillingReportingSource {
  /** Invoiced, credited and received in the period, by UK month, site, practitioner, payer type and kind. */
  revenueFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<RevenueFact[]>;
  /** What is owed NOW (query.now) on unpaid invoices, by payer, site and due date (the period is ignored). */
  debtFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<DebtFact[]>;
  /**
   * PK06: courses still open at the end of query.to (the "as at" date; query.end is the instant it ends), and the
   * courses sold in [query.from, query.to]. [] before the course tables exist.
   */
  courseFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<{ open: CourseFact[]; sold: CourseSaleFact[] }>;
  /** PK06: gift-card moves up to the end of query.to, split before / in the period. [] before the tables exist. */
  giftCardFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<GiftCardFact[]>;
  /** PK06: products sold and credited in the period, by UK date, site and product. */
  productSaleFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<ProductSaleFact[]>;
  /** PK06: stock on hand NOW per site and product (the period is ignored). */
  stockFacts(ctx: RepoContext, tenantId: string, query: ReportingQuery): Promise<StockFact[]>;
  /** PK06: the clinic's products (archived ones too). */
  products(ctx: RepoContext, tenantId: string): Promise<ReportProduct[]>;
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
