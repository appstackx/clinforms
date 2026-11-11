-- ClinForms 0233 (SQLite / Cloudflare D1): clinic system, billing - courses (PK02).
-- pms_course_uses: a visit (diary appointment) used from a patient's course instead of being invoiced. One per
-- appointment while not reversed (pms_course_uses_appointment). Reversing keeps the row (reversed_at). The diary owns
-- appointments, so appointment_id has no foreign key (as pms_invoice_lines). New table only (additive).
-- Kept in step with supabase/migrations/20261024000233_pms_course_uses.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_course_uses (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_course_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  used_on TEXT NOT NULL CHECK (used_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reversed_at TEXT,
  reversed_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_course_id) REFERENCES pms_patient_courses (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pms_course_uses_appointment ON pms_course_uses (tenant_id, appointment_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS pms_course_uses_course ON pms_course_uses (tenant_id, patient_course_id, used_on);
