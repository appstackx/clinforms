-- ClinForms 0224 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC10).
-- A case's ICD-10 diagnosis code for insurer bills (encrypted like the invoice's: AAD
-- "<tenant>:pms_case_diagnosis.diagnosis_enc:<id>"). id IS the case id (one row per case, named id so the offboarding
-- export decrypts it like every other table). An insurer invoice uses its own code, else its case's.
-- One row per case, changed never deleted (cleared = NULL). New table only (additive).
-- Kept in step with supabase/migrations/20261024000224_pms_case_diagnosis.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_case_diagnosis (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  diagnosis_enc TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES pms_cases (tenant_id, id) ON DELETE CASCADE
);
