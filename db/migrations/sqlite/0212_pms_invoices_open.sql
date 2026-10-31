-- ClinForms 0212 (SQLite / Cloudflare D1): clinic system, billing module - M10 performance (handover §20.4): indexes only,
-- purely additive (no table, column or row changes). pms_invoices_open holds only OPEN invoices (issued, with a balance either way) - the billing figures, outstanding and overdue lists, aged debt and owes-money read those instead of every invoice ever raised. Queries repeat its WHERE as literal SQL (OPEN_INVOICE in src/server/repos/pms/billing/shared.ts) so SQLite and D1 use it. created_at serves the invoice list's newest-first order.
-- Kept in step with supabase/migrations/20261024000212_pms_invoices_open.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE INDEX IF NOT EXISTS pms_invoices_open ON pms_invoices (tenant_id, status, id) WHERE status = 'issued' AND total_pence - paid_pence - credited_pence <> 0;
CREATE INDEX IF NOT EXISTS pms_invoices_created ON pms_invoices (tenant_id, created_at);
