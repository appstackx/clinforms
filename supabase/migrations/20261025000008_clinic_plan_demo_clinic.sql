-- ClinForms 0008 (Postgres / Supabase): clinic_plan.demo_clinic - a DEMO clinic (made-up data only).
-- 1 = its clinic pages and Studio show the banner "Demo clinic - made-up data only", every output carries a
-- demonstration notice, and members may hold the made-up PH-DEMO-NN numbers and approve with them.
-- 0 (the default, every existing row) = a real clinic, unchanged: PH-DEMO numbers are refused there.
-- Set by ClinForms platform staff only (npm run admin:set-demo-clinic or the platform page /app/platform).
-- Kept in step with db/migrations/sqlite/0008_clinic_plan_demo_clinic.sql. Idempotent.
-- No new table: row level security and the revoke block of 0006 already cover clinic_plan.

alter table public.clinic_plan add column if not exists demo_clinic integer not null default 0 check (demo_clinic in (0, 1));
