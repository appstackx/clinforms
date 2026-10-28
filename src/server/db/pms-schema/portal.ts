/**
 * Tables of the portal module (migrations 0150–0152 / 20261024000150–…152): online booking (settings, sites
 * open online with their map position, the log of appointments booked online – the appointments themselves are
 * the diary's pms_appointments), the patient portal (accounts, one-time sign-in links, sessions, shared documents;
 * its emails go through comms' pms_messages) and intake forms (templates, patients' copies). Conventions: docs/clinic-system/contract.md §4.
 *
 * - Instants are ISO TEXT (D1) / timestamptz (Postgres); calendar dates TEXT "YYYY-MM-DD"; booleans 0/1.
 * - Columns ending in _enc hold AES-GCM ciphertext with AAD "<tenant>:<table>.<column>:<id>".
 * - token_hash columns hold SHA-256 hex of a secret the patient holds (a link or a cookie) – never the secret.
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;

export interface PmsBookingSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  online_booking: WithDefault<number>;
  portal: WithDefault<number>;
  new_patients: WithDefault<number>;
  min_notice_hours: WithDefault<number>;
  max_days_ahead: WithDefault<number>;
  slot_step_minutes: WithDefault<number>;
  cancel_notice_hours: WithDefault<number>;
  patient_cancel: WithDefault<number>;
  intro_text: string | null;
  cancellation_policy: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsBookingSitesTable {
  tenant_id: string;
  site_id: string;
  rev: WithDefault<number>;
  /** 0/1: the site is offered on the booking page. */
  online: WithDefault<number>;
  /** Latitude / longitude × 1,000,000 (whole numbers on both databases), or null. */
  lat_e6: number | null;
  lng_e6: number | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsOnlineBookingsTable {
  tenant_id: string;
  id: string;
  rev: WithDefault<number>;
  reference: string;
  patient_id: string;
  /** The diary appointment (pms_appointments) – the booking itself. */
  appointment_id: string;
  /** "booking_page" | "portal" */
  channel: string;
  /** "new" | "existing" | "portal" */
  patient_match: string;
  manage_token_hash: string | null;
  manage_expires_at: IsoTimestamp | null;
  reviewed_at: IsoTimestamp | null;
  reviewed_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPortalAccountsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  /** "active" | "disabled" */
  status: WithDefault<string>;
  last_sign_in_at: IsoTimestamp | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPortalLinksTable {
  tenant_id: string;
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: IsoTimestamp;
  used_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

export interface PmsPortalSessionsTable {
  tenant_id: string;
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: IsoTimestamp;
  last_seen_at: IsoTimestamp;
  revoked_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

export interface PmsPortalSharesTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  title: string;
  body_enc: string;
  shared_by: string | null;
  shared_at: IsoTimestamp;
  viewed_at: IsoTimestamp | null;
  withdrawn_at: IsoTimestamp | null;
  withdrawn_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsIntakeTemplatesTable {
  tenant_id: string;
  id: string;
  rev: WithDefault<number>;
  version: WithDefault<number>;
  name: string;
  kind: string;
  description: string | null;
  status: WithDefault<string>;
  send_when: WithDefault<string>;
  requires_signature: WithDefault<number>;
  signature_statement: string | null;
  sets_treatment_consent: WithDefault<number>;
  /** JSON FormDefinition (no patient data). */
  definition_json: string;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsIntakeResponsesTable {
  tenant_id: string;
  id: string;
  rev: WithDefault<number>;
  /** Null for an outcome questionnaire (kind "outcome"). */
  template_id: string | null;
  template_version: number;
  name: string;
  kind: string;
  patient_id: string;
  /** The diary appointment the form was sent for. */
  appointment_id: string | null;
  /** Outcome questionnaires: "ndi" | "odi" | "nprs" | "psfs" | "quickdash". */
  measure: string | null;
  case_id: string | null;
  /** The records module's outcome row made from the answers. */
  outcome_id: string | null;
  /** "requested" | "submitted" | "cancelled" */
  status: WithDefault<string>;
  /** JSON snapshot of the FormDefinition the patient answered. */
  form_json: string;
  requires_signature: WithDefault<number>;
  signature_statement: string | null;
  sets_treatment_consent: WithDefault<number>;
  answers_enc: string | null;
  signature_name_enc: string | null;
  signed_at: IsoTimestamp | null;
  /** "verified" | "unverified" */
  trust: string | null;
  content_sha256: string | null;
  requested_by: string | null;
  requested_at: IsoTimestamp;
  submitted_at: IsoTimestamp | null;
  reviewed_at: IsoTimestamp | null;
  reviewed_by: string | null;
  applied_at: IsoTimestamp | null;
  applied_by: string | null;
  cancelled_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PortalTables {
  pms_booking_settings: PmsBookingSettingsTable;
  pms_booking_sites: PmsBookingSitesTable;
  pms_online_bookings: PmsOnlineBookingsTable;
  pms_portal_accounts: PmsPortalAccountsTable;
  pms_portal_links: PmsPortalLinksTable;
  pms_portal_sessions: PmsPortalSessionsTable;
  pms_portal_shares: PmsPortalSharesTable;
  pms_intake_templates: PmsIntakeTemplatesTable;
  pms_intake_responses: PmsIntakeResponsesTable;
}

/** Foreign-key order (parents first). */
export const PORTAL_TABLES = [
  "pms_booking_settings",
  "pms_booking_sites",
  "pms_online_bookings",
  "pms_portal_accounts",
  "pms_portal_links",
  "pms_portal_sessions",
  "pms_portal_shares",
  "pms_intake_templates",
  "pms_intake_responses",
] as const satisfies readonly (keyof PortalTables)[];

export const PORTAL_PRIMARY_KEYS: { readonly [T in (typeof PORTAL_TABLES)[number]]: readonly (keyof PortalTables[T] & string)[] } = {
  pms_booking_settings: ["tenant_id"],
  pms_booking_sites: ["tenant_id", "site_id"],
  pms_online_bookings: ["tenant_id", "id"],
  pms_portal_accounts: ["tenant_id", "id"],
  pms_portal_links: ["tenant_id", "id"],
  pms_portal_sessions: ["tenant_id", "id"],
  pms_portal_shares: ["tenant_id", "id"],
  pms_intake_templates: ["tenant_id", "id"],
  pms_intake_responses: ["tenant_id", "id"],
};

/** Timestamp columns beyond created_at / updated_at (the D1 → Postgres copy compares them as ISO instants). */
export const PORTAL_TIMESTAMP_COLUMNS: readonly string[] = [
  "cancelled_at",
  "manage_expires_at",
  "reviewed_at",
  "last_sign_in_at",
  "expires_at",
  "used_at",
  "last_seen_at",
  "revoked_at",
  "shared_at",
  "viewed_at",
  "withdrawn_at",
  "signed_at",
  "requested_at",
  "submitted_at",
  "applied_at",
];

/** Every portal table holds one clinic's data (offboarding exports and deletes them all). */
export const PORTAL_TENANT_TABLES: readonly (typeof PORTAL_TABLES)[number][] = PORTAL_TABLES;
