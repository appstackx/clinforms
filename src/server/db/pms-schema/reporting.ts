/**
 * Tables of the reporting module (owned by the reporting builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, ReportingTables, REPORTING_TABLES (foreign-key order), REPORTING_PRIMARY_KEYS,
 * REPORTING_TIMESTAMP_COLUMNS and REPORTING_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface ReportingTables {}

export const REPORTING_TABLES = [] as const satisfies readonly (keyof ReportingTables)[];

export const REPORTING_PRIMARY_KEYS: { readonly [T in (typeof REPORTING_TABLES)[number]]: readonly (keyof ReportingTables[T] & string)[] } = {};

export const REPORTING_TIMESTAMP_COLUMNS: readonly string[] = [];

export const REPORTING_TENANT_TABLES: readonly (typeof REPORTING_TABLES)[number][] = REPORTING_TABLES;
