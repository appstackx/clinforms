-- ClinForms 0138 (SQLite / Cloudflare D1): clinic system, billing - the patient contribution per visit an insured
-- invoice was split with (whole pence), kept on both halves of the split (the insurer's and the patient's) so the
-- invoice reads the same after the case or its payer account changes. NULL = the excess per case (or no split).
-- Kept in step with supabase/migrations/20261024000138_pms_invoices_contribution.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_invoices ADD COLUMN per_visit_contribution_pence INTEGER CHECK (per_visit_contribution_pence IS NULL OR per_visit_contribution_pence > 0);
