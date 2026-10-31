-- ClinForms 0119 (SQLite / Cloudflare D1): clinic system, diary module - the clash triggers of 0110, replaced.
-- Khuram's decision A (28/10/2026):
-- PRACTITIONER - two occupying appointments of one practitioner at once are refused UNLESS the write is a
--   flagged double-booking: an appointment whose overbook_write_id equals its write_id (on an UPDATE also a NEW
--   write_id), set by the server only for a member holding "diary.override". Blocked time (leave, a meeting) is
--   never booked over, flagged or not.
-- ROOM - absolute, as before: never two occupying items in one room at once, whatever the flag.
-- An UPDATE that keeps the item where it is (same practitioner and times) and keeps it occupying - e.g. arrived,
--   in treatment, attended - re-checks only the room, so a logged double-booking can still be marked arrived.
-- The messages start "CHECK constraint failed" (409 at the gateway, "clash" in the repositories).
-- Kept in step with supabase/migrations/20261024000119_pms_appointments_clash_override.sql.
-- Idempotent. No BEGIN/COMMIT outside the trigger bodies. Keep semicolons out of comments.

DROP TRIGGER IF EXISTS pms_appointments_no_clash_insert;
DROP TRIGGER IF EXISTS pms_appointments_no_clash_update;

CREATE TRIGGER IF NOT EXISTS pms_appointments_no_clash_insert BEFORE INSERT ON pms_appointments
WHEN NEW.status IN ('booked', 'arrived', 'attended', 'dna')
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_practitioner_clash')
  WHERE NEW.practitioner_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM pms_appointments a
    WHERE a.tenant_id = NEW.tenant_id AND a.practitioner_id = NEW.practitioner_id AND a.id <> NEW.id
      AND a.status IN ('booked', 'arrived', 'attended', 'dna')
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at, '-1 day')
      AND (a.kind = 'block' OR NEW.kind = 'block' OR NEW.overbook_write_id IS NULL OR NEW.write_id IS NULL OR NEW.overbook_write_id <> NEW.write_id)
  );
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_room_clash')
  WHERE NEW.room_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM pms_appointments a
    WHERE a.tenant_id = NEW.tenant_id AND a.room_id = NEW.room_id AND a.id <> NEW.id
      AND a.status IN ('booked', 'arrived', 'attended', 'dna')
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at, '-1 day')
  );
END;

CREATE TRIGGER IF NOT EXISTS pms_appointments_no_clash_update BEFORE UPDATE OF starts_at, ends_at, practitioner_id, room_id, status ON pms_appointments
WHEN NEW.status IN ('booked', 'arrived', 'attended', 'dna')
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_practitioner_clash')
  WHERE NEW.practitioner_id IS NOT NULL
    AND (OLD.status NOT IN ('booked', 'arrived', 'attended', 'dna') OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR OLD.practitioner_id IS NULL OR NEW.practitioner_id <> OLD.practitioner_id)
    AND EXISTS (
    SELECT 1 FROM pms_appointments a
    WHERE a.tenant_id = NEW.tenant_id AND a.practitioner_id = NEW.practitioner_id AND a.id <> NEW.id
      AND a.status IN ('booked', 'arrived', 'attended', 'dna')
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at, '-1 day')
      AND (a.kind = 'block' OR NEW.kind = 'block' OR NEW.overbook_write_id IS NULL OR NEW.write_id IS NULL OR NEW.overbook_write_id <> NEW.write_id
        OR (OLD.write_id IS NOT NULL AND NEW.write_id = OLD.write_id))
  );
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_appointments_room_clash')
  WHERE NEW.room_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM pms_appointments a
    WHERE a.tenant_id = NEW.tenant_id AND a.room_id = NEW.room_id AND a.id <> NEW.id
      AND a.status IN ('booked', 'arrived', 'attended', 'dna')
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at, '-1 day')
  );
END;
