-- ClinForms 0125 (SQLite / Cloudflare D1): clinic system, records module - two additions to the patient record that
-- the shared (foundation) patient table does not hold, each in the records module's own table keyed by the patient.
--   pms_patient_extras: one row per patient (id = the patient's id) - pronouns (plain, shown with the name like the
--     title). No row = nothing recorded.
--   pms_clinical_flags: clinical flags such as "on anticoagulants" (K2-PAT-014) - the words are encrypted
--     (flag_enc, AES-GCM, AAD tenant:table.column:id) and only clinicians, owners and administrators read them,
--     never reception. A flag is ended (status), never deleted. Anonymisation clears the words.
-- Kept in step with supabase/migrations/20261024000125_pms_patient_extras_clinical_flags.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_patient_extras (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  pronouns TEXT CHECK (pronouns IS NULL OR length(pronouns) BETWEEN 1 AND 40),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES pms_patients (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pms_clinical_flags (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  flag_enc TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_by TEXT,
  ended_at TEXT,
  ended_by TEXT,
  anonymised_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'ended' OR ended_at IS NOT NULL),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_clinical_flags_patient ON pms_clinical_flags (tenant_id, patient_id, status);
