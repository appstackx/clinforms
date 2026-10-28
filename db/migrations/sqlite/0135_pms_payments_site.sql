-- ClinForms 0135 (SQLite / Cloudflare D1): clinic system, billing - the site a payment was taken at (the
-- "Taken today" figure and site-limited lists). NULL = not at a site (an insurer's remittance by bank transfer).
-- Kept in step with supabase/migrations/20261024000135_pms_payments_site.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_payments ADD COLUMN site_id TEXT;
