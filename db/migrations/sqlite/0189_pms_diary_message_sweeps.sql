-- ClinForms 0189 (SQLite / Cloudflare D1): clinic system, diary module - how far the message run has re-checked the
-- diary's appointments against their planned messages (M9b, handover §19). A diary write and its message sync are
-- two batches: when the sync fails, the next message run (the same cron route, no new job) re-syncs every
-- appointment changed since synced_to, then moves synced_to on. One row per clinic, no row = never swept (the
-- first sweep looks back one day). Holds no patient data.
-- Kept in step with supabase/migrations/20261024000189_pms_diary_message_sweeps.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_diary_message_sweeps (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  synced_to TEXT NOT NULL CHECK (length(synced_to) = 24 AND substr(synced_to, 11, 1) = 'T' AND substr(synced_to, 24, 1) = 'Z' AND julianday(synced_to) IS NOT NULL),
  updated_at TEXT NOT NULL
);
