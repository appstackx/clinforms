-- ClinForms 0213 (Postgres / Supabase): clinic system, foundation module - M10 performance (handover §20.4): indexes only,
-- purely additive (see the SQLite file). Kept in step with db/migrations/sqlite/0213_pms_cases_practitioner.sql (db/parity.test.ts).
-- Idempotent.

CREATE INDEX IF NOT EXISTS pms_cases_practitioner ON public.pms_cases (tenant_id, practitioner_id, status);
