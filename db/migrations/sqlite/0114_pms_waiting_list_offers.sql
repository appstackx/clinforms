-- ClinForms 0114 (SQLite / Cloudflare D1): clinic system, diary module - slots offered to patients on the waiting
-- list. Reception offers a free slot (by phone, or a message later), the entry shows as "offered", and the offer
-- is then accepted (booked from the entry in the same atomic write), declined or withdrawn. An offer does not
-- hold the slot: booking it runs the normal clash checks. Never deleted (history of what was offered).
-- Kept in step with supabase/migrations/20261024000114_pms_waiting_list_offers.sql (db/parity.test.ts).
-- Composite (tenant_id, id) keys, foreign keys that include tenant_id. Idempotent. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_waiting_list_offers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  waiting_list_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  practitioner_id TEXT NOT NULL,
  room_id TEXT,
  service_id TEXT,
  starts_at TEXT NOT NULL CHECK (length(starts_at) = 24 AND substr(starts_at, 11, 1) = 'T' AND substr(starts_at, 24, 1) = 'Z' AND julianday(starts_at) IS NOT NULL),
  ends_at TEXT NOT NULL CHECK (length(ends_at) = 24 AND substr(ends_at, 11, 1) = 'T' AND substr(ends_at, 24, 1) = 'Z' AND julianday(ends_at) IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn')),
  appointment_id TEXT,
  write_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tenant_id, waiting_list_id) REFERENCES pms_waiting_list (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES pms_rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES pms_appointments (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_waiting_list_offers_entry ON pms_waiting_list_offers (tenant_id, waiting_list_id, created_at);
