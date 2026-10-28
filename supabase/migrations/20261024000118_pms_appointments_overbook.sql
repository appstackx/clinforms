-- ClinForms 0118 (Postgres / Supabase): clinic system, diary module - pms_appointments.overbook_write_id, equal to
-- the row's new write_id only on a double-booking a member holding "diary.override" chose (see the SQLite file).
-- Kept in step with db/migrations/sqlite/0118_pms_appointments_overbook.sql. Idempotent.
-- No new table: row level security and the revoke block of 0110 already cover pms_appointments.
alter table public.pms_appointments add column if not exists overbook_write_id text;
