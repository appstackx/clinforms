-- ClinForms 0133 (SQLite / Cloudflare D1): clinic system, billing - the site an invoice belongs to.
-- Set from the site of the visits it bills (or the site chosen for a hand-made invoice), so a member who sees
-- only some sites sees only their invoices (K2-SITE-004). NULL = no site (seen by members who see every site).
-- No foreign key: SQLite cannot add a composite one with ALTER TABLE - the repositories check the site exists.
-- Kept in step with supabase/migrations/20261024000133_pms_invoices_site.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_invoices ADD COLUMN site_id TEXT;
