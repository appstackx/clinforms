-- ClinForms 0120 (SQLite / Cloudflare D1): clinic system, records module - note templates, clinical notes and
-- their amendments, outcome measures, attached files (encrypted in chunks) and patient anonymisations.
-- Kept in step with supabase/migrations/20261024000120_pms_records.sql (db/parity.test.ts).
-- Every table: PRIMARY KEY (tenant_id, id), foreign keys that include tenant_id (a row can never point at another
-- clinic's row) and, where a row belongs to a patient, the patient too (a note's case, an amendment's note, an
-- outcome's note must be the SAME patient's). Free text and files are AES-GCM encrypted per clinic in the _enc
-- columns (AAD tenant:table.column:id). Clinical records are never deleted by the app or any scheduled job -
-- drafts are discarded, files withdrawn, outcomes marked in error. Signed notes are locked (0121 triggers).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_note_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  note_type TEXT NOT NULL CHECK (note_type IN ('initial', 'follow_up', 'discharge', 'general')),
  sections_json TEXT NOT NULL,
  body_chart INTEGER NOT NULL DEFAULT 0 CHECK (body_chart IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  based_on TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_note_templates_name ON pms_note_templates (tenant_id, name);

CREATE TABLE IF NOT EXISTS pms_clinical_notes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  template_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  note_type TEXT NOT NULL CHECK (note_type IN ('initial', 'follow_up', 'discharge', 'general')),
  template_json TEXT NOT NULL,
  seen_on TEXT NOT NULL CHECK (seen_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  practitioner_id TEXT,
  author_user_id TEXT,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'discarded')),
  sections_enc TEXT,
  body_chart_enc TEXT,
  content_hash TEXT,
  signed_at TEXT,
  signed_by_user_id TEXT,
  signed_by_name TEXT,
  signed_registration TEXT,
  entered_in_error INTEGER NOT NULL DEFAULT 0 CHECK (entered_in_error IN (0, 1)),
  amendment_count INTEGER NOT NULL DEFAULT 0 CHECK (amendment_count >= 0),
  discarded_at TEXT,
  anonymised_at TEXT,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND content_hash IS NOT NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_clinical_notes_patient_id ON pms_clinical_notes (tenant_id, patient_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_clinical_notes_import_ref ON pms_clinical_notes (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_clinical_notes_patient_seen ON pms_clinical_notes (tenant_id, patient_id, seen_on);
CREATE INDEX IF NOT EXISTS pms_clinical_notes_case ON pms_clinical_notes (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS pms_clinical_notes_author ON pms_clinical_notes (tenant_id, author_user_id, status);

CREATE TABLE IF NOT EXISTS pms_note_amendments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('addendum', 'correction', 'entered_in_error')),
  section_key TEXT,
  text_enc TEXT,
  reason_enc TEXT,
  author_user_id TEXT,
  author_name TEXT,
  author_registration TEXT,
  anonymised_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, note_id) REFERENCES pms_clinical_notes (tenant_id, patient_id, id)
);
CREATE INDEX IF NOT EXISTS pms_note_amendments_note ON pms_note_amendments (tenant_id, note_id, id);
CREATE INDEX IF NOT EXISTS pms_note_amendments_patient ON pms_note_amendments (tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS pms_outcome_measures (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  note_id TEXT,
  measure TEXT NOT NULL CHECK (measure IN ('ndi', 'odi', 'nprs', 'psfs', 'quickdash')),
  taken_on TEXT NOT NULL CHECK (taken_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  score_tenths INTEGER NOT NULL CHECK (score_tenths BETWEEN 0 AND 1000),
  band TEXT,
  answered INTEGER NOT NULL CHECK (answered >= 0),
  answers_enc TEXT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'entered_in_error')),
  error_reason_enc TEXT,
  error_at TEXT,
  recorded_by TEXT,
  anonymised_at TEXT,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, patient_id, note_id) REFERENCES pms_clinical_notes (tenant_id, patient_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_outcome_measures_import_ref ON pms_outcome_measures (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_outcome_measures_patient ON pms_outcome_measures (tenant_id, patient_id, measure, taken_on);

CREATE TABLE IF NOT EXISTS pms_attachments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  note_id TEXT,
  case_id TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'jpeg', 'png', 'docx')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4000000),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
  file_name_enc TEXT,
  description_enc TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  withdrawn_at TEXT,
  withdrawn_by TEXT,
  withdrawn_reason_enc TEXT,
  uploaded_by TEXT,
  anonymised_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, note_id) REFERENCES pms_clinical_notes (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id)
);
CREATE INDEX IF NOT EXISTS pms_attachments_patient ON pms_attachments (tenant_id, patient_id, created_at);

CREATE TABLE IF NOT EXISTS pms_attachment_chunks (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  idx INTEGER NOT NULL CHECK (idx >= 0),
  data_enc TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, attachment_id) REFERENCES pms_attachments (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_attachment_chunks_idx ON pms_attachment_chunks (tenant_id, attachment_id, idx);

CREATE TABLE IF NOT EXISTS pms_patient_anonymisations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'done')),
  started_at TEXT NOT NULL,
  done_at TEXT,
  by_user_id TEXT,
  counts_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_patient_anonymisations_patient ON pms_patient_anonymisations (tenant_id, patient_id);
