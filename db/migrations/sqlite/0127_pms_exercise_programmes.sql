-- ClinForms 0127 (SQLite / Cloudflare D1): clinic system, records module - home exercise programmes, part 2 (tracker
-- ex03/ex04): a patient's programme. Behind CLINFORMS_EXERCISE=on and the clinic's own setting (0126).
--   pms_exercise_programmes: one row per programme. status: draft (being written - only staff see it), shared (in
--     the patient's portal, printable, locked - a change is a NEW version that replaces it), ended (kept on the
--     record). The title, the note to the patient and the exercises (a JSON array of name, instructions, cautions,
--     links, sets, reps, hold, times a day, days a week, notes - a SNAPSHOT of the library at the time) are clinical
--     information: encrypted (title_enc, notes_enc, items_enc - AES-GCM, AAD tenant:table.column:id).
--     item_count plain (lists). case_id and replaces_id are plain ids checked by the app (no foreign key, so the
--     offboarding's delete order is unchanged). shared_by_name = who prescribed it, as printed.
--     patient_viewed_at = the first time the patient opened it in the portal.
--   At most ONE shared successor per programme (review fix): a partial unique index on replaces_id over the rows
--     ever shared - two new versions of the same programme can never both be shared (also under concurrent shares).
--   Hangs off pms_patients (ON DELETE CASCADE): offboarding names no new table. Nothing else deletes a patient.
-- Kept in step with supabase/migrations/20261024000127_pms_exercise_programmes.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_exercise_programmes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  replaces_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shared', 'ended')),
  title_enc TEXT,
  notes_enc TEXT,
  items_enc TEXT,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 30),
  shared_at TEXT,
  shared_by TEXT,
  shared_by_name TEXT CHECK (shared_by_name IS NULL OR length(shared_by_name) <= 200),
  ended_at TEXT,
  ended_by TEXT,
  patient_viewed_at TEXT,
  created_by TEXT,
  anonymised_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'shared' OR shared_at IS NOT NULL),
  CHECK (status <> 'ended' OR ended_at IS NOT NULL),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, id, patient_id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_exercise_programmes_patient ON pms_exercise_programmes (tenant_id, patient_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS pms_exercise_programmes_one_successor ON pms_exercise_programmes (tenant_id, replaces_id) WHERE replaces_id IS NOT NULL AND shared_at IS NOT NULL;
