-- ClinForms 0152 (SQLite / Cloudflare D1): clinic system, portal module part 3 - intake and consent forms: the
-- clinic's form templates (no patient data) and each patient's copy of a form (requested, then completed and
-- signed with a typed name). A patient's copy keeps a snapshot of the form it was answered on, the answers and
-- the typed name encrypted, and the SHA-256 of what was signed.
-- A completed copy is sealed: the triggers refuse any change to its form, answers, signature or seal (only the
-- review and record-update markers can still change). Never deleted by the app (cancelled instead).
-- An outcome questionnaire (kind outcome, one of the records module's measures) is a patient's copy without a
-- template: the patient answers it in the portal, and the score lands in pms_outcome_measures (outcome_id).
-- A copy sent for an appointment points at the diary's appointment (appointment_id).
-- Kept in step with supabase/migrations/20261024000152_portal_intake.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_intake_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('intake', 'questionnaire', 'consent', 'outcome')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  send_when TEXT NOT NULL DEFAULT 'manual' CHECK (send_when IN ('manual', 'new_patient', 'every_booking')),
  requires_signature INTEGER NOT NULL DEFAULT 0 CHECK (requires_signature IN (0, 1)),
  signature_statement TEXT,
  sets_treatment_consent INTEGER NOT NULL DEFAULT 0 CHECK (sets_treatment_consent IN (0, 1)),
  definition_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_intake_templates_name ON pms_intake_templates (tenant_id, name);

CREATE TABLE IF NOT EXISTS pms_intake_responses (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  template_id TEXT,
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('intake', 'questionnaire', 'consent', 'outcome')),
  patient_id TEXT NOT NULL,
  appointment_id TEXT,
  measure TEXT CHECK (measure IS NULL OR measure IN ('ndi', 'odi', 'nprs', 'psfs', 'quickdash')),
  case_id TEXT,
  outcome_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'submitted', 'cancelled')),
  form_json TEXT NOT NULL,
  requires_signature INTEGER NOT NULL DEFAULT 0 CHECK (requires_signature IN (0, 1)),
  signature_statement TEXT,
  sets_treatment_consent INTEGER NOT NULL DEFAULT 0 CHECK (sets_treatment_consent IN (0, 1)),
  answers_enc TEXT,
  signature_name_enc TEXT,
  signed_at TEXT,
  trust TEXT CHECK (trust IS NULL OR trust IN ('verified', 'unverified')),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  applied_at TEXT,
  applied_by TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES pms_intake_templates (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES pms_appointments (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, outcome_id) REFERENCES pms_outcome_measures (tenant_id, id),
  CHECK ((kind = 'outcome') = (measure IS NOT NULL)),
  CHECK (kind = 'outcome' OR template_id IS NOT NULL),
  CHECK (status <> 'submitted' OR (answers_enc IS NOT NULL AND submitted_at IS NOT NULL AND content_sha256 IS NOT NULL)),
  CHECK (requires_signature = 0 OR status <> 'submitted' OR (signature_name_enc IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pms_intake_responses_patient ON pms_intake_responses (tenant_id, patient_id, requested_at);
CREATE INDEX IF NOT EXISTS pms_intake_responses_status ON pms_intake_responses (tenant_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS pms_intake_responses_appointment ON pms_intake_responses (tenant_id, appointment_id);

CREATE TRIGGER IF NOT EXISTS pms_intake_responses_sealed BEFORE UPDATE OF form_json, answers_enc, signature_name_enc, signed_at, content_sha256, patient_id, template_id, submitted_at, status ON pms_intake_responses
WHEN OLD.status = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: pms_intake_responses_sealed')
  WHERE NEW.form_json IS NOT OLD.form_json OR NEW.answers_enc IS NOT OLD.answers_enc OR NEW.signature_name_enc IS NOT OLD.signature_name_enc
    OR NEW.signed_at IS NOT OLD.signed_at OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.patient_id IS NOT OLD.patient_id
    OR NEW.template_id IS NOT OLD.template_id OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.status IS NOT OLD.status;
END;
