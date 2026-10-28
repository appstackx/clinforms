-- ClinForms 0142 (SQLite / Cloudflare D1): clinic system, comms - a text written during the clinic's quiet hours
-- that is not planned (a waiting-list offer) is kept "queued" with hold_until = the end of the quiet hours (UTC
-- ISO), and the message run releases it then. NULL = not held (every other message).
-- Kept in step with supabase/migrations/20261024000142_pms_messages_hold.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_messages ADD COLUMN hold_until TEXT;
