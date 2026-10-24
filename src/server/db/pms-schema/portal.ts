/**
 * Tables of the portal module (owned by the portal builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, PortalTables, PORTAL_TABLES (foreign-key order), PORTAL_PRIMARY_KEYS,
 * PORTAL_TIMESTAMP_COLUMNS and PORTAL_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface PortalTables {}

export const PORTAL_TABLES = [] as const satisfies readonly (keyof PortalTables)[];

export const PORTAL_PRIMARY_KEYS: { readonly [T in (typeof PORTAL_TABLES)[number]]: readonly (keyof PortalTables[T] & string)[] } = {};

export const PORTAL_TIMESTAMP_COLUMNS: readonly string[] = [];

export const PORTAL_TENANT_TABLES: readonly (typeof PORTAL_TABLES)[number][] = PORTAL_TABLES;
