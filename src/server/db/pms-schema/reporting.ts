/**
 * Tables of the reporting and set-up module (migration 0160 / 20261024000160 – docs/clinic-system/reporting.md):
 * opening hours and closures of the sites (the one opening-hours source) and the clinic's report targets. Set-up rows, not clinical
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

/** The clinic's report targets (one row per clinic; no row = the defaults 80 % and 4.0 %). */
export interface PmsReportingSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  utilisation_target_percent: WithDefault<number>;
  /** The DNA-rate target in tenths of a percent (40 = 4.0 %). */
  dna_target_tenths: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ReportingTables {
  pms_site_hours: PmsSiteHoursTable;
  pms_site_closures: PmsSiteClosuresTable;
  pms_reporting_settings: PmsReportingSettingsTable;
}

/** Foreign-key order (parents first; the foundation's pms_sites comes before every module). */
export const REPORTING_TABLES = ["pms_site_hours", "pms_site_closures", "pms_reporting_settings"] as const satisfies readonly (keyof ReportingTables)[];

export const REPORTING_PRIMARY_KEYS: { readonly [T in (typeof REPORTING_TABLES)[number]]: readonly (keyof ReportingTables[T] & string)[] } = {
  pms_site_hours: ["tenant_id", "id"],
  pms_site_closures: ["tenant_id", "id"],
  pms_reporting_settings: ["tenant_id"],
};

/** Timestamp columns besides created_at / updated_at (none). */
export const REPORTING_TIMESTAMP_COLUMNS: readonly string[] = [];

/** Every table is per clinic (offboarding exports and deletes them; none holds encrypted columns). */
export const REPORTING_TENANT_TABLES: readonly (typeof REPORTING_TABLES)[number][] = REPORTING_TABLES;
