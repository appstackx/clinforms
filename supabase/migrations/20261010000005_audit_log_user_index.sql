-- ClinForms 0005 (Postgres / Supabase): an index for the clinic activity page (/app/settings/activity).
-- Clinicians and staff see only their own entries, so that page filters the clinic's trail by user, newest
-- first. Kept in step with db/migrations/sqlite/0005_audit_log_user_index.sql. Idempotent.
create index if not exists audit_log_tenant_user on public.audit_log (tenant_id, user_id, id);
