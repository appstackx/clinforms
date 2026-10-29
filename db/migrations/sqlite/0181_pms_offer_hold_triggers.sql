-- ClinForms 0181 (SQLite / Cloudflare D1): clinic system, diary module - a held waiting-list offer cannot be
-- booked over (M9b, handover §19). An OPEN offer whose hold_until is later than the writing row's updated_at holds
-- its practitioner (and its room, when it has one) for its time: an occupying appointment or blocked time that
-- overlaps it is refused - unless it is for the patient the slot is held for (accepting the offer books exactly
-- that). Expiry needs no job: once updated_at passes hold_until the hold no longer counts. Declining or
-- withdrawing the offer (status) releases it at once.
-- An UPDATE that keeps an item where it is (same practitioner, room and times) and occupying is not re-checked, so
-- an appointment already there can still be marked arrived.
-- The messages start "CHECK constraint failed" (409 at the gateway, "clash" in the repositories).
-- Kept in step with supabase/migrations/20261024000181_pms_offer_hold_triggers.sql.
-- Idempotent. No BEGIN/COMMIT outside the trigger bodies. Keep semicolons out of comments.

CREATE INDEX IF NOT EXISTS pms_waiting_list_offers_hold ON pms_waiting_list_offers (tenant_id, practitioner_id, starts_at);

DROP TRIGGER IF EXISTS pms_appointments_no_hold_insert;
DROP TRIGGER IF EXISTS pms_appointments_no_hold_update;

CREATE TRIGGER IF NOT EXISTS pms_appointments_no_hold_insert BEFORE INSERT ON pms_appointments
WHEN NEW.status IN ('booked', 'arrived', 'attended', 'dna')
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_offer_hold')
  WHERE EXISTS (
    SELECT 1 FROM pms_waiting_list_offers o
    JOIN pms_waiting_list w ON w.tenant_id = o.tenant_id AND w.id = o.waiting_list_id
    WHERE o.tenant_id = NEW.tenant_id AND o.status = 'open' AND o.hold_until IS NOT NULL AND o.hold_until > NEW.updated_at
      AND o.starts_at < NEW.ends_at AND o.ends_at > NEW.starts_at
      AND ((NEW.practitioner_id IS NOT NULL AND o.practitioner_id = NEW.practitioner_id) OR (NEW.room_id IS NOT NULL AND o.room_id = NEW.room_id))
      AND (NEW.patient_id IS NULL OR w.patient_id <> NEW.patient_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS pms_appointments_no_hold_update BEFORE UPDATE OF starts_at, ends_at, practitioner_id, room_id, status ON pms_appointments
WHEN NEW.status IN ('booked', 'arrived', 'attended', 'dna')
  AND (OLD.status NOT IN ('booked', 'arrived', 'attended', 'dna') OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at
    OR NEW.practitioner_id IS NOT OLD.practitioner_id OR NEW.room_id IS NOT OLD.room_id)
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_offer_hold')
  WHERE EXISTS (
    SELECT 1 FROM pms_waiting_list_offers o
    JOIN pms_waiting_list w ON w.tenant_id = o.tenant_id AND w.id = o.waiting_list_id
    WHERE o.tenant_id = NEW.tenant_id AND o.status = 'open' AND o.hold_until IS NOT NULL AND o.hold_until > NEW.updated_at
      AND o.starts_at < NEW.ends_at AND o.ends_at > NEW.starts_at
      AND ((NEW.practitioner_id IS NOT NULL AND o.practitioner_id = NEW.practitioner_id) OR (NEW.room_id IS NOT NULL AND o.room_id = NEW.room_id))
      AND (NEW.patient_id IS NULL OR w.patient_id <> NEW.patient_id)
  );
END;
