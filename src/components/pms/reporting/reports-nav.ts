/**
 * The Reports section of the shell's left navigation (design round 2c: "← Clinic navigation", then APPOINTMENTS /
 * CLINICAL / FINANCE with the reports the member may open). Pure; the clinic layout passes it to shellNav().
 */
import { reportNavLabel, reportsFor } from "@/modules/pms/reporting/catalogue";
import type { PmsPermission } from "@/modules/pms/core/permissions";
import type { ShellSection } from "../shell/nav-model";

export function reportsSection(can: (p: PmsPermission) => boolean): ShellSection[] {
  const groups = reportsFor((p) => can(p)).map((g) => ({
    label: g.group,
    items: g.reports.map((r) => ({ id: `reporting.report.${r.id}`, href: r.href, label: reportNavLabel(r), title: r.title, icon: "reports" as const, exact: false })),
  }));
  return groups.length ? [{ id: "reports", label: "Reports", groups }] : [];
}
