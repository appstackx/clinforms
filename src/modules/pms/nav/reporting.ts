/**
 * Navigation entries of the reporting and set-up module (owned by the reporting builder – contract §3). Band 60–69.
 * "Reports" in the main list (own caseload or all reports). The set-up pages are "manage" entries: the shell shows
 * them in the Set-up area (design round 2c: "← Clinic navigation / Set-up"), together with the other modules'
 * set-up pages (staff access, rotas, note templates, message settings, online booking, intake forms).
 */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const REPORTS_NAV_PATH = `${CLINIC_BASE_PATH}/reports`;
export const SETUP_NAV_PATH = `${CLINIC_BASE_PATH}/setup`;

export const REPORTING_NAV: readonly PmsNavEntry[] = [
  { id: "reporting.reports", module: "reporting", label: "Reports", href: REPORTS_NAV_PATH, order: 60, permission: ["reports.own", "reports.all"], group: "main" },
  { id: "reporting.sites", module: "reporting", label: "Sites and hours", href: `${SETUP_NAV_PATH}/sites`, order: 61, permission: "settings.setup", group: "manage" },
  { id: "reporting.rooms", module: "reporting", label: "Rooms", href: `${SETUP_NAV_PATH}/rooms`, order: 62, permission: "settings.setup", group: "manage" },
  { id: "reporting.services", module: "reporting", label: "Services", href: `${SETUP_NAV_PATH}/services`, order: 63, permission: "settings.setup", group: "manage" },
  { id: "reporting.prices", module: "reporting", label: "Price lists", href: `${SETUP_NAV_PATH}/prices`, order: 64, permission: "settings.setup", group: "manage" },
  { id: "reporting.referrers", module: "reporting", label: "Referrers and insurers", href: `${SETUP_NAV_PATH}/referrers`, order: 65, permission: "settings.setup", group: "manage" },
  { id: "reporting.practitioners", module: "reporting", label: "Practitioners", href: `${SETUP_NAV_PATH}/practitioners`, order: 66, permission: "settings.setup", group: "manage" },
  { id: "reporting.records", module: "reporting", label: "Record templates", href: `${SETUP_NAV_PATH}/records`, order: 66, permission: "settings.setup", group: "manage" },
  { id: "reporting.billing", module: "reporting", label: "Billing settings", href: `${SETUP_NAV_PATH}/billing`, order: 67, permission: "settings.setup", group: "manage" },
  { id: "reporting.audit", module: "reporting", label: "Audit trail", href: `${SETUP_NAV_PATH}/audit`, order: 68, permission: "settings.members", group: "manage" },
  { id: "reporting.targets", module: "reporting", label: "Report targets", href: `${SETUP_NAV_PATH}/targets`, order: 68, permission: "settings.setup", group: "manage" },
  { id: "reporting.import", module: "reporting", label: "Import data", href: `${SETUP_NAV_PATH}/import`, order: 69, permission: "settings.import", group: "manage" },
];
