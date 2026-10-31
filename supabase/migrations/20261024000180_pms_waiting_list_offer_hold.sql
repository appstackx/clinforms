-- ClinForms 0180 (Postgres / Supabase): clinic system, diary module - pms_waiting_list_offers.hold_until: an open
-- offer holds its slot until this instant (see the SQLite file). NULL = no hold (offers made before holds existed).
-- Kept in step with db/migrations/sqlite/0180_pms_waiting_list_offer_hold.sql. Idempotent. No new table: row level
-- security and the revoke block of 0114 already cover pms_waiting_list_offers.
alter table public.pms_waiting_list_offers add column if not exists hold_until timestamptz;
create index if not exists pms_waiting_list_offers_hold on public.pms_waiting_list_offers (tenant_id, practitioner_id, starts_at) where status = 'open' and hold_until is not null;
