-- ClinForms 0141 (SQLite / Cloudflare D1): clinic system, comms module part 2 - letter templates and letters
-- (to the patient, their GP, a referrer or payer). Kept in step with
-- supabase/migrations/20261024000141_pms_letters.sql (db/parity.test.ts).
-- A letter is clinical correspondence: its subject and body are encrypted per clinic (subject_enc, body_enc), it
-- is never deleted by the app (a letter sent in error is withdrawn - status void - and kept), and a final letter
-- no longer changes. A letter's case must be one of the same patient's cases (the foreign key goes to the
-- case's (tenant_id, patient_id, id) unique index).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_letter_templates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('patient', 'gp', 'referrer', 'other')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_letter_templates_name ON pms_letter_templates (tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_letter_templates_import_ref ON pms_letter_templates (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_letters (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  template_id TEXT,
  practitioner_id TEXT,
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('patient', 'gp', 'referrer', 'other')),
  recipient_referrer_id TEXT,
  recipient_name TEXT,
  recipient_address_json TEXT,
  recipient_postcode TEXT,
  recipient_email TEXT,
  letter_on TEXT NOT NULL CHECK (length(letter_on) = 10),
  subject_enc TEXT NOT NULL,
  body_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'void')),
  finalised_at TEXT,
  finalised_by TEXT,
  sent_at TEXT,
  sent_via TEXT CHECK (sent_via IS NULL OR sent_via IN ('post', 'email', 'hand')),
  voided_at TEXT,
  voided_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES pms_letter_templates (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, recipient_referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_letters_patient ON pms_letters (tenant_id, patient_id, id);
CREATE INDEX IF NOT EXISTS pms_letters_status ON pms_letters (tenant_id, status, id);
