-- ClinForms 0144 (Postgres / Supabase): clinic system, comms - pms_sms_credit_accounts.customer_mode, the payment
-- mode ('test' / 'live') of the clinic's saved customer at the card payment service (NULL = saved before this
-- column existed: test mode). See db/migrations/sqlite/0144_pms_sms_credit_accounts_mode.sql (kept in step).
-- No new table: row level security and the revoke block of 0143 already cover it. Idempotent.

alter table public.pms_sms_credit_accounts add column if not exists customer_mode text check (customer_mode is null or customer_mode in ('test', 'live'));
