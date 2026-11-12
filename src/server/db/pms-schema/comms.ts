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
 * - pms_sms_credit_accounts / pms_sms_credit_entries (0143): prepaid text credits – the cached balance and settings
 *   per clinic, and the append-only ledger (a payment, a reversal and a webhook event each applied once).
 * - pms_bulk_email_settings / pms_email_campaigns / pms_email_campaign_recipients (0146): bulk email to groups of
 *   patients (behind CLINFORMS_BULK_EMAIL and a per-clinic setting, off by default – docs/clinic-system/comms.md).
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
  /** A text held for the quiet hours (a waiting-list offer, status queued): the run releases it then (0142). */
  hold_until: IsoTimestamp | null;
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
  template_name: string | null;
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

export interface PmsSmsCreditAccountsTable {
  tenant_id: string;
  balance: WithDefault<number>;
  last_pack_credits: number | null;
  low_threshold: WithDefault<number>;
  low_warned: WithDefault<number>;
  zero_warned: WithDefault<number>;
  auto_topup: WithDefault<number>;
  auto_topup_threshold: WithDefault<number>;
  /** sms_500 | sms_1000 | sms_5000 */
  auto_topup_pack: string | null;
  auto_topup_paused_at: IsoTimestamp | null;
  /** Why the last automatic top-up failed (a provider code, never card details). */
  auto_topup_failure: string | null;
  topup_claim: string | null;
  topup_claimed_at: IsoTimestamp | null;
  customer_ref: string | null;
  /** 'test' | 'live' (migration 0144): the mode the customer was made in; NULL = before 0144 (test). */
  customer_mode: string | null;
  card_method_ref: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  last_entry_id: string | null;
  rev: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsSmsCreditEntriesTable {
  tenant_id: string;
  id: string;
  /** purchase | auto_topup | debit | adjustment | reversal */
  kind: string;
  /** Signed: + bought / given back, − used. */
  credits: number;
  balance_after: number;
  pack: string | null;
  amount_pence: number | null;
  message_id: string | null;
  reverses_id: string | null;
  /** The payment provider's payment reference (credited once). */
  payment_ref: string | null;
  /** The payment provider's webhook event that made this entry (applied once). */
  event_ref: string | null;
  /** 'test' | 'live' (migration 0145) on purchase / auto_topup entries; NULL otherwise and before 0145 (test). */
  mode: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** 0146: bulk email (campaigns) – one row per clinic; no row = off. */
export interface PmsBulkEmailSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  enabled: WithDefault<number>;
  daily_cap: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0146: a bulk email (subject and body encrypted). */
export interface PmsEmailCampaignsTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  /** marketing | service */
  purpose: string;
  service_reason: string | null;
  subject_enc: string;
  body_enc: string;
  /** JSON: the audience filters (ids, numbers, yes/no). */
  audience_json: string;
  /** draft | scheduled | sending | sent | cancelled */
  status: WithDefault<string>;
  scheduled_for: IsoTimestamp | null;
  started_at: IsoTimestamp | null;
  finished_at: IsoTimestamp | null;
  cancelled_at: IsoTimestamp | null;
  recipients_total: WithDefault<number>;
  created_by: string | null;
  scheduled_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0146: one recipient (address) of a campaign. */
export interface PmsEmailCampaignRecipientsTable {
  tenant_id: string;
  id: string;
  campaign_id: string;
  patient_id: string;
  address_key: string;
  /** pending | processing | sent | outbox | failed | skipped */
  status: WithDefault<string>;
  message_id: string | null;
  skip_reason: string | null;
  claim_token: string | null;
  claimed_at: IsoTimestamp | null;
  sent_on: IsoDate | null;
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
  pms_sms_credit_accounts: PmsSmsCreditAccountsTable;
  pms_sms_credit_entries: PmsSmsCreditEntriesTable;
  pms_bulk_email_settings: PmsBulkEmailSettingsTable;
  pms_email_campaigns: PmsEmailCampaignsTable;
  pms_email_campaign_recipients: PmsEmailCampaignRecipientsTable;
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
  "pms_sms_credit_accounts",
  "pms_sms_credit_entries",
  "pms_bulk_email_settings",
  "pms_email_campaigns",
  "pms_email_campaign_recipients",
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
  pms_sms_credit_accounts: ["tenant_id"],
  pms_sms_credit_entries: ["tenant_id", "id"],
  pms_bulk_email_settings: ["tenant_id"],
  pms_email_campaigns: ["tenant_id", "id"],
  pms_email_campaign_recipients: ["tenant_id", "id"],
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
  "hold_until",
  "auto_topup_paused_at",
  "topup_claimed_at",
  "scheduled_for",
  "started_at",
  "finished_at",
  "cancelled_at",
];

/** Every comms table is per clinic (offboarding exports them decrypted, then deletes them in reverse order). */
export const COMMS_TENANT_TABLES: readonly (typeof COMMS_TABLES)[number][] = COMMS_TABLES;
