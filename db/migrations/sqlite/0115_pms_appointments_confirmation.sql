-- ClinForms 0115 (SQLite / Cloudflare D1): clinic system, diary module - pms_appointments.confirmation_requested,
-- 1 when reception ticked "Send confirmation text and email" while booking. The diary only stores the wish - the
-- messages module sends the confirmation (outbox by default) and is not on this branch yet.
-- Kept in step with supabase/migrations/20261024000115_pms_appointments_confirmation.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_appointments ADD COLUMN confirmation_requested INTEGER NOT NULL DEFAULT 0;
