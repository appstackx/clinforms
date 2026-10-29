/**
 * Tables of the portal module (migrations 0150–0152 and 0182–0185 / 20261024000150–…152, …182–…185): online booking (settings, sites
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
  /** Fresh on every change (0185): the conditional audit row keys on it. */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  /** Fresh on every change (0184): the conditional audit row keys on it. */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** A shared document that is a file attached to the record (0182). */
export interface PmsPortalShareFilesTable {
  tenant_id: string;
  share_id: string;
  /** The records module's pms_attachments row. */
  attachment_id: string;
  created_at: IsoTimestamp;
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
  /** Fresh on every change (0183): the conditional audit row keys on it. */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** A form completed in the clinic on a clinic device ("hand to patient"), verified by staff (0182). */
export interface PmsIntakeHandoffsTable {
  tenant_id: string;
  id: string;
  response_id: string;
  patient_id: string;
  /** SHA-256 hex of the device's one-time secret (an httpOnly cookie) – never the secret. */
  token_hash: string;
  /** "open" | "completed" | "verified" | "ended" */
  status: WithDefault<string>;
  started_by: string;
  expires_at: IsoTimestamp;
  completed_at: IsoTimestamp | null;
  verified_at: IsoTimestamp | null;
  verified_by: string | null;
  ended_at: IsoTimestamp | null;
  ended_by: string | null;
  write_id: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * A clinic device paired with a hand-off by a short code (0190, M10 H3): the member of staff gets the code on their
 * own screen; the device (not signed in) enters it and only then gets its one-time secret. Only the code's SHA-256.
 */
export interface PmsIntakeDevicePairingsTable {
  tenant_id: string;
  handoff_id: string;
  code_hash: string;
  expires_at: IsoTimestamp;
  paired_at: IsoTimestamp | null;
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  pms_portal_share_files: PmsPortalShareFilesTable;
  pms_intake_templates: PmsIntakeTemplatesTable;
  pms_intake_responses: PmsIntakeResponsesTable;
  pms_intake_handoffs: PmsIntakeHandoffsTable;
  pms_intake_device_pairings: PmsIntakeDevicePairingsTable;
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
  "pms_portal_share_files",
  "pms_intake_templates",
  "pms_intake_responses",
  "pms_intake_handoffs",
  "pms_intake_device_pairings",
] as const satisfies readonly (keyof PortalTables)[];

export const PORTAL_PRIMARY_KEYS: { readonly [T in (typeof PORTAL_TABLES)[number]]: readonly (keyof PortalTables[T] & string)[] } = {
  pms_booking_settings: ["tenant_id"],
  pms_booking_sites: ["tenant_id", "site_id"],
  pms_online_bookings: ["tenant_id", "id"],
  pms_portal_accounts: ["tenant_id", "id"],
  pms_portal_links: ["tenant_id", "id"],
  pms_portal_sessions: ["tenant_id", "id"],
  pms_portal_shares: ["tenant_id", "id"],
  pms_portal_share_files: ["tenant_id", "share_id"],
  pms_intake_templates: ["tenant_id", "id"],
  pms_intake_responses: ["tenant_id", "id"],
  pms_intake_handoffs: ["tenant_id", "id"],
  pms_intake_device_pairings: ["tenant_id", "handoff_id"],
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
  "completed_at",
  "verified_at",
  "ended_at",
  "paired_at",
];

/** Every portal table holds one clinic's data (offboarding exports and deletes them all). */
export const PORTAL_TENANT_TABLES: readonly (typeof PORTAL_TABLES)[number][] = PORTAL_TABLES;
