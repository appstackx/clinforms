-- ClinForms 0150 (SQLite / Cloudflare D1): clinic system, portal module part 1 - online booking: the clinic's
-- booking settings, which sites take online bookings (with the site's map position for "distance from you",
-- worked out in the patient's browser only) and a log of the appointments booked online.
-- Kept in step with supabase/migrations/20261024000150_portal_booking.sql (db/parity.test.ts).
-- Composite (tenant_id, id) keys and foreign keys that include tenant_id. Times are ISO-8601 UTC text, booleans 0/1.
-- ONE APPOINTMENT STORE: an online booking IS a diary appointment (pms_appointments, source online) written by the
-- diary's own repository, so the diary's clash rule and triggers cover it. pms_online_bookings only adds what the
-- diary does not hold: the reference the patient sees, how the patient record was found (staff only) and the hash
-- of the "manage this booking" link (the secret itself is never stored). One row per appointment.
-- Never deleted by the app. Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

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

CREATE TABLE IF NOT EXISTS pms_booking_sites (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  online INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0, 1)),
  lat_e6 INTEGER CHECK (lat_e6 IS NULL OR lat_e6 BETWEEN -90000000 AND 90000000),
  lng_e6 INTEGER CHECK (lng_e6 IS NULL OR lng_e6 BETWEEN -180000000 AND 180000000),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  CHECK ((lat_e6 IS NULL) = (lng_e6 IS NULL))
);

CREATE TABLE IF NOT EXISTS pms_online_bookings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  reference TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('booking_page', 'portal')),
  patient_match TEXT NOT NULL CHECK (patient_match IN ('new', 'existing', 'portal')),
  manage_token_hash TEXT CHECK (manage_token_hash IS NULL OR length(manage_token_hash) = 64),
  manage_expires_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES pms_appointments (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_reference ON pms_online_bookings (tenant_id, reference);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_appointment ON pms_online_bookings (tenant_id, appointment_id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_online_bookings_manage_token ON pms_online_bookings (tenant_id, manage_token_hash);
CREATE INDEX IF NOT EXISTS pms_online_bookings_patient ON pms_online_bookings (tenant_id, patient_id, created_at);
CREATE INDEX IF NOT EXISTS pms_online_bookings_created ON pms_online_bookings (tenant_id, created_at);
