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
 * Better Auth's tables (user, session, account, verification, twoFactor, organization, member, invitation,
 * rateLimit) come from migration 0002, generated per dialect by Better Auth itself
 * (scripts/db/gen-auth-migrations.ts): camelCase columns; booleans INTEGER 0/1 in SQLite/D1 and boolean in
 * Postgres; dates ISO TEXT in SQLite/D1 and timestamptz in Postgres (read back as ISO strings through
 * getDb(); src/server/auth/pg-dates.ts turns them into Dates for Better Auth only). Better Auth owns
 * writes to them – our code reads them (and the platform scripts write a few rows through Better Auth's
 * adapter).
 */
import type { ColumnType, Insertable, Selectable } from "kysely";

/** ISO-8601 UTC timestamp string, e.g. "2026-10-09T12:00:00.000Z". */
export type IsoTimestamp = string;

/** A column with a database default: optional on insert. */
type WithDefault<T> = ColumnType<T, T | undefined, T>;

/** Better Auth boolean: 0/1 in SQLite/D1, boolean in Postgres. Read with `authBool()`. */
export type AuthBoolean = number | boolean;

/* ------------------------------------------------------------------------------------------------
 * Better Auth tables (migration 0002). Column names are Better Auth's (camelCase).
 * ----------------------------------------------------------------------------------------------*/

export interface AuthUserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: AuthBoolean;
  image: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  twoFactorEnabled: AuthBoolean | null;
}

export interface AuthSessionTable {
  id: string;
  expiresAt: IsoTimestamp;
  token: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  activeOrganizationId: string | null;
}

export interface AuthAccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: IsoTimestamp | null;
  refreshTokenExpiresAt: IsoTimestamp | null;
  scope: string | null;
  password: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AuthVerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AuthTwoFactorTable {
  id: string;
  secret: string;
  backupCodes: string;
  userId: string;
  verified: AuthBoolean | null;
  failedVerificationCount: number | null;
  lockedUntil: IsoTimestamp | null;
}

export interface AuthOrganizationTable {
  id: string;
  name: string;
  /** = tenantId (immutable). */
  slug: string;
  logo: string | null;
  createdAt: IsoTimestamp;
  metadata: string | null;
}

export interface AuthMemberTable {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: IsoTimestamp;
}

export interface AuthInvitationTable {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  inviterId: string;
}

export interface AuthRateLimitTable {
  id: string;
  key: string;
  count: number;
  lastRequest: number;
}

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
  /** When ClinForms staff marked the request as contacted (migration 0004); null = not yet. */
  contacted_at: IsoTimestamp | null;
}

export interface Database {
  user: AuthUserTable;
  session: AuthSessionTable;
  account: AuthAccountTable;
  verification: AuthVerificationTable;
  twoFactor: AuthTwoFactorTable;
  organization: AuthOrganizationTable;
  member: AuthMemberTable;
  invitation: AuthInvitationTable;
  rateLimit: AuthRateLimitTable;
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

/** Better Auth's tables in foreign-key order (parents first). */
export const AUTH_TABLES_IN_FK_ORDER = [
  "user",
  "organization",
  "session",
  "account",
  "verification",
  "twoFactor",
  "member",
  "invitation",
  "rateLimit",
] as const satisfies readonly (keyof Database)[];

/** Every table in foreign-key order (parents first): the copy script and the parity test use it. */
export const TABLES_IN_FK_ORDER = [
  ...AUTH_TABLES_IN_FK_ORDER,
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
  user: ["id"],
  organization: ["id"],
  session: ["id"],
  account: ["id"],
  verification: ["id"],
  twoFactor: ["id"],
  member: ["id"],
  invitation: ["id"],
  rateLimit: ["id"],
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
export type AuthUserRow = Selectable<AuthUserTable>;
export type AuthOrganizationRow = Selectable<AuthOrganizationTable>;
export type AuthMemberRow = Selectable<AuthMemberTable>;
export type AuthInvitationRow = Selectable<AuthInvitationTable>;

/** Better Auth booleans as read through getDb(): 1/0 on SQLite/D1, true/false on Postgres. */
export function authBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}
