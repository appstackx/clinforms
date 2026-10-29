-- ClinForms 0211 (Postgres / Supabase): clinic system, records module - M10 performance (handover §20.4): indexes only,
-- purely additive (see the SQLite file). Kept in step with db/migrations/sqlite/0211_pms_clinical_notes_status_seen.sql (db/parity.test.ts).
-- Idempotent.

CREATE INDEX IF NOT EXISTS pms_clinical_notes_status_seen ON public.pms_clinical_notes (tenant_id, status, seen_on);
