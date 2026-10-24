-- ClinForms 0150 (SQLite / Cloudflare D1): clinic system, portal module part 1 - online booking: the clinic's
-- booking settings, the weekly hours each practitioner offers online at a site, and the appointments booked
-- online (booking page or patient portal).
-- Kept in step with supabase/migrations/20261024000150_portal_booking.sql (db/parity.test.ts).
-- Composite (tenant_id, id) keys and foreign keys that include tenant_id. Times are ISO-8601 UTC text, calendar
-- dates TEXT YYYY-MM-DD, booleans 0/1. Online bookings are never deleted by the app (cancelled instead).
-- No double booking: a booked row may not overlap another booked row of the same practitioner (start to the
-- end of its buffer). The triggers below refuse it with a CHECK-constraint style message so every dialect and
-- the data gateway report it the same way. A move to another time (rebooked_from_id) is accepted only when the
-- earlier booking was cancelled as "rebooked" in the same write, and a booking can be moved only once.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_booking_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  online_booking INTEGER NOT NULL DEFAULT 0 CHECK (online_booking IN (0, 1)),
  portal INTEGER NOT NULL DEFAULT 0 CHECK (portal IN (0, 1)),
  new_patients INTEGER NOT NULL DEFAULT 1 CHECK (new_patients IN (0, 1)),
  min_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (min_notice_hours BETWEEN 0 AND 336),
  max_days_ahead INTEGER NOT NULL DEFAULT 42 CHECK (max_days_ahead BETWEEN 1 AND 365),
  slot_step_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (5, 10, 15, 20, 30, 60)),
  cancel_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (cancel_notice_hours BETWEEN 0 AND 336),
  patient_cancel INTEGER NOT NULL DEFAULT 1 CHECK (patient_cancel IN (0, 1)),
  intro_text TEXT CHECK (intro_text IS NULL OR length(intro_text) <= 600),
  cancellation_policy TEXT CHECK (cancellation_policy IS NULL OR length(cancellation_policy) <= 1000),
  contact_phone TEXT,
  contact_email TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pms_booking_hours (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  practitioner_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1435),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 5 AND 1440),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS pms_booking_hours_practitioner ON pms_booking_hours (tenant_id, practitioner_id, weekday);
CREATE INDEX IF NOT EXISTS pms_booking_hours_site ON pms_booking_hours (tenant_id, site_id, weekday);

CREATE TABLE IF NOT EXISTS pms_online_bookings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  reference TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  practitioner_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  blocks_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  channel TEXT NOT NULL CHECK (channel IN ('booking_page', 'portal', 'clinic')),
  patient_match TEXT NOT NULL CHECK (patient_match IN ('new', 'existing', 'portal')),
  cancelled_by TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN ('patient', 'clinic')),
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('patient_request', 'rebooked', 'clinic', 'other')),
  cancelled_at TEXT,
  late_cancellation INTEGER NOT NULL DEFAULT 0 CHECK (late_cancellation IN (0, 1)),
  rebooked_from_id TEXT,
  appointment_id TEXT,
  manage_token_hash TEXT,
  manage_expires_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, rebooked_from_id) REFERENCES pms_online_bookings (tenant_id, id),
  CHECK (ends_at > starts_at AND blocks_until >= ends_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_reference ON pms_online_bookings (tenant_id, reference);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_manage_token ON pms_online_bookings (tenant_id, manage_token_hash);
CREATE INDEX IF NOT EXISTS pms_online_bookings_practitioner ON pms_online_bookings (tenant_id, practitioner_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_online_bookings_patient ON pms_online_bookings (tenant_id, patient_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_online_bookings_created ON pms_online_bookings (tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_rebooked_from ON pms_online_bookings (tenant_id, rebooked_from_id);

CREATE TRIGGER IF NOT EXISTS pms_online_bookings_no_overlap_insert BEFORE INSERT ON pms_online_bookings
WHEN NEW.status = 'booked'
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_online_bookings_overlap')
  WHERE EXISTS (
    SELECT 1 FROM pms_online_bookings b
    WHERE b.tenant_id = NEW.tenant_id AND b.practitioner_id = NEW.practitioner_id AND b.status = 'booked'
      AND b.id <> NEW.id AND b.starts_at < NEW.blocks_until AND NEW.starts_at < b.blocks_until
  );
END;

CREATE TRIGGER IF NOT EXISTS pms_online_bookings_no_overlap_update BEFORE UPDATE OF status, starts_at, blocks_until, practitioner_id ON pms_online_bookings
WHEN NEW.status = 'booked'
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_online_bookings_overlap')
  WHERE EXISTS (
    SELECT 1 FROM pms_online_bookings b
    WHERE b.tenant_id = NEW.tenant_id AND b.practitioner_id = NEW.practitioner_id AND b.status = 'booked'
      AND b.id <> NEW.id AND b.starts_at < NEW.blocks_until AND NEW.starts_at < b.blocks_until
  );
END;

CREATE TRIGGER IF NOT EXISTS pms_online_bookings_rebook_insert BEFORE INSERT ON pms_online_bookings
WHEN NEW.rebooked_from_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_online_bookings_rebook')
  WHERE NOT EXISTS (
    SELECT 1 FROM pms_online_bookings b
    WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.rebooked_from_id AND b.status = 'cancelled' AND b.cancel_reason = 'rebooked'
      AND b.patient_id = NEW.patient_id
  );
END;
