/**
 * Tables of the billing module (owned by the billing builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, BillingTables, BILLING_TABLES (foreign-key order), BILLING_PRIMARY_KEYS,
 * BILLING_TIMESTAMP_COLUMNS and BILLING_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface BillingTables {}

export const BILLING_TABLES = [] as const satisfies readonly (keyof BillingTables)[];

export const BILLING_PRIMARY_KEYS: { readonly [T in (typeof BILLING_TABLES)[number]]: readonly (keyof BillingTables[T] & string)[] } = {};

export const BILLING_TIMESTAMP_COLUMNS: readonly string[] = [];

export const BILLING_TENANT_TABLES: readonly (typeof BILLING_TABLES)[number][] = BILLING_TABLES;
