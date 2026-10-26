-- ClinForms 0170 (SQLite / Cloudflare D1): clinic system, integration module - data import from an earlier
-- system (batches and their staged rows), "Complete referrer form" requests from a case (the referrer and the
-- patient's consent to share), and completed referrer forms filed back to the patient's record (file in
-- encrypted parts).
-- Kept in step with supabase/migrations/20261024000170_pms_integration.sql (db/parity.test.ts).
-- Staged import rows hold the uploaded values AES-GCM encrypted (data_enc) and are wiped once a row is
-- imported, or the batch is cancelled or closed. Issues are codes and field names only, never values.
-- Filed forms are clinical records: never deleted by the app (only offboarding a whole clinic removes them).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_import_batches (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  kind TEXT NOT NULL CHECK (kind IN ('patients', 'cases', 'appointments', 'invoices')),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'mapping', 'checking', 'checked', 'approved', 'importing', 'imported', 'undoing', 'undone', 'cancelled')),
  file_name_enc TEXT,
  file_sha256 TEXT CHECK (file_sha256 IS NULL OR length(file_sha256) = 64),
  delimiter TEXT NOT NULL DEFAULT ',' CHECK (delimiter IN (',', ';', 'tab')),
  headers_enc TEXT,
  column_count INTEGER NOT NULL CHECK (column_count BETWEEN 1 AND 200),
  expected_rows INTEGER NOT NULL CHECK (expected_rows BETWEEN 0 AND 100000),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  mapping_json TEXT,
  counts_json TEXT,
  lease_until TEXT,
  directory_added_json TEXT,
  created_by TEXT,
  checked_by TEXT,
  checked_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  imported_by TEXT,
  imported_at TEXT,
  undone_by TEXT,
  undone_at TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_import_batches_created ON pms_import_batches (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS pms_import_batches_status ON pms_import_batches (tenant_id, status);

CREATE TABLE IF NOT EXISTS pms_import_rows (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  row_no INTEGER NOT NULL CHECK (row_no > 0),
  data_enc TEXT,
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'ready', 'error', 'duplicate', 'imported', 'skipped', 'undone', 'kept')),
  issues_json TEXT,
  patient_id TEXT,
  case_id TEXT,
  target_id TEXT,
  target_rev INTEGER CHECK (target_rev IS NULL OR target_rev > 0),
  extra_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES pms_import_batches (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES pms_cases (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_import_rows_batch_row ON pms_import_rows (tenant_id, batch_id, row_no);
CREATE INDEX IF NOT EXISTS pms_import_rows_batch_status ON pms_import_rows (tenant_id, batch_id, status, row_no);
CREATE INDEX IF NOT EXISTS pms_import_rows_batch_ref ON pms_import_rows (tenant_id, batch_id, source_ref);
CREATE INDEX IF NOT EXISTS pms_import_rows_patient ON pms_import_rows (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS pms_import_rows_case ON pms_import_rows (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS pms_import_rows_target ON pms_import_rows (tenant_id, target_id);

CREATE TABLE IF NOT EXISTS pms_form_requests (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  referrer_id TEXT,
  consent_recorded INTEGER NOT NULL DEFAULT 0 CHECK (consent_recorded IN (0, 1)),
  consent_on TEXT CHECK (consent_on IS NULL OR consent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  consent_note_enc TEXT,
  requested_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_form_requests_case ON pms_form_requests (tenant_id, case_id, created_at);

CREATE TABLE IF NOT EXISTS pms_filed_forms (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  file_name_enc TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  part_count INTEGER NOT NULL CHECK (part_count > 0),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  report_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  signer_name TEXT,
  signer_registration TEXT,
  signed_at TEXT,
  filed_by TEXT,
  filed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_filed_forms_report_file ON pms_filed_forms (tenant_id, report_id, sha256);
CREATE INDEX IF NOT EXISTS pms_filed_forms_patient ON pms_filed_forms (tenant_id, patient_id, filed_at);
CREATE INDEX IF NOT EXISTS pms_filed_forms_case ON pms_filed_forms (tenant_id, case_id);

CREATE TABLE IF NOT EXISTS pms_filed_form_parts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  filed_form_id TEXT NOT NULL,
  idx INTEGER NOT NULL CHECK (idx >= 0),
  data_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, filed_form_id) REFERENCES pms_filed_forms (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_filed_form_parts_form_idx ON pms_filed_form_parts (tenant_id, filed_form_id, idx);
