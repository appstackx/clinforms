-- ClinForms 0135 (Postgres / Supabase): clinic system, billing - the site a payment was taken at.
-- Kept in step with db/migrations/sqlite/0135_pms_payments_site.sql. Idempotent.
alter table public.pms_payments add column if not exists site_id text;
