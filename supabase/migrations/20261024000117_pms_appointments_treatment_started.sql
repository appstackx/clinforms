-- ClinForms 0117 (Postgres / Supabase): clinic system, diary module - pms_appointments.treatment_started_at.
-- "In treatment" is stored as status 'arrived' with this instant set (see the SQLite file: the same model on both
-- dialects, one code path). Kept in step with db/migrations/sqlite/0117_pms_appointments_treatment_started.sql.
-- Idempotent. No new table: row level security and the revoke block of 0110 already cover pms_appointments.
alter table public.pms_appointments add column if not exists treatment_started_at timestamptz;
