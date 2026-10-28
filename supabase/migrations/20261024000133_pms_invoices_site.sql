-- ClinForms 0133 (Postgres / Supabase): clinic system, billing - the site an invoice belongs to (no foreign key,
-- like SQLite). Kept in step with db/migrations/sqlite/0133_pms_invoices_site.sql.
-- Idempotent. No new table: row level security and the revoke block of 0130 already cover pms_invoices.
alter table public.pms_invoices add column if not exists site_id text;
