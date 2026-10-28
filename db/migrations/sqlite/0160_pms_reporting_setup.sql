-- ClinForms 0160 (SQLite / Cloudflare D1): clinic system, reporting and set-up module - opening hours and
-- closures of the sites (the ONE source of when a site is open: the diary's rota windows, free slots and online
-- booking are clipped to them, and the utilisation reports use them) and the clinic's report targets.
-- Edited in place before its first merge (never applied to any server database): the October draft's own staff
-- site-access tables were dropped - site access is the access module's (0103 pms_member_sites). Kept in step with
-- supabase/migrations/20261024000160_pms_reporting_setup.sql (db/parity.test.ts).
-- Every table carries tenant_id and every link includes it, so a row can never point at another clinic's row.
-- Times of day are TEXT HH:MM (UK local time), weekdays 1 Monday to 7 Sunday, dates TEXT YYYY-MM-DD.
-- These are set-up rows, not clinical records: a site's week is replaced as a whole and closures can be removed.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_site_hours (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at TEXT NOT NULL CHECK (length(opens_at) = 5),
  closes_at TEXT NOT NULL CHECK (length(closes_at) = 5),
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  CHECK (opens_at < closes_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_site_hours_site_day ON pms_site_hours (tenant_id, site_id, weekday, opens_at);

CREATE TABLE IF NOT EXISTS pms_site_closures (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  site_id TEXT,
  starts_on TEXT NOT NULL CHECK (length(starts_on) = 10),
  ends_on TEXT NOT NULL CHECK (length(ends_on) = 10),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 120),
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  CHECK (starts_on <= ends_on)
);
CREATE INDEX IF NOT EXISTS pms_site_closures_dates ON pms_site_closures (tenant_id, starts_on);

CREATE TABLE IF NOT EXISTS pms_reporting_settings (
  tenant_id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  utilisation_target_percent INTEGER NOT NULL DEFAULT 80 CHECK (utilisation_target_percent BETWEEN 1 AND 100),
  dna_target_tenths INTEGER NOT NULL DEFAULT 40 CHECK (dna_target_tenths BETWEEN 0 AND 500),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id)
);
