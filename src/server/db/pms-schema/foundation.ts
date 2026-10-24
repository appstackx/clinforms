/**
 * Foundation tables of the clinic system (migrations 0100–0109 / 20261024000100–…109): packages
 * (entitlements) and usage counters, the clinic-system settings, the clinic directory (sites, rooms,
 * practitioners, services, referrers, price lists) and the shared patient record (patients, cases,
 * authorisations). Conventions: docs/clinic-system/contract.md §4.
 *
 * - Every table has tenant_id; the record tables have PRIMARY KEY (tenant_id, id) and foreign keys that include
 *   tenant_id, so a row can never point at another clinic's row.
 * - Calendar dates are TEXT "YYYY-MM-DD" on both dialects; timestamps ISO TEXT / timestamptz; booleans 0/1;
 *   money in whole pence (INTEGER).
 * - Columns ending in _enc hold AES-GCM ciphertext with AAD "<tenant>:<table>.<column>:<id>"
 *   (src/server/repos/pms/context.ts).
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
export type IsoDate = string;

export interface ClinicEntitlementsTable {
  tenant_id: string;
  /** "reports" | "clinic" */
  package: string;
  /** "active" | "trial" | "paused" | "cancelled" */
  status: string;
  plan_code: string | null;
  /** "list" | "founding" | "design_partner" */
  price_source: string | null;
  /** JSON object of numeric limits, e.g. {"forms_per_month": 500}. */
  limits_json: string | null;
  starts_at: IsoTimestamp | null;
  ends_at: IsoTimestamp | null;
  note: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ClinicUsageCountersTable {
  tenant_id: string;
  /** "YYYY-MM" (UTC) */
  period: string;
  metric: string;
  count: WithDefault<number>;
  updated_at: IsoTimestamp;
}

