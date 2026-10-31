/**
 * The clinic system's part of the Database interface, composed from one file per module (orchestrator-owned
 * aggregator: each builder edits only pms-schema/<module>.ts). src/server/db/schema.ts merges it into Database,
 * TABLES_IN_FK_ORDER and PRIMARY_KEYS, so the parity test, the D1 → Postgres copy and offboarding see every table.
 */
import { BILLING_PRIMARY_KEYS, BILLING_TABLES, BILLING_TENANT_TABLES, BILLING_TIMESTAMP_COLUMNS, type BillingTables } from "./billing";
import { COMMS_PRIMARY_KEYS, COMMS_TABLES, COMMS_TENANT_TABLES, COMMS_TIMESTAMP_COLUMNS, type CommsTables } from "./comms";
import { DIARY_PRIMARY_KEYS, DIARY_TABLES, DIARY_TENANT_TABLES, DIARY_TIMESTAMP_COLUMNS, type DiaryTables } from "./diary";
import { FOUNDATION_PRIMARY_KEYS, FOUNDATION_TABLES, FOUNDATION_TENANT_TABLES, FOUNDATION_TIMESTAMP_COLUMNS, type FoundationTables } from "./foundation";
import {
  INTEGRATION_PRIMARY_KEYS,
  INTEGRATION_TABLES,
  INTEGRATION_TENANT_TABLES,
  INTEGRATION_TIMESTAMP_COLUMNS,
  type IntegrationTables,
} from "./integration";
import { PORTAL_PRIMARY_KEYS, PORTAL_TABLES, PORTAL_TENANT_TABLES, PORTAL_TIMESTAMP_COLUMNS, type PortalTables } from "./portal";
import { RECORDS_PRIMARY_KEYS, RECORDS_TABLES, RECORDS_TENANT_TABLES, RECORDS_TIMESTAMP_COLUMNS, type RecordsTables } from "./records";
import { REPORTING_PRIMARY_KEYS, REPORTING_TABLES, REPORTING_TENANT_TABLES, REPORTING_TIMESTAMP_COLUMNS, type ReportingTables } from "./reporting";

export type { FoundationTables } from "./foundation";

export interface PmsDatabase
  extends FoundationTables,
    DiaryTables,
    RecordsTables,
    BillingTables,
    CommsTables,
    PortalTables,
    ReportingTables,
    IntegrationTables {}

/** Every clinic-system table in foreign-key order (modules in migration order: foundation first). */
export const PMS_TABLES_IN_FK_ORDER = [
  ...FOUNDATION_TABLES,
  ...DIARY_TABLES,
  ...RECORDS_TABLES,
  ...BILLING_TABLES,
  ...COMMS_TABLES,
  ...PORTAL_TABLES,
  ...REPORTING_TABLES,
  ...INTEGRATION_TABLES,
] as const satisfies readonly (keyof PmsDatabase)[];

export type PmsTableName = (typeof PMS_TABLES_IN_FK_ORDER)[number];

export const PMS_PRIMARY_KEYS: { readonly [T in PmsTableName]: readonly (keyof PmsDatabase[T] & string)[] } = {
  ...FOUNDATION_PRIMARY_KEYS,
  ...DIARY_PRIMARY_KEYS,
  ...RECORDS_PRIMARY_KEYS,
  ...BILLING_PRIMARY_KEYS,
  ...COMMS_PRIMARY_KEYS,
  ...PORTAL_PRIMARY_KEYS,
  ...REPORTING_PRIMARY_KEYS,
  ...INTEGRATION_PRIMARY_KEYS,
};

export const PMS_TIMESTAMP_COLUMNS: readonly string[] = [
  ...FOUNDATION_TIMESTAMP_COLUMNS,
  ...DIARY_TIMESTAMP_COLUMNS,
  ...RECORDS_TIMESTAMP_COLUMNS,
  ...BILLING_TIMESTAMP_COLUMNS,
  ...COMMS_TIMESTAMP_COLUMNS,
  ...PORTAL_TIMESTAMP_COLUMNS,
  ...REPORTING_TIMESTAMP_COLUMNS,
  ...INTEGRATION_TIMESTAMP_COLUMNS,
];

/** Per-clinic tables (offboarding exports them decrypted, then deletes them in reverse order). */
export const PMS_TENANT_TABLES: readonly PmsTableName[] = [
  ...FOUNDATION_TENANT_TABLES,
  ...DIARY_TENANT_TABLES,
  ...RECORDS_TENANT_TABLES,
  ...BILLING_TENANT_TABLES,
  ...COMMS_TENANT_TABLES,
  ...PORTAL_TENANT_TABLES,
  ...REPORTING_TENANT_TABLES,
  ...INTEGRATION_TENANT_TABLES,
];
