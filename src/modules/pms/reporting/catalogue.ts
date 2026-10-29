/**
 * The fixed reports of the clinic system (design round 2c, "Reports"): what each shows, where it lives, its group in
 * the reports' left navigation and who may open it (pure).
 *
 * Who: "View all reports" (reports.all) opens every report for the sites the member may see. "See reports for own
 * caseload" (reports.own – clinicians by default) opens the appointment and clinical reports limited to the
 * member's own practitioner; the finance reports need reports.all. CSV downloads need "Export data"
 * (reports.export).
 */
import { CLINIC_BASE_PATH } from "../core/modules";

export const REPORT_IDS = ["attendance", "utilisation", "patients", "caseload", "revenue", "debtors", "authorisations"] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export const REPORT_GROUPS = ["Appointments", "Clinical", "Finance"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export interface ReportInfo {
  id: ReportId;
  title: string;
  /** One line under the title. */
  description: string;
  href: string;
  group: ReportGroup;
  /** May a member with reports.own (and not reports.all) open it, limited to their own practitioner? */
  ownCaseload: boolean;
  /** Filters offered besides the site. */
  filters: { period: boolean; practitioner: boolean; service: boolean };
}

export const REPORTS_PATH = `${CLINIC_BASE_PATH}/reports`;
export const REPORT_EXPORT_PATH = `${REPORTS_PATH}/export`;
export const SETUP_PATH = `${CLINIC_BASE_PATH}/setup`;
export const AUDIT_PATH = `${SETUP_PATH}/audit`;
export const AUDIT_EXPORT_PATH = `${SETUP_PATH}/audit/export`;

export const REPORTS: Readonly<Record<ReportId, ReportInfo>> = {
  attendance: {
    id: "attendance",
    title: "Attendance and DNA",
    description: "How many booked appointments were attended, missed or cancelled late.",
    href: `${REPORTS_PATH}/attendance`,
    group: "Appointments",
    ownCaseload: true,
    filters: { period: true, practitioner: true, service: true },
  },
  utilisation: {
    id: "utilisation",
    title: "Utilisation",
    description: "Booked time as a share of rota time.",
    href: `${REPORTS_PATH}/utilisation`,
    group: "Appointments",
    ownCaseload: true,
    filters: { period: true, practitioner: true, service: false },
  },
  patients: {
    id: "patients",
    title: "New and returning patients",
    description: "Patients seen, and how many came for the first time.",
    href: `${REPORTS_PATH}/patients`,
    group: "Appointments",
    ownCaseload: true,
    filters: { period: true, practitioner: true, service: false },
  },
  caseload: {
    id: "caseload",
    title: "Caseload",
    description: "Open cases per practitioner and how they are moving.",
    href: `${REPORTS_PATH}/caseload`,
    group: "Clinical",
    ownCaseload: true,
    filters: { period: true, practitioner: true, service: false },
  },
  revenue: {
    id: "revenue",
    title: "Revenue",
    description: "Invoiced income by month, patient and insurer combined.",
    href: `${REPORTS_PATH}/revenue`,
    group: "Finance",
    ownCaseload: false,
    filters: { period: true, practitioner: false, service: false },
  },
  debtors: {
    id: "debtors",
    title: "Debtors",
    description: "Money owed today, by age.",
    href: `${REPORTS_PATH}/debtors`,
    group: "Finance",
    ownCaseload: false,
    filters: { period: false, practitioner: false, service: false },
  },
  authorisations: {
    id: "authorisations",
    title: "Authorisations",
    description: "Insured cases close to their session limit or expiry.",
    href: `${REPORTS_PATH}/authorisations`,
    group: "Finance",
    ownCaseload: false,
    filters: { period: false, practitioner: false, service: false },
  },
};

export function isReportId(value: unknown): value is ReportId {
  return typeof value === "string" && (REPORT_IDS as readonly string[]).includes(value);
}

type ReportPermission = "reports.all" | "reports.own" | "reports.export";

/** How a member may open a report: every row in their sites ("all"), only their own caseload ("own"), or not at all. */
export type ReportAccess = "all" | "own" | null;

export function reportAccess(id: ReportId, can: (permission: ReportPermission) => boolean): ReportAccess {
  if (can("reports.all")) return "all";
  if (REPORTS[id].ownCaseload && can("reports.own")) return "own";
  return null;
}

/** The reports a member may open, in the navigation's order, grouped (empty groups left out). */
export function reportsFor(can: (permission: ReportPermission) => boolean): { group: ReportGroup; reports: ReportInfo[] }[] {
  return REPORT_GROUPS.map((group) => ({ group, reports: REPORT_IDS.map((id) => REPORTS[id]).filter((r) => r.group === group && reportAccess(r.id, can) !== null) })).filter((g) => g.reports.length > 0);
}
