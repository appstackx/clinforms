/**
 * Tables of the integration module (owned by the integration builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, IntegrationTables, INTEGRATION_TABLES (foreign-key order), INTEGRATION_PRIMARY_KEYS,
 * INTEGRATION_TIMESTAMP_COLUMNS and INTEGRATION_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface IntegrationTables {}

export const INTEGRATION_TABLES = [] as const satisfies readonly (keyof IntegrationTables)[];

export const INTEGRATION_PRIMARY_KEYS: { readonly [T in (typeof INTEGRATION_TABLES)[number]]: readonly (keyof IntegrationTables[T] & string)[] } = {};

export const INTEGRATION_TIMESTAMP_COLUMNS: readonly string[] = [];

export const INTEGRATION_TENANT_TABLES: readonly (typeof INTEGRATION_TABLES)[number][] = INTEGRATION_TABLES;
