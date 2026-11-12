-- ClinForms 0146 (SQLite / Cloudflare D1): clinic system, comms - BULK EMAIL to groups of patients (tracker xt02).
-- Built behind the platform switch CLINFORMS_BULK_EMAIL=on AND a per-clinic setting that is OFF by default.
-- pms_bulk_email_settings: one row per clinic. No row = off. enabled 0/1, daily_cap = most campaign emails a day.
-- pms_email_campaigns: a campaign - its name (the clinic's own label), purpose (marketing goes only to patients with
--   a recorded marketing-email opt-in, service = a service announcement such as a closure or a new address, with
--   service_reason saying why it is not marketing), subject and body ENCRYPTED per clinic (subject_enc, body_enc -
--   lists never decrypt), the audience filters (audience_json - ids, numbers and yes/no only), status and counts.
-- pms_email_campaign_recipients: who a campaign goes to, written when it starts sending - one row per patient and
--   per address (address_key = the lower-case email, unique per campaign, so one address gets one copy), each
--   claimed conditionally (claim_token) before it is sent, then sent / outbox / failed / skipped with its message.
--   sent_on is the UK day it went (the per-clinic daily cap).
-- Offboarding: campaigns hang off the clinic's settings row and recipients off their campaign, patient and message,
--   all ON DELETE CASCADE, so offboarding names neither table (PMS_CASCADE_DELETED_TABLES). The settings row is
--   written (if missing) in the same batch as a clinic's first draft.
-- The emails themselves are ordinary rows of pms_messages (kind marketing or general), so the outbox, retries and
-- delivery updates work as for any message. Unsubscribes are pms_consent_events with the message id.
-- Kept in step with supabase/migrations/20261024000146_pms_email_campaigns.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_bulk_email_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  daily_cap INTEGER NOT NULL DEFAULT 500 CHECK (daily_cap BETWEEN 1 AND 5000),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pms_email_campaigns (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  purpose TEXT NOT NULL CHECK (purpose IN ('marketing', 'service')),
  service_reason TEXT CHECK (service_reason IS NULL OR length(service_reason) BETWEEN 1 AND 300),
  subject_enc TEXT NOT NULL,
  body_enc TEXT NOT NULL,
  audience_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for TEXT,
  started_at TEXT,
  finished_at TEXT,
  cancelled_at TEXT,
  recipients_total INTEGER NOT NULL DEFAULT 0 CHECK (recipients_total >= 0),
  created_by TEXT,
  scheduled_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_bulk_email_settings (tenant_id) ON DELETE CASCADE,
  CHECK (purpose = 'marketing' OR service_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pms_email_campaigns_status ON pms_email_campaigns (tenant_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS pms_email_campaigns_created ON pms_email_campaigns (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS pms_email_campaign_recipients (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  address_key TEXT NOT NULL CHECK (length(address_key) BETWEEN 3 AND 254),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'outbox', 'failed', 'skipped')),
  message_id TEXT,
  skip_reason TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  sent_on TEXT CHECK (sent_on IS NULL OR sent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES pms_email_campaigns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, message_id) REFERENCES pms_messages (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_email_campaign_recipients_address ON pms_email_campaign_recipients (tenant_id, campaign_id, address_key);
CREATE UNIQUE INDEX IF NOT EXISTS pms_email_campaign_recipients_patient ON pms_email_campaign_recipients (tenant_id, campaign_id, patient_id);
CREATE INDEX IF NOT EXISTS pms_email_campaign_recipients_status ON pms_email_campaign_recipients (tenant_id, campaign_id, status);
CREATE INDEX IF NOT EXISTS pms_email_campaign_recipients_claim ON pms_email_campaign_recipients (tenant_id, claim_token);
CREATE INDEX IF NOT EXISTS pms_email_campaign_recipients_sent_on ON pms_email_campaign_recipients (tenant_id, sent_on);
CREATE INDEX IF NOT EXISTS pms_email_campaign_recipients_message ON pms_email_campaign_recipients (tenant_id, message_id);
