-- ClinForms 0222 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC08).
-- A practitioner's own provider number with each insurer (insurers register practitioners as well as the clinic).
-- One row per practitioner and insurer, removed when the number is cleared. New table only (additive).
-- Kept in step with supabase/migrations/20261024000222_pms_practitioner_insurer_numbers.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_practitioner_insurer_numbers (
  tenant_id TEXT NOT NULL,
  practitioner_id TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  provider_number TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, practitioner_id, referrer_id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS pms_practitioner_insurer_numbers_referrer ON pms_practitioner_insurer_numbers (tenant_id, referrer_id);
