-- ClinForms 0122 (SQLite / Cloudflare D1): clinic system, records module - the clinic's record-keeping settings
-- for clinical notes. One row per clinic (id 'records'): after how many days an unsigned note counts as overdue on
-- the unsigned-notes list. No row = the default (3 days). Configuration only - no patient data.
-- Kept in step with supabase/migrations/20261024000122_pms_records_settings.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_records_settings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id = 'records'),
  rev INTEGER NOT NULL CHECK (rev > 0),
  unsigned_note_days INTEGER NOT NULL DEFAULT 3 CHECK (unsigned_note_days BETWEEN 1 AND 60),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
