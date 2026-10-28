-- ClinForms 0105 (Postgres / Supabase): clinic-system foundation - pms_practitioners.may_sign (1 = may sign
-- clinical notes with the registration number on this record). Kept in step with
-- db/migrations/sqlite/0105_pms_practitioner_may_sign.sql. Idempotent.
-- No new table: row level security and the revoke block of 0101 already cover pms_practitioners.
alter table public.pms_practitioners add column if not exists may_sign integer not null default 1 check (may_sign in (0, 1));
