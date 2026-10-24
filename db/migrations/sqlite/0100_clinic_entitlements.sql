-- ClinForms 0100 (SQLite / Cloudflare D1): clinic-system foundation, part 1 - packages per clinic
-- (entitlements), monthly usage counters and the clinic-system settings. Kept in step with
-- supabase/migrations/20261024000100_clinic_entitlements.sql (db/parity.test.ts).
-- Packages: "reports" (ClinForms as it is) and "clinic" (the clinic system). A clinic WITHOUT a row keeps the
-- default - reports ON, clinic OFF - so nothing changes for any clinic until a row says otherwise.
-- The backfill below writes the explicit "reports = active" row for every existing clinic.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments (wrangler splits on them).

CREATE TABLE IF NOT EXISTS clinic_entitlements (
  tenant_id TEXT NOT NULL,
  package TEXT NOT NULL CHECK (package IN ('reports', 'clinic')),
  status TEXT NOT NULL CHECK (status IN ('active', 'trial', 'paused', 'cancelled')),
  plan_code TEXT CHECK (plan_code IS NULL OR length(plan_code) <= 40),
  price_source TEXT CHECK (price_source IS NULL OR price_source IN ('list', 'founding', 'design_partner')),
  limits_json TEXT,
  starts_at TEXT,
  ends_at TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, package)
);

CREATE TABLE IF NOT EXISTS clinic_usage_counters (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (length(period) = 7),
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period, metric)
);

CREATE TABLE IF NOT EXISTS pms_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  retention_adult_years INTEGER NOT NULL DEFAULT 8 CHECK (retention_adult_years BETWEEN 8 AND 100),
  retention_child_until_age INTEGER NOT NULL DEFAULT 25 CHECK (retention_child_until_age BETWEEN 25 AND 40),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every existing clinic keeps Reports: an explicit row, written once (an existing row is left alone).
INSERT INTO clinic_entitlements (tenant_id, package, status, plan_code, price_source, limits_json, starts_at, ends_at, note, updated_by, created_at, updated_at)
SELECT tenant_id, 'reports', 'active', NULL, NULL, NULL, created_at, NULL, 'Existing clinic (migration 0100)', NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM clinic_profile
WHERE true
ON CONFLICT (tenant_id, package) DO NOTHING;
