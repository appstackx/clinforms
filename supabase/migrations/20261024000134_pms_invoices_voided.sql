-- ClinForms 0134 (Postgres / Supabase): clinic system, billing - when an issued invoice was voided.
-- Kept in step with db/migrations/sqlite/0134_pms_invoices_voided.sql. Idempotent.
alter table public.pms_invoices add column if not exists voided_at timestamptz;
