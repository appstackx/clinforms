-- ClinForms 0182 (SQLite / Cloudflare D1): clinic system, portal module follow-up (M9b) - two new tables:
-- pms_intake_handoffs - a patient completes a form IN THE CLINIC on a clinic device ("hand to patient"): the one-time
--   hand-off a member of staff started (only the SHA-256 of the device's secret is stored), when the patient
--   finished, and which member of staff verified it afterwards (with their password). Never deleted.
-- pms_portal_share_files - a document shared with the patient in the portal that IS a file attached to the record
--   (pms_attachments): the share row keeps the title and the message, this row points at the file. Never deleted -
--   a share is withdrawn instead.
-- write_id: a fresh id on every change, so the audit row of a change is written exactly when that change was.
-- Kept in step with supabase/migrations/20261024000182_portal_handoffs_share_files.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_intake_handoffs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'verified', 'ended')),
  started_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  ended_at TEXT,
  ended_by TEXT,
  write_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, response_id) REFERENCES pms_intake_responses (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_intake_handoffs_token ON pms_intake_handoffs (tenant_id, token_hash);
CREATE INDEX IF NOT EXISTS pms_intake_handoffs_response ON pms_intake_handoffs (tenant_id, response_id, created_at);

CREATE TABLE IF NOT EXISTS pms_portal_share_files (
  tenant_id TEXT NOT NULL,
  share_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, share_id),
  FOREIGN KEY (tenant_id, share_id) REFERENCES pms_portal_shares (tenant_id, id),
  FOREIGN KEY (tenant_id, attachment_id) REFERENCES pms_attachments (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_portal_share_files_attachment ON pms_portal_share_files (tenant_id, attachment_id);
