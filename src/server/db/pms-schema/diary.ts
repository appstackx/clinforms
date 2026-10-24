/**
 * Tables of the diary module (owned by the diary builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, DiaryTables, DIARY_TABLES (foreign-key order), DIARY_PRIMARY_KEYS,
 * DIARY_TIMESTAMP_COLUMNS and DIARY_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface DiaryTables {}

export const DIARY_TABLES = [] as const satisfies readonly (keyof DiaryTables)[];

export const DIARY_PRIMARY_KEYS: { readonly [T in (typeof DIARY_TABLES)[number]]: readonly (keyof DiaryTables[T] & string)[] } = {};

export const DIARY_TIMESTAMP_COLUMNS: readonly string[] = [];

export const DIARY_TENANT_TABLES: readonly (typeof DIARY_TABLES)[number][] = DIARY_TABLES;
