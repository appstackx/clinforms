-- ClinForms 0227 (SQLite / Cloudflare D1): clinic system, billing - card readers at the desk (cp03). One row per
-- reader registered on the clinic's connected account: the site it stands at, the provider's location (tml_...) and
-- reader (tmr_...) ids on the connected account account_ref (a reader belongs to one account and mode), a label, simulated (1 = the provider's test reader). Removed by status, never deleted.
-- Hangs off the clinic's pms_card_settings row and its site (ON DELETE CASCADE, offboarding only).
-- Kept in step with supabase/migrations/20261024000227_pms_card_readers.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_card_readers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  location_ref TEXT NOT NULL,
  reader_ref TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  device_type TEXT,
  simulated INTEGER NOT NULL DEFAULT 0 CHECK (simulated IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_at TEXT,
  removed_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_readers_reader ON pms_card_readers (tenant_id, reader_ref);
CREATE INDEX IF NOT EXISTS pms_card_readers_site ON pms_card_readers (tenant_id, site_id, status);
