-- ClinForms 0111 (Postgres / Supabase): clinic system, diary module - pms_appointments.write_id, set fresh by
-- every change of the row so its audit row is written in the same atomic batch (see the SQLite file).
-- Kept in step with db/migrations/sqlite/0111_pms_appointments_write_id.sql. Idempotent.
-- No new table: row level security and the revoke block of 0110 already cover pms_appointments.
alter table public.pms_appointments add column if not exists write_id text;
