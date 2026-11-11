-- ClinForms 0231 (SQLite / Cloudflare D1): clinic system, billing - courses (PK02, docs/clinic-system/courses-giftcards-products.md).
-- pms_course_types: a block of sessions the clinic sells up front (e.g. 6 follow-ups), the services it covers
-- (service_ids_json, a JSON array of service ids), the price in pence, its VAT code and how many days it is valid
-- from the sale (NULL = no expiry). Archived (active = 0), never deleted. Hangs off the clinic's pms_billing_settings
-- row (ON DELETE CASCADE, offboarding only - written first in the same batch) like the Healthcode settings (0221), so
-- offboarding does not name it in its one-batch delete. New table only (additive).
-- Kept in step with supabase/migrations/20261024000231_pms_course_types.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_course_types (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  service_ids_json TEXT NOT NULL,
  sessions INTEGER NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  price_pence INTEGER NOT NULL CHECK (price_pence BETWEEN 0 AND 100000000),
  vat_code TEXT NOT NULL CHECK (vat_code IN ('exempt', 'standard', 'reduced', 'zero')),
  valid_days INTEGER CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3650),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pms_course_types_name ON pms_course_types (tenant_id, active, name);
