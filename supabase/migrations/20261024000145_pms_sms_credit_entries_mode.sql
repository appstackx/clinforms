-- ClinForms 0145 (Postgres / Supabase): clinic system, comms - pms_sms_credit_entries.mode, the payment mode
-- ('test' / 'live') of a paid entry (purchase, auto_topup); NULL otherwise and for purchases made before this column
-- existed (test mode). See db/migrations/sqlite/0145_pms_sms_credit_entries_mode.sql (kept in step).
-- Adding a column does not touch the append-only trigger of 0143 (it refuses UPDATE of rows, not ALTER TABLE).
-- No new table: row level security and the revoke block of 0143 already cover it. Idempotent.

alter table public.pms_sms_credit_entries add column if not exists mode text check (mode is null or mode in ('test', 'live'));