export interface PmsSettingsTable {
  tenant_id: string;
  retention_adult_years: WithDefault<number>;
  retention_child_until_age: WithDefault<number>;
  /** 0/1 – a demonstration clinic (fictional data only). */
  is_demo: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsSitesTable {
  tenant_id: string;
  id: string;
  name: string;
  code: string | null;
  address_json: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  active: WithDefault<number>;
  sort_order: WithDefault<number>;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsRoomsTable {
  tenant_id: string;
  id: string;
  site_id: string;
  name: string;
  active: WithDefault<number>;
  sort_order: WithDefault<number>;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPractitionersTable {
  tenant_id: string;
  id: string;
  user_id: string | null;
  display_name: string;
  profession: string;
  registration_number: string | null;
  email: string | null;
  phone: string | null;
  colour: string | null;
  default_site_id: string | null;
  bookable: WithDefault<number>;
  online_bookable: WithDefault<number>;
  active: WithDefault<number>;
  sort_order: WithDefault<number>;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsServicesTable {
  tenant_id: string;
  id: string;
  name: string;
  code: string | null;
  category: string;
  duration_minutes: number;
  buffer_minutes: WithDefault<number>;
  default_price_pence: number | null;
  colour: string | null;
  online_bookable: WithDefault<number>;
  active: WithDefault<number>;
  sort_order: WithDefault<number>;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsReferrersTable {
  tenant_id: string;
  id: string;
  rev: number;
  kind: string;
  name: string;
  /** Lower-case search key of the name. */
  search_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_json: string | null;
  postcode: string | null;
  notes_enc: string | null;
  active: WithDefault<number>;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPriceListsTable {
  tenant_id: string;
  id: string;
  name: string;
  payer_type: string | null;
  referrer_id: string | null;
  is_default: WithDefault<number>;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
  active: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPriceListItemsTable {
  tenant_id: string;
  id: string;
  price_list_id: string;
  service_id: string;
  price_pence: number;
  billing_code: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPatientsTable {
  tenant_id: string;
  id: string;
  rev: number;
  /** The clinic's patient number (1, 2, 3…), unique per clinic. */
  patient_number: number;
  title: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: IsoDate | null;
  sex: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_work: string | null;
  address_json: string | null;
  postcode: string | null;
  occupation: string | null;
  employer: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;
  gp_name: string | null;
  gp_practice: string | null;
  gp_phone: string | null;
  gp_address_json: string | null;
  gp_postcode: string | null;
  consent_treatment: WithDefault<number>;
  consent_treatment_at: IsoTimestamp | null;
  consent_share_gp: WithDefault<number>;
  reminder_sms: WithDefault<number>;
  reminder_email: WithDefault<number>;
  marketing_email: WithDefault<number>;
  marketing_sms: WithDefault<number>;
  marketing_consent_at: IsoTimestamp | null;
  marketing_consent_source: string | null;
  alerts_enc: string | null;
  notes_enc: string | null;
  /** Lower-case search key of the names. */
  search_name: string;
  /** Digits of the phone numbers, space-separated. */
  search_phone: string;
  status: WithDefault<string>;
  legal_hold: WithDefault<number>;
  last_seen_on: IsoDate | null;
  merged_into_id: string | null;
  archived_at: IsoTimestamp | null;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsCasesTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  title: string;
  status: WithDefault<string>;
  opened_on: IsoDate;
  closed_on: IsoDate | null;
  practitioner_id: string | null;
  site_id: string | null;
  payer_type: WithDefault<string>;
  payer_referrer_id: string | null;
  membership_number: string | null;
  claim_reference: string | null;
  excess_pence: number | null;
  price_list_id: string | null;
  referrer_id: string | null;
  referral_received_on: IsoDate | null;
  injury_on: IsoDate | null;
  referral_reason_enc: string | null;
  notes_enc: string | null;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsAuthorisationsTable {
  tenant_id: string;
  id: string;
  rev: number;
  case_id: string;
  patient_id: string;
  referrer_id: string | null;
  code: string;
  sessions_authorised: number | null;
  value_authorised_pence: number | null;
  sessions_used: WithDefault<number>;
  value_used_pence: WithDefault<number>;
  valid_from: IsoDate | null;
  expires_on: IsoDate | null;
  status: WithDefault<string>;
  notes_enc: string | null;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface FoundationTables {
  clinic_entitlements: ClinicEntitlementsTable;
  clinic_usage_counters: ClinicUsageCountersTable;
  pms_settings: PmsSettingsTable;
  pms_sites: PmsSitesTable;
  pms_rooms: PmsRoomsTable;
  pms_practitioners: PmsPractitionersTable;
  pms_services: PmsServicesTable;
  pms_referrers: PmsReferrersTable;
  pms_price_lists: PmsPriceListsTable;
  pms_price_list_items: PmsPriceListItemsTable;
  pms_patients: PmsPatientsTable;
  pms_cases: PmsCasesTable;
  pms_authorisations: PmsAuthorisationsTable;
}

/** Foreign-key order (parents first). */
export const FOUNDATION_TABLES = [
  "clinic_entitlements",
  "clinic_usage_counters",
  "pms_settings",
  "pms_sites",
  "pms_rooms",
  "pms_practitioners",
  "pms_services",
  "pms_referrers",
  "pms_price_lists",
  "pms_price_list_items",
  "pms_patients",
  "pms_cases",
  "pms_authorisations",
] as const satisfies readonly (keyof FoundationTables)[];

export const FOUNDATION_PRIMARY_KEYS: { readonly [T in (typeof FOUNDATION_TABLES)[number]]: readonly (keyof FoundationTables[T] & string)[] } = {
  clinic_entitlements: ["tenant_id", "package"],
  clinic_usage_counters: ["tenant_id", "period", "metric"],
  pms_settings: ["tenant_id"],
  pms_sites: ["tenant_id", "id"],
  pms_rooms: ["tenant_id", "id"],
  pms_practitioners: ["tenant_id", "id"],
  pms_services: ["tenant_id", "id"],
  pms_referrers: ["tenant_id", "id"],
  pms_price_lists: ["tenant_id", "id"],
  pms_price_list_items: ["tenant_id", "id"],
  pms_patients: ["tenant_id", "id"],
  pms_cases: ["tenant_id", "id"],
  pms_authorisations: ["tenant_id", "id"],
};

/** Timestamp columns (TEXT in SQLite, timestamptz in Postgres) – the D1 → Postgres copy compares them as ISO. */
export const FOUNDATION_TIMESTAMP_COLUMNS = ["starts_at", "ends_at", "consent_treatment_at", "marketing_consent_at", "archived_at"] as const;

/**
 * Tables holding a clinic's own data, for the offboarding export and delete (every foundation table is per
 * clinic). Encrypted columns: every column whose name ends in _enc.
 */
export const FOUNDATION_TENANT_TABLES: readonly (typeof FOUNDATION_TABLES)[number][] = FOUNDATION_TABLES;
