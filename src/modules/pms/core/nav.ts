/**
 * Navigation of the clinic area (/app/clinic). Each module declares its own entries in nav/<module>.ts (it owns
 * that file and nothing else here); the shell (src/app/app/clinic/layout.tsx) shows the entries the member's role
 * allows, and only when the clinic has the "clinic" package. Pure.
 */
import type { PmsModuleId } from "./modules";
import type { PmsPermission } from "./permissions";

export interface PmsNavEntry {
  /** Unique across modules, e.g. "diary.day". */
  id: string;
  module: PmsModuleId;
  /** What it does, in plain words ("Diary", "Patients", "Invoices"). Never a product or vendor name. */
  label: string;
  /** Under /app/clinic. */
  href: string;
  /** Lower first. Bands: foundation 0–9, diary 10–19, records 20–29, billing 30–39, comms 40–49, portal 50–59, reporting 60–69, integration 70–79. */
  order: number;
  /** Shown only to roles with this permission. */
  permission: PmsPermission;
  /** "main" = the top bar; "manage" = the clinic set-up menu (owners and administrators mostly). */
  group: "main" | "manage";
}

export function visibleNav(entries: readonly PmsNavEntry[], can: (permission: PmsPermission) => boolean): PmsNavEntry[] {
  return entries
    .filter((e) => can(e.permission))
    .slice()
    .sort((a, b) => (a.group === b.group ? a.order - b.order || a.label.localeCompare(b.label) : a.group === "main" ? -1 : 1));
}
