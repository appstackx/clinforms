-- ClinForms 0210 (SQLite / Cloudflare D1): clinic system, diary module - M10 performance (handover §20.4): indexes only,
-- purely additive (no table, column or row changes). starts_on serves every read of a day or a period by UK date (Today, billing's visits, the reports) - before, those read the whole clinic's diary through (tenant_id, starts_at) or a scan. updated_at serves the message run's sweep of appointments changed since the last run.
-- Kept in step with supabase/migrations/20261024000210_pms_appointments_day_indexes.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE INDEX IF NOT EXISTS pms_appointments_starts_on ON pms_appointments (tenant_id, starts_on, site_id);
CREATE INDEX IF NOT EXISTS pms_appointments_updated ON pms_appointments (tenant_id, updated_at);
