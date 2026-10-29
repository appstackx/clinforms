-- ClinForms 0183 (Postgres / Supabase): clinic system, portal module follow-up (M9b) - pms_intake_responses.write_id, set fresh
-- by every change of a row (the conditional audit row of a change keys on it).
-- Kept in step with db/migrations/sqlite/0183_portal_intake_responses_write_id.sql. Idempotent.
alter table public.pms_intake_responses add column if not exists write_id text;
