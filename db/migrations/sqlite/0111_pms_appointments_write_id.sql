-- ClinForms 0111 (SQLite / Cloudflare D1): clinic system, diary module - pms_appointments.write_id, a fresh
-- id set by every change. A change and its audit row go in ONE atomic batch: the UPDATE sets write_id, the audit
-- INSERT runs only WHERE EXISTS a row carrying that id - so the audit row exists exactly when the change does
-- (also when two writers race on Postgres). NULL on rows written before this migration.
-- Kept in step with supabase/migrations/20261024000111_pms_appointments_write_id.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_appointments ADD COLUMN write_id TEXT;
