-- ClinForms 0113 (Postgres / Supabase): clinic system, diary module - pms_waiting_list.write_id, set fresh by
-- every change of the entry so its audit row is written in the same atomic batch (see the SQLite file).
-- Kept in step with db/migrations/sqlite/0113_pms_waiting_list_write_id.sql. Idempotent.
-- No new table: row level security and the revoke block of 0110 already cover pms_waiting_list.
alter table public.pms_waiting_list add column if not exists write_id text;
