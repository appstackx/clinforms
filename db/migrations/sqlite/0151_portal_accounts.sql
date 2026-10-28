-- ClinForms 0151 (SQLite / Cloudflare D1): clinic system, portal module part 2 - the patient portal: patients'
-- portal accounts (separate from staff accounts - no password, no Better Auth user), one-time sign-in links and
-- signed-in sessions (only SHA-256 hashes of their secrets are stored) and documents staff explicitly share with a patient
-- (body encrypted). The portal's emails go through the
-- clinic-system message log (comms, pms_messages) - the portal keeps no outbox of its own.
-- Kept in step with supabase/migrations/20261024000151_portal_accounts.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_portal_accounts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_sign_in_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_portal_accounts_patient ON pms_portal_accounts (tenant_id, patient_id);

CREATE TABLE IF NOT EXISTS pms_portal_links (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES pms_portal_accounts (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_portal_links_token ON pms_portal_links (tenant_id, token_hash);
CREATE INDEX IF NOT EXISTS pms_portal_links_account ON pms_portal_links (tenant_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS pms_portal_sessions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES pms_portal_accounts (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_portal_sessions_account ON pms_portal_sessions (tenant_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS pms_portal_shares (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body_enc TEXT NOT NULL,
  shared_by TEXT,
  shared_at TEXT NOT NULL,
  viewed_at TEXT,
  withdrawn_at TEXT,
  withdrawn_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_portal_shares_patient ON pms_portal_shares (tenant_id, patient_id, shared_at);
