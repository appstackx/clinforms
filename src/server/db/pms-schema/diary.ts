/**
 * Tables of the diary module (migration 0110 / 20261024000110 – docs/clinic-system/contract.md §3–4, the module's
 * notes in docs/clinic-system/diary.md):
 *
 *   pms_appointment_series  a recurring booking (the appointments point at it)
 *   pms_availability        rotas: when a practitioner works at a site, every N weeks
 *   pms_appointments        appointments AND blocked time (kind), never deleted – cancelled; the database refuses
 *                           two occupying items that share a practitioner or a room at the same time (triggers)
 *   pms_waiting_list        patients waiting for an appointment
 *
 * Instants are ISO TEXT (SQLite/D1) / timestamptz (Postgres); calendar dates TEXT "YYYY-MM-DD"; booleans 0/1;
 * free text in *_enc columns (AAD "<tenant>:<table>.<column>:<id>").
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

export interface PmsAppointmentSeriesTable {
  tenant_id: string;
  id: string;
  interval_weeks: number;
  occurrences: number;
  created_by: string | null;
  created_at: IsoTimestamp;
}

export interface PmsAvailabilityTable {
  tenant_id: string;
  id: string;
  rev: number;
  practitioner_id: string;
  site_id: string;
  room_id: string | null;
  /** ISO weekday 1–7. */
  weekday: number;
  /** UK local minutes after midnight. */
  start_minute: number;
  end_minute: number;
  every_weeks: WithDefault<number>;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  online_bookable: WithDefault<number>;
  active: WithDefault<number>;
  import_ref: string | null;
  /** A fresh id set by every change: the audit row is written in the same batch only where it is found (migration 0112). */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsAppointmentsTable {
  tenant_id: string;
  id: string;
  rev: number;
  /** "appointment" | "block" */
  kind: string;
  site_id: string;
  practitioner_id: string | null;
  room_id: string | null;
  patient_id: string | null;
  case_id: string | null;
  service_id: string | null;
  authorisation_id: string | null;
  series_id: string | null;
  starts_at: IsoTimestamp;
  ends_at: IsoTimestamp;
  /** UK calendar date of the start. */
  starts_on: IsoDate;
  /** booked | arrived | attended | dna | late_cancelled | cancelled */
  status: string;
  block_kind: string | null;
  title: string | null;
  notes_enc: string | null;
  /** staff | online | import */
  source: WithDefault<string>;
  fee_due: WithDefault<number>;
  fee_pence: number | null;
  auth_session_used: WithDefault<number>;
  cancel_reason: string | null;
  cancel_note_enc: string | null;
  cancelled_at: IsoTimestamp | null;
  cancelled_by: string | null;
  status_at: IsoTimestamp | null;
  status_by: string | null;
  import_ref: string | null;
  /** A fresh id set by every change: the audit row is written in the same batch only where it is found (migration 0111). */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** 1 = reception asked for a booking confirmation (text and email) – the messages module sends it (migration 0115). */
  confirmation_requested: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsWaitingListTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  case_id: string | null;
  service_id: string | null;
  practitioner_id: string | null;
  site_id: string | null;
  /** urgent | soon | routine */
  priority: WithDefault<string>;
  /** "1,3,5" (ISO weekdays) or null for any day. */
  preferred_days: string | null;
  /** any | morning | afternoon | evening */
  preferred_time: WithDefault<string>;
  earliest_on: IsoDate | null;
  latest_on: IsoDate | null;
  /** waiting | offered | booked | removed */
  status: WithDefault<string>;
  notes_enc: string | null;
  booked_appointment_id: string | null;
  removed_reason: string | null;
  /** A fresh id set by every change: the audit row is written in the same batch only where it is found (migration 0113). */
  write_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** A slot offered to a patient on the waiting list (migration 0114). */
export interface PmsWaitingListOffersTable {
  tenant_id: string;
  id: string;
  rev: number;
  waiting_list_id: string;
  site_id: string;
  practitioner_id: string;
  room_id: string | null;
  service_id: string | null;
  starts_at: IsoTimestamp;
  ends_at: IsoTimestamp;
  /** open | accepted | declined | withdrawn */
  status: WithDefault<string>;
  appointment_id: string | null;
  write_id: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** The diary's settings, one row per clinic (migration 0116); no row = every default. */
export interface PmsDiarySettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  /** 1 = print patients' dates of birth on the day sheet (default 0). */
  show_dob_on_day_sheet: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface DiaryTables {
  pms_appointment_series: PmsAppointmentSeriesTable;
  pms_availability: PmsAvailabilityTable;
  pms_appointments: PmsAppointmentsTable;
  pms_waiting_list: PmsWaitingListTable;
  pms_waiting_list_offers: PmsWaitingListOffersTable;
  pms_diary_settings: PmsDiarySettingsTable;
}

/** Foreign-key order (parents first). */
export const DIARY_TABLES = ["pms_appointment_series", "pms_availability", "pms_appointments", "pms_waiting_list", "pms_waiting_list_offers", "pms_diary_settings"] as const satisfies readonly (keyof DiaryTables)[];

export const DIARY_PRIMARY_KEYS: { readonly [T in (typeof DIARY_TABLES)[number]]: readonly (keyof DiaryTables[T] & string)[] } = {
  pms_appointment_series: ["tenant_id", "id"],
  pms_availability: ["tenant_id", "id"],
  pms_appointments: ["tenant_id", "id"],
  pms_waiting_list: ["tenant_id", "id"],
  pms_waiting_list_offers: ["tenant_id", "id"],
  pms_diary_settings: ["tenant_id"],
};

/** Timestamp columns (TEXT in SQLite, timestamptz in Postgres) – the D1 → Postgres copy compares them as ISO. */
export const DIARY_TIMESTAMP_COLUMNS: readonly string[] = ["starts_at", "ends_at", "cancelled_at", "status_at"];

/** Every diary table holds one clinic's data (offboarding exports them decrypted, then deletes them). */
export const DIARY_TENANT_TABLES: readonly (typeof DIARY_TABLES)[number][] = DIARY_TABLES;
