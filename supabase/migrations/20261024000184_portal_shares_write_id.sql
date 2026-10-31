-- ClinForms 0184 (Postgres / Supabase): clinic system, portal module follow-up (M9b) - pms_portal_shares.write_id, set fresh
-- by every change of a row (the conditional audit row of a change keys on it).
-- Kept in step with db/migrations/sqlite/0184_portal_shares_write_id.sql. Idempotent.
alter table public.pms_portal_shares add column if not exists write_id text;
