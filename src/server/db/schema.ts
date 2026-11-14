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
import { PMS_PRIMARY_KEYS, PMS_TABLES_IN_FK_ORDER, type PmsDatabase } from "./pms-schema";

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

/**
 * `clinic_plan` (migration 0006; demo_clinic 0008) – a clinic's trial, its own drafting limits and the demo-clinic
 * flag, written by ClinForms staff only (platform page, admin scripts). One row per clinic; no row = no trial,
 * default limits, a real clinic.
 */
export interface ClinicPlanTable {
  tenant_id: string;
  /** "standard" (no trial: a row for its own limits only) | "trial" | "paid" (converted). */
  status: string;
  trial_days: number | null;
  /** 0/1: the trial starts when an owner first opens the clinic area. */
  start_on_first_sign_in: WithDefault<number>;
  trial_starts_at: IsoTimestamp | null;
  trial_ends_at: IsoTimestamp | null;
  owner_first_sign_in_at: IsoTimestamp | null;
  ended_at: IsoTimestamp | null;
  live_calls_per_minute: number | null;
  live_calls_per_day: number | null;
  /**
   * 0/1 (migration 0008): a DEMO clinic – made-up data only; banner, a notice on every output, made-up PH-DEMO-NN
   * signing numbers accepted. Written by ClinForms platform staff only (repos/clinic-plan.ts setClinicDemoFlag via
   * admin/clinic-plan.ts setDemoClinic). Absent on a database before 0008: read as 0.
   */
  demo_clinic: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * `clinic_package` (migration 0007) – the clinic's package (price, allowance, extra-report price), written by
 * ClinForms staff only (platform page, admin:set-package). One row per clinic; no row = no package yet.
 * Money in pence (no VAT is charged); dates are UK calendar dates "YYYY-MM-DD".
 */
export interface ClinicPackageTable {
  tenant_id: string;
  /** starter | practice | group | group_plus | custom | trial */
  package: string;
  monthly_price_pence: number;
  reports_included: number;
  /** null = the price of an extra report is not agreed yet. */
  extra_report_pence: number | null;
  founding_price_pence: number | null;
  /** "YYYY-MM-DD" (inclusive), or null. */
  founding_until: string | null;
  setup_fee_pence: number | null;
  /** due | paid | waived, or null. */
  setup_fee_status: string | null;
  /** "YYYY-MM-DD" */
  starts_on: string;
  /** Internal only (never shown to the clinic). */
  notes: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * `clinic_usage` (migration 0007) – counters per clinic and UK calendar month ("YYYY-MM"). Never deleted by report
 * retention. `package` / `plan_*` = the package as it applied to that month (null = none).
 */
export interface ClinicUsageTable {
  tenant_id: string;
  period: string;
  package: string | null;
  plan_price_pence: number | null;
  plan_reports_included: number | null;
  plan_extra_report_pence: number | null;
  reports_started: WithDefault<number>;
  reports_drafted: WithDefault<number>;
  reports_approved: WithDefault<number>;
  amendments_approved: WithDefault<number>;
  billable_reports: WithDefault<number>;
  billable_on_approval: WithDefault<number>;
  forms_read: WithDefault<number>;
  question_sets: WithDefault<number>;
  drafting_calls: WithDefault<number>;
  failed_calls: WithDefault<number>;
  reading_calls: WithDefault<number>;
  input_tokens: WithDefault<number>;
  output_tokens: WithDefault<number>;
  cache_read_tokens: WithDefault<number>;
  cache_write_tokens: WithDefault<number>;
  cost_micro_usd: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `usage_report` (migration 0007) – one row per report seen by the usage counters: it counts once only. */
export interface UsageReportTable {
  tenant_id: string;
  report_id: string;
  /**
   * The module's keyed fingerprint of what the report is about (episode, template or form, patient – it identifies
   * nobody); "" when an event carried none. Part of the key: the same report id for another patient or form is
   * another row (fix 25/10/2026).
   */
  episode_fp: WithDefault<string>;
  /** The first version of an amended report (= report_id for a report that is not an amendment). */
  root_report_id: string;
  started_at: IsoTimestamp | null;
  first_drafted_at: IsoTimestamp | null;
  first_approved_at: IsoTimestamp | null;
  drafting_calls: WithDefault<number>;
  /** "YYYY-MM" the report counted in, or null (not counted). */
  billable_period: string | null;
  billable_at: IsoTimestamp | null;
  /** drafted | approved */
  billable_via: string | null;
  started_event: string | null;
  drafted_event: string | null;
  approved_event: string | null;
  billable_event: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `usage_event` (migration 0007) – usage events already applied (a retried write never counts twice). */
export interface UsageEventTable {
  id: string;
  tenant_id: string;
  kind: string;
  period: string;
  created_at: IsoTimestamp;
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

/**
 * `clinic_subscription` (migration 0009) – the clinic's ONE subscription at the payment service (ClinDesk band +
 * optional Reports add-on, or ClinForms on its own), written by src/server/billing only from the service's own copy.
 */
export interface ClinicSubscriptionTable {
  tenant_id: string;
  customer_ref: string;
  subscription_ref: string;
  /** test | live */
  mode: string;
  /** The payment service's status (active, trialing, past_due, unpaid, canceled, incomplete …). */
  status: string;
  /** pending_payment | active | past_due | canceled | expired (src/lib/billing/plans.ts). */
  state: string;
  product: string | null;
  plan_key: string | null;
  billing_interval: string | null;
  reports_key: string | null;
  reports_included: number | null;
  practitioners_max: number | null;
  amount_pence: number | null;
  current_period_start: IsoTimestamp | null;
  current_period_end: IsoTimestamp | null;
  cancel_at_period_end: WithDefault<number>;
  canceled_at: IsoTimestamp | null;
  ended_at: IsoTimestamp | null;
  activated_at: IsoTimestamp | null;
  past_due_since: IsoTimestamp | null;
  grace_until: IsoTimestamp | null;
  grace_notified_at: IsoTimestamp | null;
  read_only_notified_at: IsoTimestamp | null;
  /** 0/1: ClinForms staff manage the packages by hand (the subscription changes none). */
  override: WithDefault<number>;
  override_note: string | null;
  applied_json: string | null;
  last_event_ref: string | null;
  last_synced_at: IsoTimestamp | null;
  rev: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `clinic_billing_extras` (migration 0009) – extra reports billed per clinic and UK month, once each. */
export interface ClinicBillingExtrasTable {
  tenant_id: string;
  /** "YYYY-MM" (UK month, as clinic_usage). */
  period: string;
  subscription_ref: string;
  reports_counted: number;
  reports_included: number;
  extra_reports: number;
  unit_pence: number;
  /** pending | billed | skipped */
  status: string;
  invoice_item_ref: string | null;
  invoice_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * `signup_requests` (migration 0010) – "Start free trial" forms waiting for the email link (src/server/signup). The
 * token and the password are never stored: a SHA-256 of the token, the password's sign-in hash (cleared once used).
 */
export interface SignupRequestsTable {
  id: string;
  token_hash: string;
  /** clinforms | clinic */
  brand: string;
  clinic_name: string;
  owner_name: string;
  email: string;
  password_hash: string | null;
  terms_version: string;
  dpa_version: string;
  ip_hash: string;
  ua_hash: string;
  created_at: IsoTimestamp;
  expires_at: IsoTimestamp;
  claimed_at: IsoTimestamp | null;
  tenant_id: string | null;
  completed_at: IsoTimestamp | null;
}

/** `signup_acceptances` (migration 0010) – the record of acceptance of the terms and the DPA, one per self-signed clinic. */
export interface SignupAcceptancesTable {
  id: string;
  tenant_id: string;
  user_id: string;
  signup_id: string;
  brand: string;
  terms_version: string;
  dpa_version: string;
  accepted_at: IsoTimestamp;
  confirmed_at: IsoTimestamp;
  ip_hash: string;
  ua_hash: string;
}

/**
 * `self_trial` (migration 0011) – one row per clinic created by self sign-up with a free trial, and one per its SAMPLE
 * clinic (`sample_of` = the real clinic). Keyed hashes, counts and dates only (src/server/repos/self-trial.ts).
 */
export interface SelfTrialTable {
  tenant_id: string;
  /** clinforms | clinic */
  brand: string;
  sample_of: string | null;
  email_key: string;
  network_key: string;
  domain_key: string | null;
  reports_included: number;
  texts_granted: number;
  /** email | network | domain – why the free allowance was withheld (a repeat trial); null = given. */
  repeat_reason: string | null;
  sample_tenant_id: string | null;
  /** creating | ready | declined */
  sample_state: string | null;
  sample_claimed_at: IsoTimestamp | null;
  tips_off_at: IsoTimestamp | null;
  converted_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** `trial_email` (migration 0011) – one claimed row per trial email per clinic (never sent twice). */
export interface TrialEmailTable {
  tenant_id: string;
  /** welcome | tips | four_days | last_day | ended | paid */
  kind: string;
  /** claimed | sent | failed | skipped */
  status: string;
  attempts: number;
  recipients: number;
  claimed_at: IsoTimestamp;
  sent_at: IsoTimestamp | null;
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

/**
 * Every table. The clinic system's tables (pms_*, clinic_entitlements, clinic_usage_counters) come from
 * ./pms-schema (one file per module, docs/clinic-system/contract.md §4).
 */
export interface Database extends PmsDatabase {
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
  clinic_plan: ClinicPlanTable;
  clinic_package: ClinicPackageTable;
  clinic_subscription: ClinicSubscriptionTable;
  clinic_billing_extras: ClinicBillingExtrasTable;
  clinic_usage: ClinicUsageTable;
  usage_report: UsageReportTable;
  usage_event: UsageEventTable;
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
  signup_requests: SignupRequestsTable;
  signup_acceptances: SignupAcceptancesTable;
  self_trial: SelfTrialTable;
  trial_email: TrialEmailTable;
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
  "clinic_plan",
  "clinic_package",
  "clinic_subscription",
  "clinic_billing_extras",
  "clinic_usage",
  "usage_report",
  "usage_event",
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
  "signup_requests",
  "signup_acceptances",
  "self_trial",
  "trial_email",
  ...PMS_TABLES_IN_FK_ORDER,
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
  clinic_plan: ["tenant_id"],
  clinic_package: ["tenant_id"],
  clinic_subscription: ["tenant_id"],
  clinic_billing_extras: ["tenant_id", "period"],
  clinic_usage: ["tenant_id", "period"],
  usage_report: ["tenant_id", "report_id", "episode_fp"],
  usage_event: ["id"],
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
  signup_requests: ["id"],
  signup_acceptances: ["id"],
  self_trial: ["tenant_id"],
  trial_email: ["tenant_id", "kind"],
  ...PMS_PRIMARY_KEYS,
};

export type ClinicProfileRow = Selectable<ClinicProfileTable>;
export type ClinicPlanRow = Selectable<ClinicPlanTable>;
export type ClinicPackageRow = Selectable<ClinicPackageTable>;
export type ClinicUsageRow = Selectable<ClinicUsageTable>;
export type UsageReportRow = Selectable<UsageReportTable>;
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
