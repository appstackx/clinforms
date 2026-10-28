-- ClinForms 0006 (SQLite / Cloudflare D1): clinic_plan - a clinic's trial and its own drafting limits, set by
-- ClinForms staff only (the platform page /app/platform or npm run admin:set-trial / admin:set-limits). One row
-- per clinic, keyed by the clinic id (tenant_id = organization slug), like clinic_profile. No row = a clinic
-- without a trial on the default limits (every clinic made before this migration).
--   status                 standard = no trial (a row only for its own limits), trial = time-limited,
--                          paid = the trial was converted to a paid account (full access)
--   trial_days             the length of the trial in days
--   start_on_first_sign_in 1 = the trial starts when an owner first opens the clinic area (trial_starts_at
--                          and trial_ends_at stay NULL until then), 0 = it started when it was set
--   trial_starts_at / trial_ends_at   the trial's window (ISO-8601 UTC)
--   owner_first_sign_in_at when an owner first opened the clinic area after the plan was set
--   ended_at               when the trial was converted to paid (or ended early)
--   live_calls_per_minute / live_calls_per_day   the clinic's own drafting limits (NULL = the defaults)
-- Kept in step with supabase/migrations/20261024000006_clinic_plan.sql. Idempotent.
CREATE TABLE IF NOT EXISTS clinic_plan (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('standard', 'trial', 'paid')),
  trial_days INTEGER CHECK (trial_days IS NULL OR (trial_days > 0 AND trial_days <= 366)),
  start_on_first_sign_in INTEGER NOT NULL DEFAULT 0 CHECK (start_on_first_sign_in IN (0, 1)),
  trial_starts_at TEXT,
  trial_ends_at TEXT,
  owner_first_sign_in_at TEXT,
  ended_at TEXT,
  live_calls_per_minute INTEGER CHECK (live_calls_per_minute IS NULL OR live_calls_per_minute > 0),
  live_calls_per_day INTEGER CHECK (live_calls_per_day IS NULL OR live_calls_per_day > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
