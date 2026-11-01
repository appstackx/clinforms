-- ClinForms 0220 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC06).
-- One row per payer account (an insurer of pms_referrers) with what Healthcode needs to route the clinic's bills:
-- the insurer's Healthcode identifier (for example bup) and the clinic's own provider number with that insurer,
-- plus whether this insurer needs a diagnosis code on every bill (NULL = the default for its name).
-- No row = not set up yet. Rows are changed, never deleted. New table only (additive).
-- Kept in step with supabase/migrations/20261024000220_pms_payer_healthcode.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_payer_healthcode (
  tenant_id TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  insurer_code TEXT,
  provider_number TEXT,
  diagnosis_required INTEGER CHECK (diagnosis_required IS NULL OR diagnosis_required IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, referrer_id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
