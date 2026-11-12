-- ClinForms 0172 (SQLite / Cloudflare D1): clinic system, integration - XERO SYNC groundwork (tracker xe03-xe06,
-- docs/clinic-system/decisions/xero-sync-scope.md). One way only: ClinDesk sends issued invoices, credit notes and
-- payment allocations (and the contacts they need) to the clinic's own Xero organisation.
-- Built behind the platform switch CLINFORMS_XERO=on AND a per-clinic setting (enabled) that is OFF by default.
-- pms_xero_connections: one row per clinic (no row = off). enabled 0/1 = the clinic's own switch. status
--   not_connected / connected / paused (Xero refused our tokens - reconnect) / disconnected. tokens_sealed = the
--   access and refresh tokens, ENCRYPTED with the data envelope (AAD "<tenant>:pms_xero_connections.tokens_sealed:
--   <tenant>"). Deliberately not an "_enc" column: offboarding's export decrypts every _enc column, and a live
--   refresh token must never land in an export file in clear. refresh_lock_until = one refresh at a time (a refresh
--   token is single-use). state_hash / state_session / state_user / state_expires_at = the pending OAuth state
--   (SHA-256 only, tied to the signed-in session, single use, 10 minutes). send_from = only invoices issued on or
--   after it are sent. Hangs off the clinic's pms_billing_settings row (ON DELETE CASCADE, offboarding only).
-- pms_xero_mappings: what each ClinDesk thing is in Xero - map_kind + local_key -> xero_value (an account code, a
--   tax type, a tracking option) and the label shown on screen.
-- pms_xero_links: ClinDesk record -> Xero id (contacts, invoices, credit notes, payments). A record with a link is
--   never created in Xero again (idempotency, with Xero's own Idempotency-Key header and a look-up by number).
-- pms_xero_sync_items: the send list. id = "<local_type>:<op>:<local id>" so queuing the same record twice is a
--   no-op (primary key). status pending / in_flight / done / failed / blocked / skipped, attempts, next_attempt_at
--   (back-off), lease_until (one worker at a time), error_class transient / validation / auth, error_message (plain
--   words, quoted values removed - no patient data), payload_version (bumped by Retry, part of the Idempotency-Key).
-- Mappings, links and sync items hang off the clinic's connection row (ON DELETE CASCADE), so offboarding names no
--   new table. Kept in step with supabase/migrations/20261024000172_pms_xero_sync.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_xero_connections (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'connected', 'paused', 'disconnected')),
  xero_tenant_id TEXT CHECK (xero_tenant_id IS NULL OR length(xero_tenant_id) <= 64),
  connection_id TEXT CHECK (connection_id IS NULL OR length(connection_id) <= 64),
  org_name TEXT CHECK (org_name IS NULL OR length(org_name) <= 200),
  base_currency TEXT CHECK (base_currency IS NULL OR length(base_currency) = 3),
  tokens_sealed TEXT,
  access_expires_at TEXT,
  refresh_lock_until TEXT,
  scopes TEXT CHECK (scopes IS NULL OR length(scopes) <= 500),
  send_from TEXT CHECK (send_from IS NULL OR send_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  send_contact_details INTEGER NOT NULL DEFAULT 0 CHECK (send_contact_details IN (0, 1)),
  state_hash TEXT CHECK (state_hash IS NULL OR length(state_hash) = 64),
  state_session TEXT,
  state_user TEXT,
  state_expires_at TEXT,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  connected_by TEXT,
  connected_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_xero_connections_active ON pms_xero_connections (status, enabled);

CREATE TABLE IF NOT EXISTS pms_xero_mappings (
  tenant_id TEXT NOT NULL,
  map_kind TEXT NOT NULL CHECK (map_kind IN ('default_account', 'item_account', 'visit_account', 'service_account', 'write_off_account', 'payment_account', 'tax_type', 'tracking')),
  local_key TEXT NOT NULL CHECK (length(local_key) BETWEEN 1 AND 100),
  xero_value TEXT NOT NULL CHECK (length(xero_value) BETWEEN 1 AND 100),
  xero_label TEXT CHECK (xero_label IS NULL OR length(xero_label) <= 200),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, map_kind, local_key),
  FOREIGN KEY (tenant_id) REFERENCES pms_xero_connections (tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_xero_links (
  tenant_id TEXT NOT NULL,
  local_type TEXT NOT NULL CHECK (local_type IN ('patient', 'referrer', 'invoice', 'credit_note', 'allocation')),
  local_id TEXT NOT NULL,
  xero_id TEXT NOT NULL CHECK (length(xero_id) BETWEEN 1 AND 64),
  xero_number TEXT CHECK (xero_number IS NULL OR length(xero_number) <= 100),
  sent_hash TEXT CHECK (sent_hash IS NULL OR length(sent_hash) = 64),
  pushed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, local_type, local_id),
  FOREIGN KEY (tenant_id) REFERENCES pms_xero_connections (tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_xero_sync_items (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 120),
  local_type TEXT NOT NULL CHECK (local_type IN ('invoice', 'credit_note', 'allocation')),
  local_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create', 'delete')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_flight', 'done', 'failed', 'blocked', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload_version INTEGER NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  error_class TEXT CHECK (error_class IS NULL OR error_class IN ('transient', 'validation', 'auth', 'waiting')),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),
  xero_id TEXT CHECK (xero_id IS NULL OR length(xero_id) <= 64),
  done_at TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_xero_connections (tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_xero_sync_items_due ON pms_xero_sync_items (tenant_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS pms_xero_sync_items_local ON pms_xero_sync_items (tenant_id, local_type, local_id);
