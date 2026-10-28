-- ClinForms 0139 (SQLite / Cloudflare D1): clinic system, billing - the bank details printed on invoices and
-- statements (Set-up → Billing settings): JSON {"accountName","sortCode","accountNumber"}, NULL = none shown.
-- One column (not three) because SQLite has no ADD COLUMN IF NOT EXISTS and a file holds ONE such statement.
-- Kept in step with supabase/migrations/20261024000139_pms_billing_bank.sql (db/parity.test.ts).
ALTER TABLE pms_billing_settings ADD COLUMN bank_details_json TEXT CHECK (bank_details_json IS NULL OR length(bank_details_json) <= 400);
