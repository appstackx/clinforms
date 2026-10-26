/**
 * The fixed reports of the clinic system: what each shows, where it lives, who may see it and which data it
 * needs (pure). The reports page lists them; a report whose data is not in use at the clinic yet (no diary or
 * no invoicing) says so instead of showing empty figures.
 */
import { CLINIC_BASE_PATH } from "../core/modules";
import type { PmsPermission } from "../core/permissions";

export const REPORT_IDS = ["utilisation", "attendance", "patients", "revenue", "debtors", "authorisations", "caseload"] as const;
export type ReportId = (typeof REPORT_IDS)[number];

/** Data a report reads: the shared record (always there), the diary's appointments, invoicing. */
export type ReportNeed = "record" | "diary" | "billing";

export interface ReportInfo {
  id: ReportId;
  title: string;
  summary: string;
  href: string;
  permission: PmsPermission;
  needs: readonly ReportNeed[];
  /** Has a CSV download. */
  csv: boolean;
}

export const REPORTS_PATH = `${CLINIC_BASE_PATH}/reports`;
export const REPORT_EXPORT_PATH = `${REPORTS_PATH}/export`;
export const SETUP_PATH = `${CLINIC_BASE_PATH}/setup`;
export const AUDIT_PATH = `${SETUP_PATH}/audit`;
export const AUDIT_EXPORT_PATH = `${SETUP_PATH}/audit/export`;

export const REPORTS: Readonly<Record<ReportId, ReportInfo>> = {
  utilisation: {
    id: "utilisation",
    title: "Utilisation",
    summary: "Booked time against available time, by practitioner, site and room.",
    href: `${REPORTS_PATH}/utilisation`,
    permission: "reports.view",
    needs: ["diary"],
    csv: true,
  },
  attendance: {
    id: "attendance",
    title: "Attendance",
    summary: "Did-not-attend and late-cancellation rates, by practitioner, site and month.",
    href: `${REPORTS_PATH}/attendance`,
    permission: "reports.view",
    needs: ["diary"],
    csv: true,
  },
  patients: {
    id: "patients",
    title: "New and returning patients",
    summary: "New patients against returning ones, registrations and referral sources.",
    href: `${REPORTS_PATH}/patients`,
    permission: "reports.view",
    needs: ["record"],
    csv: true,
  },
  revenue: {
    id: "revenue",
    title: "Revenue",
    summary: "Invoiced, credited and received, by month, site and payer.",
    href: `${REPORTS_PATH}/revenue`,
    permission: "reports.view",
    needs: ["billing"],
    csv: true,
  },
  debtors: {
    id: "debtors",
    title: "Outstanding debt",
    summary: "What insurers, medico-legal companies and patients still owe, by age.",
    href: `${REPORTS_PATH}/debtors`,
    permission: "reports.view",
    needs: ["billing"],
    csv: true,
  },
  authorisations: {
    id: "authorisations",
    title: "Authorisations to act on",
    summary: "Treatment authorisations expiring soon, recently expired or nearly used up.",
    href: `${REPORTS_PATH}/authorisations`,
    permission: "reports.view",
    needs: ["record"],
    csv: true,
  },
  caseload: {
    id: "caseload",
    title: "Caseload",
    summary: "Open cases by practitioner, site and payer, and cases opened in the period.",
    href: `${REPORTS_PATH}/caseload`,
    permission: "reports.view",
    needs: ["record"],
    csv: true,
  },
};

export function isReportId(value: unknown): value is ReportId {
  return typeof value === "string" && (REPORT_IDS as readonly string[]).includes(value);
}
