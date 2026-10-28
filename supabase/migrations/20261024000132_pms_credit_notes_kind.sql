-- ClinForms 0132 (Postgres / Supabase): clinic system, billing - what a credit note is for (credit, write_off,
-- void, transfer). Kept in step with db/migrations/sqlite/0132_pms_credit_notes_kind.sql.
-- Idempotent. No new table: row level security and the revoke block of 0130 already cover pms_credit_notes.
alter table public.pms_credit_notes add column if not exists kind text not null default 'credit' check (kind in ('credit', 'write_off', 'void', 'transfer'));
