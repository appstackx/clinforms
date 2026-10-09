-- ClinForms 0004 (Postgres / Supabase): access_requests.contacted_at - when ClinForms staff marked a
-- "Request access" submission as contacted (the platform page /app/platform). NULL = not contacted yet.
-- Kept in step with db/migrations/sqlite/0004_access_requests_contacted.sql. Idempotent.
-- No new table: row level security and the revoke block of 0001 already cover access_requests.
alter table public.access_requests add column if not exists contacted_at timestamptz;
