-- ClinForms 0223 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC09).
-- pms_service_codes: a service's CCSD code (the national schedule code for the treatment), one row per service.
-- pms_service_insurer_codes: the insurer's own treatment code (ISC) for a service, one row per service and insurer,
-- removed when cleared. No code values are built in - the clinic types them in. New tables only (additive).
-- Kept in step with supabase/migrations/20261024000223_pms_service_codes.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_service_codes (
  tenant_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  ccsd_code TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, service_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_service_insurer_codes (
  tenant_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  isc_code TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, service_id, referrer_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pms_service_insurer_codes_referrer ON pms_service_insurer_codes (tenant_id, referrer_id);
