/**
 * Tables of the reporting and set-up module (migration 0160 / 20261024000160 – docs/clinic-system/reporting.md):
 * opening hours and closures of the sites, and which sites a member works at. Set-up rows, not clinical
 * records. Conventions: docs/clinic-system/contract.md §4.
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

/** One opening session of a site on a weekday (a site's week is replaced as a whole). */
export interface PmsSiteHoursTable {
  tenant_id: string;
  id: string;
  site_id: string;
  /** 1 Monday … 7 Sunday */
  weekday: number;
  /** "HH:MM", UK local time */
  opens_at: string;
  closes_at: string;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** A closure of one site (site_id) or every site (site_id null), both dates included. */
export interface PmsSiteClosuresTable {
  tenant_id: string;
  id: string;
  site_id: string | null;
  starts_on: IsoDate;
  ends_on: IsoDate;
  reason: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** A member's site access (no row = every site). write_token makes the revisioned replace atomic on D1. */
export interface PmsStaffAccessTable {
  tenant_id: string;
  user_id: string;
  all_sites: WithDefault<number>;
  rev: WithDefault<number>;
  write_token: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** The sites of a member whose access is limited (all_sites = 0). */
export interface PmsStaffSitesTable {
  tenant_id: string;
  user_id: string;
  site_id: string;
}

export interface ReportingTables {
  pms_site_hours: PmsSiteHoursTable;
  pms_site_closures: PmsSiteClosuresTable;
  pms_staff_access: PmsStaffAccessTable;
  pms_staff_sites: PmsStaffSitesTable;
}

/** Foreign-key order (parents first; the foundation's pms_sites comes before every module). */
export const REPORTING_TABLES = ["pms_site_hours", "pms_site_closures", "pms_staff_access", "pms_staff_sites"] as const satisfies readonly (keyof ReportingTables)[];

export const REPORTING_PRIMARY_KEYS: { readonly [T in (typeof REPORTING_TABLES)[number]]: readonly (keyof ReportingTables[T] & string)[] } = {
  pms_site_hours: ["tenant_id", "id"],
  pms_site_closures: ["tenant_id", "id"],
  pms_staff_access: ["tenant_id", "user_id"],
  pms_staff_sites: ["tenant_id", "user_id", "site_id"],
};

/** Timestamp columns besides created_at / updated_at (none). */
export const REPORTING_TIMESTAMP_COLUMNS: readonly string[] = [];

/** Every table is per clinic (offboarding exports and deletes them; none holds encrypted columns). */
export const REPORTING_TENANT_TABLES: readonly (typeof REPORTING_TABLES)[number][] = REPORTING_TABLES;
