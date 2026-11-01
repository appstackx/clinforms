-- ClinForms 0145 (SQLite / Cloudflare D1): clinic system, comms - the payment mode of a paid ledger entry
-- (purchase, auto_topup): 'test' or 'live'. NULL on every other entry, and on purchases recorded before this column
-- existed (test mode only - there was no live mode then). Test-mode purchases are reversed at go-live with a
-- recorded reason (npm run admin:billing-go-live, docs/clinic-system/BILLING.md).
-- Kept in step with supabase/migrations/20261024000145_pms_sms_credit_entries_mode.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_sms_credit_entries ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode IN ('test', 'live'));
