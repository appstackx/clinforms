-- ClinForms 0185 (SQLite / Cloudflare D1): clinic system, portal module follow-up (M9b) - pms_portal_sessions.write_id, set
-- fresh by every change of a row. The conditional audit row of a change is written only while a row carries THAT
-- write id (before, it keyed on the change's time - two identical writes in the same millisecond could both audit).
-- Kept in step with supabase/migrations/20261024000185_portal_sessions_write_id.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_portal_sessions ADD COLUMN write_id TEXT;
