-- ClinForms 0112 (SQLite / Cloudflare D1): clinic system, diary module - pms_availability.write_id, set fresh
-- by every change of the rota entry so its audit row can be written in the same atomic batch (see 0111).
-- Kept in step with supabase/migrations/20261024000112_pms_availability_write_id.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_availability ADD COLUMN write_id TEXT;
