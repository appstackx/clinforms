-- ClinForms 0212 (Postgres / Supabase): clinic system, billing module - M10 performance (handover §20.4): indexes only,
-- purely additive (see the SQLite file). Kept in step with db/migrations/sqlite/0212_pms_invoices_open.sql (db/parity.test.ts).
-- Idempotent.

CREATE INDEX IF NOT EXISTS pms_invoices_open ON public.pms_invoices (tenant_id, status, id) WHERE status = 'issued' AND total_pence - paid_pence - credited_pence <> 0;
CREATE INDEX IF NOT EXISTS pms_invoices_created ON public.pms_invoices (tenant_id, created_at);
