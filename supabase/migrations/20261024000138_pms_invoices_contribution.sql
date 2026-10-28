-- ClinForms 0138 (Postgres / Supabase): clinic system, billing - the patient contribution per visit an insured
-- invoice was split with (NULL = the excess per case, or no split).
-- Kept in step with db/migrations/sqlite/0138_pms_invoices_contribution.sql. Idempotent.
alter table public.pms_invoices add column if not exists per_visit_contribution_pence integer check (per_visit_contribution_pence is null or per_visit_contribution_pence > 0);
