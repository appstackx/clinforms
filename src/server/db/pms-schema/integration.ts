/**
 * Tables of the integration module (owned by the integration builder – docs/clinic-system/contract.md §3–4):
 * migration 0170 / 20261024000170.
 *
 *   pms_import_batches     one import run: one CSV file of one kind (patients, cases, appointments, invoices)
 *   pms_import_rows        its rows, staged with their values encrypted (data_enc) until imported, then wiped
 *   pms_form_requests      "Complete referrer form" started from a case: the referrer and the consent to share
 *   pms_filed_forms        approved referrer forms filed back to the patient's record (clinical records: kept)
 *   pms_filed_form_parts   the filed file in encrypted parts (≤ 384 KiB each, base64 inside the envelope)
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

export interface PmsImportBatchesTable {
  tenant_id: string;
  id: string;
  rev: number;
  /** "patients" | "cases" | "appointments" | "invoices" */
  kind: string;
  /** src/modules/pms/integration/import-status.ts BATCH_STATUSES */
  status: string;
  file_name_enc: string | null;
  file_sha256: string | null;
  /** "," | ";" | "tab" */
  delimiter: WithDefault<string>;
  /** JSON array of the column names, encrypted. */
  headers_enc: string | null;
  column_count: number;
  expected_rows: number;
  row_count: WithDefault<number>;
  /** Field key → column index (no data). */
  mapping_json: string | null;
  /** BatchCounts (numbers only). */
  counts_json: string | null;
  /** While a step (check, import, undo) works on a page of rows: until when it holds the batch (one worker at a time). */
  lease_until: IsoTimestamp | null;
  /** Ids of the referrers and payers the import added to the directory. */
  directory_added_json: string | null;
  created_by: string | null;
  checked_by: string | null;
  checked_at: IsoTimestamp | null;
  approved_by: string | null;
  approved_at: IsoTimestamp | null;
  imported_by: string | null;
  imported_at: IsoTimestamp | null;
  undone_by: string | null;
  undone_at: IsoTimestamp | null;
  cancelled_by: string | null;
  cancelled_at: IsoTimestamp | null;
  closed_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsImportRowsTable {
  tenant_id: string;
  id: string;
  batch_id: string;
  row_no: number;
  /** JSON array of the row's cells, encrypted; null once imported, cancelled or closed. */
  data_enc: string | null;
  /** The earlier system's reference (an id – no personal data), set by the check. */
  source_ref: string | null;
  /** import-status.ts ROW_STATUSES */
  status: WithDefault<string>;
  /** RowIssue[] – codes and field keys only. */
  issues_json: string | null;
  /** The patient the row is (patients) or belongs to (the other kinds), once known. */
  patient_id: string | null;
  /** The case the row is (cases) or belongs to (appointments, invoices), once known. */
  case_id: string | null;
  target_id: string | null;
  target_rev: number | null;
  /** Ids of further records the row made, e.g. {"authorisationId": "auth_…"}. */
  extra_json: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsFormRequestsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  case_id: string;
  referrer_id: string | null;
  consent_recorded: WithDefault<number>;
  consent_on: IsoDate | null;
  consent_note_enc: string | null;
  /** The ClinForms form chosen (its id in the clinic's library) and its title (plain, for lists). */
  form_ref: string | null;
  form_title: string | null;
  /** 1 when the member may see clinical notes: signed notes and outcome scores were offered to ClinForms. */
  clinical_prefill: WithDefault<number>;
  /** "opened" | "filed" */
  status: WithDefault<string>;
  filed_form_id: string | null;
  filed_at: IsoTimestamp | null;
  requested_by: string | null;
  created_at: IsoTimestamp;
}

export interface PmsFiledFormsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  case_id: string;
  title: string;
  file_name_enc: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  part_count: number;
  complete: WithDefault<number>;
  report_id: string;
  /** The approval receipt as ClinForms issued it (ids, signer, times, content hash – no patient data). */
  receipt_json: string;
  signer_name: string | null;
  signer_registration: string | null;
  signed_at: IsoTimestamp | null;
  /** The "Complete referrer form" request the form was opened from (when known). */
  form_request_id: string | null;
  filed_by: string | null;
  filed_at: IsoTimestamp;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsFiledFormPartsTable {
  tenant_id: string;
  id: string;
  filed_form_id: string;
  idx: number;
  data_enc: string;
  created_at: IsoTimestamp;
}

export interface IntegrationTables {
  pms_import_batches: PmsImportBatchesTable;
  pms_import_rows: PmsImportRowsTable;
  pms_form_requests: PmsFormRequestsTable;
  pms_filed_forms: PmsFiledFormsTable;
  pms_filed_form_parts: PmsFiledFormPartsTable;
}

/** Foreign-key order (parents first). */
export const INTEGRATION_TABLES = ["pms_import_batches", "pms_import_rows", "pms_form_requests", "pms_filed_forms", "pms_filed_form_parts"] as const satisfies readonly (keyof IntegrationTables)[];

export const INTEGRATION_PRIMARY_KEYS: { readonly [T in (typeof INTEGRATION_TABLES)[number]]: readonly (keyof IntegrationTables[T] & string)[] } = {
  pms_import_batches: ["tenant_id", "id"],
  pms_import_rows: ["tenant_id", "id"],
  pms_form_requests: ["tenant_id", "id"],
  pms_filed_forms: ["tenant_id", "id"],
  pms_filed_form_parts: ["tenant_id", "id"],
};

/** Timestamp columns beyond created_at/updated_at (TEXT in SQLite, timestamptz in Postgres) – for the D1 → Postgres copy. */
export const INTEGRATION_TIMESTAMP_COLUMNS: readonly string[] = ["lease_until", "checked_at", "approved_at", "imported_at", "undone_at", "cancelled_at", "closed_at", "signed_at", "filed_at"];

/** Every integration table holds one clinic's data (offboarding exports them decrypted, then deletes them). */
export const INTEGRATION_TENANT_TABLES: readonly (typeof INTEGRATION_TABLES)[number][] = INTEGRATION_TABLES;
