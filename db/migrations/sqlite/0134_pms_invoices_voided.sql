-- ClinForms 0134 (SQLite / Cloudflare D1): clinic system, billing - when an issued invoice was voided.
-- A void is a full credit note of kind 'void' (0132) plus this instant, so lists can say "Void" without reading
-- the credit notes. Kept in step with supabase/migrations/20261024000134_pms_invoices_voided.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_invoices ADD COLUMN voided_at TEXT;
