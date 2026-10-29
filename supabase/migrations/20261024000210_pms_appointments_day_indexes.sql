-- ClinForms 0210 (Postgres / Supabase): clinic system, diary module - M10 performance (handover §20.4): indexes only,
-- purely additive (see the SQLite file). Kept in step with db/migrations/sqlite/0210_pms_appointments_day_indexes.sql (db/parity.test.ts).
-- Idempotent.

CREATE INDEX IF NOT EXISTS pms_appointments_starts_on ON public.pms_appointments (tenant_id, starts_on);
CREATE INDEX IF NOT EXISTS pms_appointments_updated ON public.pms_appointments (tenant_id, updated_at);
