-- ClinForms 0183 (SQLite / Cloudflare D1): clinic system, portal module follow-up (M9b) - pms_intake_responses.write_id, set
-- fresh by every change of a row. The conditional audit row of a change is written only while a row carries THAT
-- write id (before, it keyed on the change's time - two identical writes in the same millisecond could both audit).
-- Kept in step with supabase/migrations/20261024000183_portal_intake_responses_write_id.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_intake_responses ADD COLUMN write_id TEXT;
