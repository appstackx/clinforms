-- ClinForms 0005 (SQLite / Cloudflare D1): an index for the clinic activity page (/app/settings/activity).
-- Clinicians and staff see only their own entries, so that page filters the clinic's trail by user, newest
-- first. Kept in step with supabase/migrations/20261010000005_audit_log_user_index.sql. Idempotent.
CREATE INDEX IF NOT EXISTS audit_log_tenant_user ON audit_log (tenant_id, user_id, id);
