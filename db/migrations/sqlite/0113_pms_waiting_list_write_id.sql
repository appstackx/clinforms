-- ClinForms 0113 (SQLite / Cloudflare D1): clinic system, diary module - pms_waiting_list.write_id, set fresh
-- by every change of the entry so its audit row can be written in the same atomic batch (see 0111).
-- Kept in step with supabase/migrations/20261024000113_pms_waiting_list_write_id.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_waiting_list ADD COLUMN write_id TEXT;
