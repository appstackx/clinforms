-- ClinForms 0142 (Postgres / Supabase): clinic system, comms - when a text held for the quiet hours (a waiting-list
-- offer) may go (NULL = not held).
-- Kept in step with db/migrations/sqlite/0142_pms_messages_hold.sql. Idempotent.
alter table public.pms_messages add column if not exists hold_until timestamptz;
