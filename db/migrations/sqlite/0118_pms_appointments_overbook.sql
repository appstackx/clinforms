-- ClinForms 0118 (SQLite / Cloudflare D1): clinic system, diary module - pms_appointments.overbook_write_id.
-- Set by the server, equal to the row's new write_id, ONLY on the write of a member holding "diary.override" who
-- chose "Book anyway (double-booking is logged)" (Khuram's decision A, 28/10/2026). The clash triggers of 0119 let
-- a practitioner double-booking through for exactly that write - a later write carries a new write_id, so the
-- check applies again. Rooms are never bypassed.
-- Kept in step with supabase/migrations/20261024000118_pms_appointments_overbook.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_appointments ADD COLUMN overbook_write_id TEXT;
