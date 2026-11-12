-- ClinForms 0171 (SQLite / Cloudflare D1): clinic system, integration - the PUBLIC CLINIC API v1 (tracker xt03).
-- Built behind the platform switch CLINFORMS_CLINIC_API=on AND a per-clinic setting that is OFF by default.
-- pms_api_settings: one row per clinic. No row = off. enabled 0/1. Written (if missing) with a clinic's first key.
-- pms_api_keys: the clinic's API keys. The key itself is shown once and never stored - only its SHA-256 (key_hash)
--   and the parts that name it: lookup (16 random characters, the key's own id inside the key, unique per clinic)
--   and last4. scopes_json = the scopes granted, site_ids_json = the sites it may see (NULL = every site),
--   expires_at (NULL = no end), last_used_at and use_count (counted on every call, no audit row per call),
--   revoked_at / revoked_by, replaced_by_id (rotation: the new key that replaced it).
-- pms_api_key_days: calls and patient reads per key per UK day (the use counter shown in the settings screen).
--   The first call of a day writes one audit row for the key.
-- pms_api_idempotency: one row per Idempotency-Key of a key that booked an appointment, written in the SAME atomic
--   batch as the appointment. request_sha256 = SHA-256 of the canonical request (a replay with another body is
--   refused). Unique per clinic, key and Idempotency-Key.
-- Offboarding: keys hang off the clinic's settings row, days and idempotency rows off their key, all ON DELETE
--   CASCADE, so offboarding names only pms_api_settings (PMS_CASCADE_DELETED_TABLES). No encrypted columns.
-- Kept in step with supabase/migrations/20261024000171_pms_clinic_api.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_api_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pms_api_keys (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lookup TEXT NOT NULL CHECK (length(lookup) = 16),
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  last4 TEXT NOT NULL CHECK (length(last4) = 4),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  scopes_json TEXT NOT NULL,
  site_ids_json TEXT,
  expires_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  replaced_by_id TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_api_settings (tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_api_keys_lookup ON pms_api_keys (tenant_id, lookup);
CREATE INDEX IF NOT EXISTS pms_api_keys_created ON pms_api_keys (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS pms_api_key_days (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  patient_reads INTEGER NOT NULL DEFAULT 0 CHECK (patient_reads >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key_id, day),
  FOREIGN KEY (tenant_id, key_id) REFERENCES pms_api_keys (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_api_idempotency (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  idem_key TEXT NOT NULL CHECK (length(idem_key) BETWEEN 8 AND 100),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  appointment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, key_id) REFERENCES pms_api_keys (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES pms_appointments (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_api_idempotency_key ON pms_api_idempotency (tenant_id, key_id, idem_key);
CREATE INDEX IF NOT EXISTS pms_api_idempotency_appointment ON pms_api_idempotency (tenant_id, appointment_id);
