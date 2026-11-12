-- ClinForms 0126 (SQLite / Cloudflare D1): clinic system, records module - home exercise programmes, part 1 (tracker
-- ex03): the clinic's switch and its own exercise library. Built behind the platform switch CLINFORMS_EXERCISE=on
-- AND this per-clinic setting, both OFF by default (docs/clinic-system/exercise-programmes.md).
--   pms_exercise_settings: one row per clinic (id 'exercises'). No row = off. enabled 0/1. It hangs off the clinic's
--     pms_records_settings row (records_id = 'records', written if missing in the same batch) with ON DELETE CASCADE,
--     so offboarding names no new table (the gateway statement limit, src/server/auth/offboard-batch.test.ts).
--   pms_exercises: the clinic's OWN library - name, body area, instructions, cautions, an optional picture link and
--     video link (https only, shown as links - nothing is embedded or fetched). Configuration written by the clinic,
--     not patient data: plain. Archived (active 0), never deleted. Hangs off pms_exercise_settings (cascade).
-- Kept in step with supabase/migrations/20261024000126_pms_exercise_library.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_exercise_settings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id = 'exercises'),
  records_id TEXT NOT NULL DEFAULT 'records' CHECK (records_id = 'records'),
  rev INTEGER NOT NULL CHECK (rev > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, records_id) REFERENCES pms_records_settings (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_exercises (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  settings_id TEXT NOT NULL DEFAULT 'exercises' CHECK (settings_id = 'exercises'),
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  body_area TEXT CHECK (body_area IS NULL OR length(body_area) BETWEEN 1 AND 60),
  instructions TEXT CHECK (instructions IS NULL OR length(instructions) <= 2000),
  cautions TEXT CHECK (cautions IS NULL OR length(cautions) <= 1000),
  image_url TEXT CHECK (image_url IS NULL OR (length(image_url) <= 500 AND image_url LIKE 'https://%')),
  video_url TEXT CHECK (video_url IS NULL OR (length(video_url) <= 500 AND video_url LIKE 'https://%')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, settings_id) REFERENCES pms_exercise_settings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_exercises_name ON pms_exercises (tenant_id, active, name);
