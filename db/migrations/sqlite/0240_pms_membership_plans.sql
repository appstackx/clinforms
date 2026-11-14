-- ClinForms 0240 (SQLite / Cloudflare D1): clinic system, billing - membership plans (pk03): a name, a monthly price
-- in pence and its VAT code. Switched off, never deleted. Hangs off pms_card_settings (ON DELETE CASCADE, offboarding).
-- Kept in step with supabase/migrations/20261024000240_pms_membership_plans.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_membership_plans (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  price_pence INTEGER NOT NULL CHECK (price_pence BETWEEN 30 AND 100000),
  vat_code TEXT NOT NULL DEFAULT 'exempt' CHECK (vat_code IN ('exempt', 'standard', 'reduced', 'zero')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_membership_plans_name ON pms_membership_plans (tenant_id, name);
