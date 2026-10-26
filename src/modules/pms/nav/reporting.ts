/** Navigation entries of the reporting and set-up module (owned by the reporting builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const REPORTING_NAV: readonly PmsNavEntry[] = [
  { id: "reporting.reports", module: "reporting", label: "Reports", href: `${CLINIC_BASE_PATH}/reports`, order: 60, permission: "reports.view", group: "main" },
  // Owners and administrators see every set-up page; practitioners and reception only the referrers and payers.
  { id: "reporting.setup", module: "reporting", label: "Clinic set-up", href: `${CLINIC_BASE_PATH}/setup`, order: 65, permission: "directory.edit", group: "manage" },
];
