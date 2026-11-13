-- ClinForms 0229 (SQLite / Cloudflare D1): clinic system, billing - the provider's webhook events for a clinic's
-- connected account, one row per event id (evt_...) once handled: type, the object it named and the outcome. A
-- repeated delivery of a handled event is answered at once and changes nothing. Hangs off pms_card_settings
-- (ON DELETE CASCADE, offboarding only).
-- Kept in step with supabase/migrations/20261024000229_pms_card_events.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_card_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 100),
  object_ref TEXT,
  outcome TEXT NOT NULL CHECK (length(outcome) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_card_events_created ON pms_card_events (tenant_id, created_at);
