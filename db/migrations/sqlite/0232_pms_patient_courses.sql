-- ClinForms 0232 (SQLite / Cloudflare D1): clinic system, billing - courses (PK02).
-- pms_patient_courses: a course sold to a patient. Made when the invoice that sells it is issued (sold = issued),
-- from the invoice line (sale_line_id, one course per line). sessions_total and expires_on are fixed at the sale.
-- status: active, used_up (every session used), expired (kept for a later sweep - the screens work it out from
-- expires_on), cancelled (closed, the unused part credited). Never deleted. Every foreign key goes with its
-- parent (ON DELETE CASCADE) for offboarding only - nothing in the app deletes those parents.
-- New table only (additive). Kept in step with supabase/migrations/20261024000232_pms_patient_courses.sql.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_patient_courses (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  course_type_id TEXT NOT NULL,
  case_id TEXT,
  sale_invoice_id TEXT NOT NULL,
  sale_line_id TEXT NOT NULL,
  sessions_total INTEGER NOT NULL CHECK (sessions_total BETWEEN 1 AND 100),
  sold_on TEXT NOT NULL CHECK (sold_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_on TEXT CHECK (expires_on IS NULL OR expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used_up', 'expired', 'cancelled')),
  cancelled_at TEXT,
  cancel_credit_note_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, course_type_id) REFERENCES pms_course_types (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, case_id) REFERENCES pms_cases (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sale_invoice_id) REFERENCES pms_invoices (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sale_line_id) REFERENCES pms_invoice_lines (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pms_patient_courses_sale_line ON pms_patient_courses (tenant_id, sale_line_id);
CREATE INDEX IF NOT EXISTS pms_patient_courses_patient ON pms_patient_courses (tenant_id, patient_id, status);
