-- ClinForms 0140 (SQLite / Cloudflare D1): clinic system, comms module part 1 - message settings, message
-- templates, reminder rules, the message log (outbox, sent messages, replies), planned appointment messages and
-- the record of how patients' message preferences changed (PECR evidence).
-- Kept in step with supabase/migrations/20261024000140_pms_comms.sql (db/parity.test.ts).
-- Every table: tenant_id first, PRIMARY KEY (tenant_id, id) where rows have ids, foreign keys that include
-- tenant_id. Message text is encrypted per clinic (subject_enc, body_enc). Templates are the clinic's own
-- boilerplate (no patient data) and stay plain. Booleans 0/1, timestamps ISO TEXT.
-- appointment_id refers to the diary's appointment and has no foreign key here (the diary hands comms a
-- snapshot of what a message needs, so this module works with or without the diary's tables).
-- The app never deletes these rows (messages are kept with the patient's record) - only offboarding a clinic does.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_comms_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  confirmations_sms INTEGER NOT NULL DEFAULT 1 CHECK (confirmations_sms IN (0, 1)),
  confirmations_email INTEGER NOT NULL DEFAULT 1 CHECK (confirmations_email IN (0, 1)),
  change_notices INTEGER NOT NULL DEFAULT 1 CHECK (change_notices IN (0, 1)),
  sms_sender TEXT CHECK (sms_sender IS NULL OR length(sms_sender) BETWEEN 3 AND 11),
  reply_phone TEXT,
  reply_email TEXT,
  replies_enabled INTEGER NOT NULL DEFAULT 1 CHECK (replies_enabled IN (0, 1)),
  quiet_start TEXT NOT NULL DEFAULT '20:00' CHECK (length(quiet_start) = 5),
  quiet_end TEXT NOT NULL DEFAULT '08:00' CHECK (length(quiet_end) = 5),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pms_message_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'moved', 'cancelled', 'general', 'marketing')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_message_templates_name ON pms_message_templates (tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_message_templates_import_ref ON pms_message_templates (tenant_id, import_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pms_message_templates_default ON pms_message_templates (tenant_id, kind, channel) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS pms_reminder_rules (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  timing TEXT NOT NULL CHECK (timing IN ('hours_before', 'days_before')),
  hours_before INTEGER CHECK (hours_before IS NULL OR hours_before BETWEEN 1 AND 168),
  days_before INTEGER CHECK (days_before IS NULL OR days_before BETWEEN 1 AND 14),
  send_at TEXT CHECK (send_at IS NULL OR length(send_at) = 5),
  template_id TEXT,
  service_ids_json TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES pms_message_templates (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_reminder_rules_name ON pms_reminder_rules (tenant_id, name);

CREATE TABLE IF NOT EXISTS pms_messages (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  purpose TEXT NOT NULL CHECK (purpose IN ('service', 'marketing')),
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'moved', 'cancelled', 'general', 'marketing', 'reply')),
  template_id TEXT,
  appointment_id TEXT,
  in_reply_to_id TEXT,
  to_address TEXT,
  from_address TEXT,
  address_key TEXT,
  subject_enc TEXT,
  body_enc TEXT NOT NULL,
  segments INTEGER CHECK (segments IS NULL OR segments >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'outbox', 'sent', 'delivered', 'failed', 'received')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 20),
  provider_message_id TEXT,
  error_code TEXT,
  reply_intent TEXT CHECK (reply_intent IS NULL OR reply_intent IN ('confirm', 'cancel', 'stop', 'unknown')),
  action_status TEXT NOT NULL DEFAULT 'none' CHECK (action_status IN ('none', 'to_action', 'done')),
  actioned_by TEXT,
  actioned_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES pms_message_templates (tenant_id, id),
  FOREIGN KEY (tenant_id, in_reply_to_id) REFERENCES pms_messages (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_messages_patient ON pms_messages (tenant_id, patient_id, id);
CREATE INDEX IF NOT EXISTS pms_messages_address ON pms_messages (tenant_id, address_key, created_at);
CREATE INDEX IF NOT EXISTS pms_messages_action ON pms_messages (tenant_id, action_status, id);
CREATE INDEX IF NOT EXISTS pms_messages_appointment ON pms_messages (tenant_id, appointment_id);
CREATE INDEX IF NOT EXISTS pms_messages_status ON pms_messages (tenant_id, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_messages_provider_id ON pms_messages (tenant_id, provider, provider_message_id);

CREATE TABLE IF NOT EXISTS pms_message_schedule (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'moved', 'cancelled')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  rule_id TEXT,
  dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) <= 200),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'cancelled', 'failed')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  site_id TEXT,
  practitioner_id TEXT,
  service_id TEXT,
  message_id TEXT,
  skip_reason TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES pms_reminder_rules (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES pms_messages (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_message_schedule_dedupe ON pms_message_schedule (tenant_id, appointment_id, dedupe_key);
CREATE INDEX IF NOT EXISTS pms_message_schedule_due ON pms_message_schedule (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS pms_message_schedule_patient ON pms_message_schedule (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS pms_message_schedule_claim ON pms_message_schedule (tenant_id, claim_token);

CREATE TABLE IF NOT EXISTS pms_consent_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  purpose TEXT NOT NULL CHECK (purpose IN ('service', 'marketing')),
  action TEXT NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  source TEXT NOT NULL CHECK (source IN ('staff', 'sms_reply', 'email_link', 'import', 'portal')),
  message_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES pms_messages (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_consent_events_patient ON pms_consent_events (tenant_id, patient_id, id);
