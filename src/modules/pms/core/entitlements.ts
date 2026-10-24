/**
 * Packages a clinic can have (entitlements). Pure rules shared by the server (requireEntitlement), the
 * platform page and the admin script. Labels shown to people live in src/lib/brand.ts (PACKAGE_LABELS).
 *
 * Semantics (docs/clinic-system/contract.md §5):
 * - no row for a package = its default: "reports" ON (every clinic that existed before entitlements keeps
 *   ClinForms exactly as it was), "clinic" OFF;
 * - a row is ON while its status is "active" or "trial" and its end (if any) has not passed;
 * - "paused" and "cancelled" are OFF. Switching a package off never deletes data.
 */

export const PACKAGE_IDS = ["reports", "clinic"] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

export const ENTITLEMENT_STATUSES = ["active", "trial", "paused", "cancelled"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/** Where the price came from (contracts): list price, founding-clinic price or design-partner price. */
export const PRICE_SOURCES = ["list", "founding", "design_partner"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const PACKAGE_DEFAULT_ON: Readonly<Record<PackageId, boolean>> = { reports: true, clinic: false };

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === "string" && (PACKAGE_IDS as readonly string[]).includes(value);
}

export function isEntitlementStatus(value: unknown): value is EntitlementStatus {
  return typeof value === "string" && (ENTITLEMENT_STATUSES as readonly string[]).includes(value);
}

export function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value);
}

/** The parts of an entitlement row the on/off rule needs. */
export interface EntitlementState {
  status: EntitlementStatus;
  /** ISO timestamp; null = open-ended. */
  endsAt: string | null;
}

export function statusIsOn(status: EntitlementStatus): boolean {
  return status === "active" || status === "trial";
}

/** Whether a package is on for a clinic, given its row (or null when the clinic has none). */
export function packageIsOn(pkg: PackageId, row: EntitlementState | null | undefined, now: Date = new Date()): boolean {
  if (!row) return PACKAGE_DEFAULT_ON[pkg];
  if (!statusIsOn(row.status)) return false;
  if (row.endsAt) {
    const end = Date.parse(row.endsAt);
    if (!Number.isNaN(end) && end <= now.getTime()) return false;
  }
  return true;
}

/**
 * Usage counter metrics: lower_snake_case. Known today: forms_completed, practitioners_active, sms_segments,
 * emails_sent, online_bookings. Modules may count new metrics without changing this file.
 */
export const USAGE_METRIC_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

/** "YYYY-MM" of a date in UTC (the counters' period). */
export function usagePeriod(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}
