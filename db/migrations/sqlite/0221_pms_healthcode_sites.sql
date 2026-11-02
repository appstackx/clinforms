-- ClinForms 0221 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC07).
-- pms_healthcode_settings: one row per clinic with its Healthcode Site ID and payee provider number (who is paid),
-- hung off the clinic's pms_billing_settings row (created with it when missing) so it is deleted with it.
-- pms_site_healthcode: a site's own Site ID and payee provider number where a site is registered separately
-- (NULL = the clinic's). No row = not set up yet. New tables only (additive).
-- Kept in step with supabase/migrations/20261024000221_pms_healthcode_sites.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_healthcode_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL CHECK (rev > 0),
  site_code TEXT,
  payee_provider_number TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_site_healthcode (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  site_code TEXT,
  payee_provider_number TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id) ON DELETE CASCADE
);
