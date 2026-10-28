-- ClinForms 0116 (SQLite / Cloudflare D1): clinic system, diary module - the diary's own settings, one row per
-- clinic (no row = every default). show_dob_on_day_sheet: print patients' dates of birth on the paper day sheet
-- (default off - Khuram's decision 28/10/2026, only owners and administrators may switch it on).
-- Kept in step with supabase/migrations/20261024000116_pms_diary_settings.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_diary_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  show_dob_on_day_sheet INTEGER NOT NULL DEFAULT 0 CHECK (show_dob_on_day_sheet IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
