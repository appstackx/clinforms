/**
 * The ClinForms database schema: ONE TypeScript source for both dialects (SQLite/D1 and Postgres).
 * See docs/production-architecture.md §2 and docs/database.md.
 *
 * Portable column conventions (kept identical on both dialects by the parity test, db/parity.test.ts):
 * - ids are TEXT;
 * - timestamps are ISO-8601 UTC strings ("2026-10-09T12:00:00.000Z"): TEXT in SQLite/D1, timestamptz in
 *   Postgres (the Postgres dialect parses timestamptz back to the same ISO string);
 * - booleans are INTEGER 0/1 in our own tables;
 * - JSON and ciphertext are TEXT (code parses / decrypts).
 *
 * Only our own tables live here. Better Auth's tables (user, session, account, verification, twoFactor,
 * organization, member, invitation) are added by the auth slice in migration 0002.
 */
import type { ColumnType, Insertable, Selectable } from "kysely";

/** ISO-8601 UTC timestamp string, e.g. "2026-10-09T12:00:00.000Z". */
export type IsoTimestamp = string;

/** A column with a database default: optional on insert. */
type WithDefault<T> = ColumnType<T, T | undefined, T>;

/** `clinic_profile` – one row per tenant (clinic). tenant_id = the organization slug. */
export interface ClinicProfileTable {
  tenant_id: string;
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  /** JSON: the postal address lines. */
  address_json: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  retention_days: WithDefault<number>;
  /** 0/1 */
  drafting_enabled: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `member_profile` – the signer identity of a member of an organization. */
export interface MemberProfileTable {
  organization_id: string;
  user_id: string;
  job_title: string | null;
  hcpc_number: string | null;
  /** 0/1 */
  can_sign: WithDefault<number>;
  updated_at: IsoTimestamp;
}

/** `forms` – a referrer form map (FormDefinition JSON, encrypted). */
export interface FormsTable {
  tenant_id: string;
  id: string;
  rev: number;
  file_sha256: string;
  status: string;
  title: string;
  referrer: string | null;
  kind: string;
  sample_id: string | null;
  /** v1.<kid>.<iv>.<ct> – encrypted FormDefinition JSON (AAD tenant:forms:id). */
  payload_enc: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `form_files` – one row per stored referrer file; content in `form_file_chunks`. */
export interface FormFilesTable {
  tenant_id: string;
  sha256: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  chunk_count: number;
  created_at: IsoTimestamp;
}

/** `form_file_chunks` – ≤ 512 KiB of plaintext per chunk, encrypted (AAD tenant:form_file_chunks:sha256:idx). */
export interface FormFileChunksTable {
  tenant_id: string;
  sha256: string;
  idx: number;
  data_enc: string;
}

/** `reports` – a report (encrypted Report JSON) with an optimistic-concurrency revision. */
export interface ReportsTable {
  tenant_id: string;
  id: string;
  rev: number;
  status: string;
  form_id: string | null;
  template_id: string;
  /** v1.<kid>.<iv>.<ct> – encrypted Report JSON (AAD tenant:reports:id). */
  payload_enc: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  delete_after: IsoTimestamp | null;
}

/** `tenant_settings` – per-tenant settings (referrer → form links). */
export interface TenantSettingsTable {
  tenant_id: string;
  referrer_links_json: string;
  updated_at: IsoTimestamp;
}

/** `audit_log` – append-only (database triggers refuse UPDATE and DELETE). Never PHI. */
export interface AuditLogTable {
  /** ULID (time-ordered). */
  id: string;
  tenant_id: string;
  user_id: string | null;
  session_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail_json: string | null;
  at: IsoTimestamp;
}

/** `partner_keys` – API keys for a clinic system; only the SHA-256 is stored. */
export interface PartnerKeysTable {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  last4: string;
  created_by: string | null;
  created_at: IsoTimestamp;
  revoked_at: IsoTimestamp | null;
}

/** `launch_token_uses` – single-use launch token ids (replaces the in-memory replay cache). */
export interface LaunchTokenUsesTable {
  jti: string;
  expires_at: IsoTimestamp;
}

/** `rate_limits` – fixed-window counters shared by every server instance. */
export interface RateLimitsTable {
  key: string;
  window_start: IsoTimestamp;
  count: number;
}

/** `access_requests` – the landing page's "Request access" form. */
export interface AccessRequestsTable {
  id: string;
  clinic_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  message: string | null;
  created_at: IsoTimestamp;
}

export interface Database {
  clinic_profile: ClinicProfileTable;
  member_profile: MemberProfileTable;
  forms: FormsTable;
  form_files: FormFilesTable;
  form_file_chunks: FormFileChunksTable;
  reports: ReportsTable;
  tenant_settings: TenantSettingsTable;
  audit_log: AuditLogTable;
  partner_keys: PartnerKeysTable;
  launch_token_uses: LaunchTokenUsesTable;
  rate_limits: RateLimitsTable;
  access_requests: AccessRequestsTable;
}

/** Our tables in foreign-key order (parents first): the copy script and the parity test use it. */
export const TABLES_IN_FK_ORDER = [
  "clinic_profile",
  "member_profile",
  "tenant_settings",
  "forms",
  "form_files",
  "form_file_chunks",
  "reports",
  "audit_log",
  "partner_keys",
  "launch_token_uses",
  "rate_limits",
  "access_requests",
] as const satisfies readonly (keyof Database)[];

export type TableName = (typeof TABLES_IN_FK_ORDER)[number];

/** Primary-key columns per table (the copy script orders and checksums rows by them). */
export const PRIMARY_KEYS: { readonly [T in TableName]: readonly (keyof Database[T] & string)[] } = {
  clinic_profile: ["tenant_id"],
  member_profile: ["organization_id", "user_id"],
  tenant_settings: ["tenant_id"],
  forms: ["tenant_id", "id"],
  form_files: ["tenant_id", "sha256"],
  form_file_chunks: ["tenant_id", "sha256", "idx"],
  reports: ["tenant_id", "id"],
  audit_log: ["id"],
  partner_keys: ["id"],
  launch_token_uses: ["jti"],
  rate_limits: ["key", "window_start"],
  access_requests: ["id"],
};

export type ClinicProfileRow = Selectable<ClinicProfileTable>;
export type MemberProfileRow = Selectable<MemberProfileTable>;
export type FormRow = Selectable<FormsTable>;
export type FormFileRow = Selectable<FormFilesTable>;
export type ReportRow = Selectable<ReportsTable>;
export type AuditLogRow = Selectable<AuditLogTable>;
export type PartnerKeyRow = Selectable<PartnerKeysTable>;
export type AccessRequestRow = Selectable<AccessRequestsTable>;
export type NewAuditLogRow = Insertable<AuditLogTable>;
