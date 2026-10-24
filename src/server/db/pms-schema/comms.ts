/**
 * Tables of the comms module (owned by the comms builder – docs/clinic-system/contract.md §3–4).
 * Fill in: the table interfaces, CommsTables, COMMS_TABLES (foreign-key order), COMMS_PRIMARY_KEYS,
 * COMMS_TIMESTAMP_COLUMNS and COMMS_TENANT_TABLES. Migrations: see src/modules/pms/core/modules.ts.
 */

export interface CommsTables {}

export const COMMS_TABLES = [] as const satisfies readonly (keyof CommsTables)[];

export const COMMS_PRIMARY_KEYS: { readonly [T in (typeof COMMS_TABLES)[number]]: readonly (keyof CommsTables[T] & string)[] } = {};

export const COMMS_TIMESTAMP_COLUMNS: readonly string[] = [];

export const COMMS_TENANT_TABLES: readonly (typeof COMMS_TABLES)[number][] = COMMS_TABLES;
