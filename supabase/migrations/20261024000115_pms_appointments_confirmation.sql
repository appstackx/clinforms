-- ClinForms 0115 (Postgres / Supabase): clinic system, diary module - pms_appointments.confirmation_requested,
-- 1 when reception asked for a booking confirmation (text and email); the messages module sends it later.
-- Kept in step with db/migrations/sqlite/0115_pms_appointments_confirmation.sql. Idempotent.
-- No new table: row level security and the revoke block of 0110 already cover pms_appointments.
alter table public.pms_appointments add column if not exists confirmation_requested integer not null default 0;
