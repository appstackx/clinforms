-- ClinForms 0104 (Postgres / Supabase): clinic-system foundation - pms_practitioners.registration_body (today
-- "HCPC"), set on Member access, "Signing details". Kept in step with
-- db/migrations/sqlite/0104_pms_practitioner_registration_body.sql. Idempotent.
-- No new table: row level security and the revoke block of 0101 already cover pms_practitioners.
alter table public.pms_practitioners add column if not exists registration_body text;
