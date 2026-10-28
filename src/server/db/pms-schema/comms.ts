/**
 * Tables of the comms module (owned by the comms builder – docs/clinic-system/contract.md §3–4). Migrations
 * 0140_pms_comms.sql and 0141_pms_letters.sql (+ the Postgres twins 20261024000140 / …141).
 *
 * - pms_comms_settings: one row per clinic (confirmations, notices, sender name, quiet hours, replies).
 * - pms_message_templates / pms_letter_templates: the clinic's own wording (plain – no patient data).
 * - pms_reminder_rules: "1 day before at 10:00 by text".
 * - pms_messages: the message log – outbound (outbox / sent / delivered / failed) and inbound replies; subject and
 *   body encrypted (subject_enc, body_enc).
 * - pms_message_schedule: messages planned for appointments (confirmation, reminders, notices), with the snapshot
 *   of the appointment they need; appointment_id refers to the diary (no foreign key).
 * - pms_consent_events: how and when a patient's message preferences changed (PECR evidence).
 * - pms_letters: letters to the patient, GP, referrer or payer; subject and body encrypted.
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

export interface PmsCommsSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  confirmations_sms: WithDefault<number>;
  confirmations_email: WithDefault<number>;
  change_notices: WithDefault<number>;
  dna_follow_up: WithDefault<number>;
  sms_sender: string | null;
  reply_phone: string | null;
  reply_email: string | null;
  replies_enabled: WithDefault<number>;
  /** "HH:MM" UK time. */
  quiet_start: WithDefault<string>;
  quiet_end: WithDefault<string>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsMessageTemplatesTable {
  tenant_id: string;
  id: string;
  rev: number;
  /** confirmation | reminder | moved | cancelled | general | marketing */
  kind: string;
  /** sms | email */
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  is_default: WithDefault<number>;
  active: WithDefault<number>;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsReminderRulesTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  channel: string;
  /** hours_before | days_before */
  timing: string;
  hours_before: number | null;
  days_before: number | null;
  /** "HH:MM" UK time (days_before). */
  send_at: string | null;
  template_id: string | null;
  /** JSON array of service ids, or null = every appointment type. */
  service_ids_json: string | null;
  active: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsMessagesTable {
  tenant_id: string;
  id: string;
  patient_id: string | null;
  /** outbound | inbound */
  direction: string;
  channel: string;
  /** service | marketing */
  purpose: string;
  kind: string;
  template_id: string | null;
  appointment_id: string | null;
  in_reply_to_id: string | null;
  to_address: string | null;
  from_address: string | null;
  /** Phone digits (0…) or lower-case email: replies are matched on it. */
  address_key: string | null;
  subject_enc: string | null;
  body_enc: string;
  segments: number | null;
  /** queued | outbox | sent | delivered | failed | received */
  status: string;
  /** outbox | test | simulated (| a real provider later) */
  provider: string;
  provider_message_id: string | null;
  error_code: string | null;
  reply_intent: string | null;
  action_status: WithDefault<string>;
  actioned_by: string | null;
  actioned_at: IsoTimestamp | null;
  sent_at: IsoTimestamp | null;
  delivered_at: IsoTimestamp | null;
  failed_at: IsoTimestamp | null;
  document_type: string | null;
  document_id: string | null;
  attempts: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsMessageScheduleTable {
  tenant_id: string;
  id: string;
  appointment_id: string;
  patient_id: string;
  kind: string;
  channel: string;
  rule_id: string | null;
  dedupe_key: string;
  due_at: IsoTimestamp;
  /** pending | processing | sent | skipped | cancelled | failed */
  status: WithDefault<string>;
  starts_at: IsoTimestamp;
  ends_at: IsoTimestamp | null;
  site_id: string | null;
  practitioner_id: string | null;
  service_id: string | null;
  message_id: string | null;
  skip_reason: string | null;
  claim_token: string | null;
  claimed_at: IsoTimestamp | null;
  attempts: WithDefault<number>;
  held: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsConsentEventsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  channel: string;
  purpose: string;
  /** opt_in | opt_out */
  action: string;
  /** staff | sms_reply | email_link | import | portal */
  source: string;
  message_id: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
}

export interface PmsLetterTemplatesTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  recipient_kind: string;
  subject: string;
  body: string;
  active: WithDefault<number>;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsLettersTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  case_id: string | null;
  template_id: string | null;
  practitioner_id: string | null;
  recipient_kind: string;
  recipient_referrer_id: string | null;
  recipient_name: string | null;
  recipient_address_json: string | null;
  recipient_postcode: string | null;
  recipient_email: string | null;
  letter_on: IsoDate;
  subject_enc: string;
  body_enc: string;
  /** draft | final | void */
  status: WithDefault<string>;
  finalised_at: IsoTimestamp | null;
  finalised_by: string | null;
  signature_text: string | null;
  sent_at: IsoTimestamp | null;
  sent_via: string | null;
  voided_at: IsoTimestamp | null;
  voided_by: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface CommsTables {
  pms_comms_settings: PmsCommsSettingsTable;
  pms_message_templates: PmsMessageTemplatesTable;
  pms_reminder_rules: PmsReminderRulesTable;
  pms_messages: PmsMessagesTable;
  pms_message_schedule: PmsMessageScheduleTable;
  pms_consent_events: PmsConsentEventsTable;
  pms_letter_templates: PmsLetterTemplatesTable;
  pms_letters: PmsLettersTable;
}

/** Foreign-key order (parents first). */
export const COMMS_TABLES = [
  "pms_comms_settings",
  "pms_message_templates",
  "pms_reminder_rules",
  "pms_messages",
  "pms_message_schedule",
  "pms_consent_events",
  "pms_letter_templates",
  "pms_letters",
] as const satisfies readonly (keyof CommsTables)[];

export const COMMS_PRIMARY_KEYS: { readonly [T in (typeof COMMS_TABLES)[number]]: readonly (keyof CommsTables[T] & string)[] } = {
  pms_comms_settings: ["tenant_id"],
  pms_message_templates: ["tenant_id", "id"],
  pms_reminder_rules: ["tenant_id", "id"],
  pms_messages: ["tenant_id", "id"],
  pms_message_schedule: ["tenant_id", "id"],
  pms_consent_events: ["tenant_id", "id"],
  pms_letter_templates: ["tenant_id", "id"],
  pms_letters: ["tenant_id", "id"],
};

/** Timestamp columns (TEXT in SQLite, timestamptz in Postgres) besides created_at / updated_at. */
export const COMMS_TIMESTAMP_COLUMNS: readonly string[] = [
  "actioned_at",
  "sent_at",
  "delivered_at",
  "failed_at",
  "due_at",
  "starts_at",
  "ends_at",
  "claimed_at",
  "finalised_at",
  "voided_at",
];

/** Every comms table is per clinic (offboarding exports them decrypted, then deletes them in reverse order). */
export const COMMS_TENANT_TABLES: readonly (typeof COMMS_TABLES)[number][] = COMMS_TABLES;
