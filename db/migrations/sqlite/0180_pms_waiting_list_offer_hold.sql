-- ClinForms 0180 (SQLite / Cloudflare D1): clinic system, diary module - pms_waiting_list_offers.hold_until.
-- A slot offered to a waiting patient is HELD until this instant (M9b, handover §19): while the offer is open and
-- the hold has not passed, nobody else can book, move or block over it (triggers of 0181), it shows in the diary
-- and it is left out of free slots and online booking. Declining or withdrawing the offer releases it at once,
-- expiry releases it by itself (no job: the check compares with the writing row's updated_at). NULL = an offer
-- made before holds existed (no hold).
-- Kept in step with supabase/migrations/20261024000180_pms_waiting_list_offer_hold.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_waiting_list_offers ADD COLUMN hold_until TEXT CHECK (hold_until IS NULL OR (length(hold_until) = 24 AND substr(hold_until, 11, 1) = 'T' AND substr(hold_until, 24, 1) = 'Z' AND julianday(hold_until) IS NOT NULL));
