-- ClinForms 0112 (Postgres / Supabase): clinic system, diary module - pms_availability.write_id, set fresh by
-- every change of the rota entry so its audit row is written in the same atomic batch (see the SQLite file).
-- Kept in step with db/migrations/sqlite/0112_pms_availability_write_id.sql. Idempotent.
-- No new table: row level security and the revoke block of 0110 already cover pms_availability.
alter table public.pms_availability add column if not exists write_id text;
