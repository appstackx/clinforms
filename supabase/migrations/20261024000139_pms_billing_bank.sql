-- ClinForms 0139 (Postgres / Supabase): clinic system, billing - the bank details printed on invoices and statements
-- (JSON {"accountName","sortCode","accountNumber"}, NULL = none shown).
-- Kept in step with db/migrations/sqlite/0139_pms_billing_bank.sql. Idempotent.
alter table public.pms_billing_settings add column if not exists bank_details_json text check (bank_details_json is null or length(bank_details_json) <= 400);
