-- ClinForms 0128 (SQLite / Cloudflare D1): clinic system, records module - home exercise programmes, part 3 (tracker
-- ex05): the patient's check-ins from the portal. Behind CLINFORMS_EXERCISE=on and the clinic's own setting (0126).
--   pms_exercise_checkins: at most one per programme per UK day (done_on) - a second check-in the same day changes
--     that day's row (revision-checked). completed 0/1 (did the exercises), pain_score 0-10 (optional), comment
--     (optional, encrypted - comment_enc, AAD tenant:table.column:id). Only on a SHARED programme, only by the
--     patient whose programme it is (the foreign key names the patient too).
--   Hangs off pms_exercise_programmes (ON DELETE CASCADE): offboarding names no new table.
-- Kept in step with supabase/migrations/20261024000128_pms_exercise_checkins.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_exercise_checkins (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  programme_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  done_on TEXT NOT NULL CHECK (done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  pain_score INTEGER CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10),
  comment_enc TEXT,
  anonymised_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, programme_id, done_on),
  FOREIGN KEY (tenant_id, programme_id, patient_id) REFERENCES pms_exercise_programmes (tenant_id, id, patient_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_exercise_checkins_patient ON pms_exercise_checkins (tenant_id, patient_id, done_on);
