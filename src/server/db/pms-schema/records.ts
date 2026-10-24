/**
 * Tables of the records module (owned by the records builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, RecordsTables, RECORDS_TABLES (foreign-key order), RECORDS_PRIMARY_KEYS,
 * RECORDS_TIMESTAMP_COLUMNS and RECORDS_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface RecordsTables {}

export const RECORDS_TABLES = [] as const satisfies readonly (keyof RecordsTables)[];

export const RECORDS_PRIMARY_KEYS: { readonly [T in (typeof RECORDS_TABLES)[number]]: readonly (keyof RecordsTables[T] & string)[] } = {};

export const RECORDS_TIMESTAMP_COLUMNS: readonly string[] = [];

export const RECORDS_TENANT_TABLES: readonly (typeof RECORDS_TABLES)[number][] = RECORDS_TABLES;
