-- ClinForms 0144 (SQLite / Cloudflare D1): clinic system, comms - the payment mode of the clinic's saved customer
-- at the card payment service: 'test' or 'live' (NULL = saved before this column existed, which can only have been
-- test mode). A customer (and its saved card) made in test mode is never reused once live payments are on: the
-- clinic gets a new live customer, and the go-live step (npm run admin:billing-go-live) clears test references.
-- Kept in step with supabase/migrations/20261024000144_pms_sms_credit_accounts_mode.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_sms_credit_accounts ADD COLUMN customer_mode TEXT CHECK (customer_mode IS NULL OR customer_mode IN ('test', 'live'));
