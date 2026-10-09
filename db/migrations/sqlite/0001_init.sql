-- ClinForms 0001_init (SQLite / Cloudflare D1). Kept in step with
-- supabase/migrations/20261010000001_init.sql (db/parity.test.ts checks tables and columns match).
-- Conventions: ids TEXT, timestamps ISO-8601 UTC TEXT, booleans INTEGER 0/1, JSON and ciphertext TEXT.
-- Idempotent (IF NOT EXISTS), so a re-run is harmless. No BEGIN/COMMIT in this file: wrangler and
-- scripts/db/migrate.ts wrap each file themselves. Keep semicolons out of comments (wrangler splits on them).

CREATE TABLE IF NOT EXISTS clinic_profile (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  legal_name TEXT,
  address_json TEXT,
  postcode TEXT,
  phone TEXT,
  email TEXT,
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days > 0),
  drafting_enabled INTEGER NOT NULL DEFAULT 0 CHECK (drafting_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clinic_profile_organization_id ON clinic_profile (organization_id);

CREATE TABLE IF NOT EXISTS member_profile (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  job_title TEXT,
  hcpc_number TEXT,
  can_sign INTEGER NOT NULL DEFAULT 0 CHECK (can_sign IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  referrer_links_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forms (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  referrer TEXT,
  kind TEXT NOT NULL,
  sample_id TEXT,
  payload_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS forms_tenant_updated ON forms (tenant_id, updated_at);

CREATE TABLE IF NOT EXISTS form_files (
  tenant_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sha256)
);

CREATE TABLE IF NOT EXISTS form_file_chunks (
  tenant_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  idx INTEGER NOT NULL CHECK (idx >= 0),
  data_enc TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sha256, idx),
  FOREIGN KEY (tenant_id, sha256) REFERENCES form_files (tenant_id, sha256) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  status TEXT NOT NULL,
  form_id TEXT,
  template_id TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delete_after TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS reports_tenant_updated ON reports (tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS reports_delete_after ON reports (delete_after);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_id ON audit_log (tenant_id, id);

-- Append-only: refuse every UPDATE and DELETE.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE IF NOT EXISTS partner_keys (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_keys_key_hash ON partner_keys (key_hash);
CREATE INDEX IF NOT EXISTS partner_keys_tenant ON partner_keys (tenant_id);

CREATE TABLE IF NOT EXISTS launch_token_uses (
  jti TEXT NOT NULL PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS launch_token_uses_expires_at ON launch_token_uses (expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  "key" TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY ("key", window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_start ON rate_limits (window_start);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT NOT NULL PRIMARY KEY,
  clinic_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS access_requests_created_at ON access_requests (created_at);
