-- ClinForms 0105 (SQLite / Cloudflare D1): clinic-system foundation - pms_practitioners.may_sign, 1 when the member
-- may sign clinical notes with the registration number on this record (the records sign check reads it), 0 when an
-- owner or administrator switched it off on Member access, "Signing details".
-- Kept in step with supabase/migrations/20261024000105_pms_practitioner_may_sign.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_practitioners ADD COLUMN may_sign INTEGER NOT NULL DEFAULT 1 CHECK (may_sign IN (0, 1));
