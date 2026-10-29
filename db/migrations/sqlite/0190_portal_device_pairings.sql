-- ClinForms 0190 (SQLite / Cloudflare D1): clinic system, portal module, M10 security review (H3) -
-- pms_intake_device_pairings: a form handed to the patient on a clinic device is PAIRED by a short code. The member of
-- staff asks for a code on their own screen (valid 10 minutes, used once), the clinic device - a browser that is not
-- signed in - enters it on the clinic's device page and only then gets its own one-time secret (the hand-off's
-- token_hash). Only the SHA-256 of the code is stored. No staff session or cookie is ever placed on the device.
-- write_id: a fresh id on every change, so the audit row of a pairing is written exactly when the pairing was.
-- Kept in step with supabase/migrations/20261024000190_portal_device_pairings.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_intake_device_pairings (
  tenant_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  expires_at TEXT NOT NULL,
  paired_at TEXT,
  write_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, handoff_id),
  FOREIGN KEY (tenant_id, handoff_id) REFERENCES pms_intake_handoffs (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_intake_device_pairings_code ON pms_intake_device_pairings (tenant_id, code_hash);
