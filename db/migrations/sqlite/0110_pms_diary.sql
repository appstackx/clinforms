-- ClinForms 0110 (SQLite / Cloudflare D1): clinic system, diary module - appointments and blocked time,
-- recurring series, practitioner rotas (availability) and the waiting list.
-- Kept in step with supabase/migrations/20261024000110_pms_diary.sql (db/parity.test.ts).
-- Composite (tenant_id, id) keys, foreign keys that include tenant_id. An appointment's case must be a case of
-- its patient (foreign key to the unique (tenant_id, patient_id, id) of pms_cases).
-- Times are ISO-8601 UTC instants with milliseconds (compared as text here - the CHECKs pin the format, without
-- long GLOB patterns: D1 refuses patterns over 50 characters),
-- starts_on is the UK calendar date of the start. Booking, cancellation and waiting-list notes are AES-GCM
-- encrypted per clinic in the _enc columns. Diary items are never deleted by the app: they are cancelled.
-- NO DOUBLE BOOKING: two items that overlap in time and share a practitioner or a room cannot both occupy the
-- diary (status booked, arrived, attended or dna - cancelled and late_cancelled free the slot). The triggers
-- below refuse the INSERT or UPDATE, so the rule holds whatever writes the row. An item lasts at most one day,
-- which keeps the triggers' look-back bounded.
-- Idempotent. No BEGIN/COMMIT outside the trigger bodies. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_appointment_series (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  interval_weeks INTEGER NOT NULL CHECK (interval_weeks BETWEEN 1 AND 8),
  occurrences INTEGER NOT NULL CHECK (occurrences BETWEEN 1 AND 52),
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pms_availability (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  practitioner_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  room_id TEXT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  every_weeks INTEGER NOT NULL DEFAULT 1 CHECK (every_weeks BETWEEN 1 AND 4),
  valid_from TEXT NOT NULL CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT CHECK (valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  online_bookable INTEGER NOT NULL DEFAULT 1 CHECK (online_bookable IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (end_minute > start_minute),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES pms_rooms (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_availability_practitioner ON pms_availability (tenant_id, practitioner_id, weekday);
CREATE INDEX IF NOT EXISTS pms_availability_site ON pms_availability (tenant_id, site_id, weekday);
CREATE UNIQUE INDEX IF NOT EXISTS pms_availability_import_ref ON pms_availability (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_appointments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  kind TEXT NOT NULL CHECK (kind IN ('appointment', 'block')),
  site_id TEXT NOT NULL,
  practitioner_id TEXT,
  room_id TEXT,
  patient_id TEXT,
  case_id TEXT,
  service_id TEXT,
  authorisation_id TEXT,
  series_id TEXT,
  starts_at TEXT NOT NULL CHECK (length(starts_at) = 24 AND substr(starts_at, 11, 1) = 'T' AND substr(starts_at, 24, 1) = 'Z' AND julianday(starts_at) IS NOT NULL),
  ends_at TEXT NOT NULL CHECK (length(ends_at) = 24 AND substr(ends_at, 11, 1) = 'T' AND substr(ends_at, 24, 1) = 'Z' AND julianday(ends_at) IS NOT NULL),
  starts_on TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('booked', 'arrived', 'attended', 'dna', 'late_cancelled', 'cancelled')),
  block_kind TEXT CHECK (block_kind IS NULL OR block_kind IN ('leave', 'meeting', 'training', 'admin', 'closed', 'other')),
  title TEXT CHECK (title IS NULL OR length(title) <= 80),
  notes_enc TEXT,
  source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'online', 'import')),
  fee_due INTEGER NOT NULL DEFAULT 0 CHECK (fee_due IN (0, 1)),
  fee_pence INTEGER CHECK (fee_pence IS NULL OR fee_pence >= 0),
  auth_session_used INTEGER NOT NULL DEFAULT 0 CHECK (auth_session_used IN (0, 1)),
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN ('patient', 'clinic', 'practitioner_unavailable', 'illness', 'weather', 'other')),
  cancel_note_enc TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  status_at TEXT,
  status_by TEXT,
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (julianday(ends_at) - julianday(starts_at) <= 1.0),
  CHECK (practitioner_id IS NOT NULL OR room_id IS NOT NULL),
  CHECK (kind = 'block' OR (patient_id IS NOT NULL AND service_id IS NOT NULL AND practitioner_id IS NOT NULL)),
  CHECK (kind = 'appointment' OR (patient_id IS NULL AND case_id IS NULL AND authorisation_id IS NULL)),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES pms_rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, authorisation_id) REFERENCES pms_authorisations (tenant_id, id),
  FOREIGN KEY (tenant_id, series_id) REFERENCES pms_appointment_series (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_appointments_starts ON pms_appointments (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_appointments_site_starts ON pms_appointments (tenant_id, site_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_appointments_practitioner_starts ON pms_appointments (tenant_id, practitioner_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_appointments_room_starts ON pms_appointments (tenant_id, room_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_appointments_patient_starts ON pms_appointments (tenant_id, patient_id, starts_at);
CREATE INDEX IF NOT EXISTS pms_appointments_case ON pms_appointments (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS pms_appointments_series ON pms_appointments (tenant_id, series_id);
CREATE INDEX IF NOT EXISTS pms_appointments_fee_due ON pms_appointments (tenant_id, fee_due, starts_on);
CREATE UNIQUE INDEX IF NOT EXISTS pms_appointments_import_ref ON pms_appointments (tenant_id, import_ref);

-- The clash rule (see the top of this file). The message starts "CHECK constraint failed" so the data gateway
-- and the repositories treat it like any other refused write (409, a plain message).
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
  WHERE NEW.practitioner_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM pms_appointments a
    WHERE a.tenant_id = NEW.tenant_id AND a.practitioner_id = NEW.practitioner_id AND a.id <> NEW.id
      AND a.status IN ('booked', 'arrived', 'attended', 'dna')
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND a.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at, '-1 day')
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

CREATE TABLE IF NOT EXISTS pms_waiting_list (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  service_id TEXT,
  practitioner_id TEXT,
  site_id TEXT,
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('urgent', 'soon', 'routine')),
  preferred_days TEXT CHECK (preferred_days IS NULL OR preferred_days GLOB '[1-7]*'),
  preferred_time TEXT NOT NULL DEFAULT 'any' CHECK (preferred_time IN ('any', 'morning', 'afternoon', 'evening')),
  earliest_on TEXT CHECK (earliest_on IS NULL OR earliest_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  latest_on TEXT CHECK (latest_on IS NULL OR latest_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'booked', 'removed')),
  notes_enc TEXT,
  booked_appointment_id TEXT,
  removed_reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, booked_appointment_id) REFERENCES pms_appointments (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_waiting_list_status ON pms_waiting_list (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS pms_waiting_list_patient ON pms_waiting_list (tenant_id, patient_id);
