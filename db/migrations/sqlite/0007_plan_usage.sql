-- ClinForms 0007 (SQLite / Cloudflare D1): packages and usage (25/10/2026). Kept in step with
-- supabase/migrations/20261025000007_plan_usage.sql. Idempotent. No patient data in any of these tables:
-- ids, counts, prices and token totals only.
--
-- clinic_package - the clinic's package, set by ClinForms staff only (platform page /app/platform or
--   npm run admin:set-package). One row per clinic. No row = no package yet (every clinic made before
--   this migration keeps working as before). Money in pence, ex VAT. Dates are UK calendar dates (YYYY-MM-DD).
--   package               starter | practice | group | group_plus | custom | trial
--   monthly_price_pence   the list price a month
--   reports_included      reports a month within the package
--   extra_report_pence    the price of each report above the allowance (charging comes later), NULL = not
--                         agreed yet (extra reports are still counted and shown, with no price)
--   founding_price_pence  optional founding price a month, fixed until founding_until (inclusive)
--   setup_fee_pence / setup_fee_status   optional one-off set-up fee and whether it is due, paid or waived
--   starts_on             the package's start date
--   notes                 internal notes, never shown to the clinic
--
-- clinic_usage - one row per clinic and UK calendar month (period YYYY-MM). Counters only. It is never
--   deleted by report retention, so a month's numbers stay after its reports are gone. package and the
--   plan_* columns are the package as it applied to that month (filled from clinic_package when the row is
--   made, refreshed when ClinForms staff change the package during the month).
--   billable_reports      reports counted towards the allowance (once each - see usage_report)
--   billable_on_approval  of those, reports counted at approval because nothing was drafted for them
--   drafting_calls / failed_calls / reading_calls   live drafting calls, those that failed, live form readings
--   *_tokens, cost_micro_usd   token totals and the estimated cost of every live call (micro US dollars)
--
-- usage_report - one row per report that was started, drafted or approved, so a report counts once only
--   (re-drafting and re-approving never count again). Keyed by report_id AND episode_fp - the server's keyed
--   fingerprint of what the report is about (episode, template or form, patient - an HMAC that identifies
--   nobody, '' when an event carried none) - so the same report id used for another patient or form counts on
--   its own. root_report_id = the first version of an amended report (an amendment of an approved report
--   with the same fingerprint never counts again). The *_event columns name the usage event that made each
--   first transition (the counters read them in the same batch).
--
-- usage_event - which usage events have been applied (by id), so a retried write never counts twice.
--   Kept for a week by the retention job.
CREATE TABLE IF NOT EXISTS clinic_package (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  package TEXT NOT NULL CHECK (package IN ('starter', 'practice', 'group', 'group_plus', 'custom', 'trial')),
  monthly_price_pence INTEGER NOT NULL CHECK (monthly_price_pence >= 0 AND monthly_price_pence <= 100000000),
  reports_included INTEGER NOT NULL CHECK (reports_included >= 0 AND reports_included <= 1000000),
  extra_report_pence INTEGER CHECK (extra_report_pence IS NULL OR (extra_report_pence >= 0 AND extra_report_pence <= 10000000)),
  founding_price_pence INTEGER CHECK (founding_price_pence IS NULL OR (founding_price_pence >= 0 AND founding_price_pence <= 100000000)),
  founding_until TEXT,
  setup_fee_pence INTEGER CHECK (setup_fee_pence IS NULL OR (setup_fee_pence >= 0 AND setup_fee_pence <= 100000000)),
  setup_fee_status TEXT CHECK (setup_fee_status IS NULL OR setup_fee_status IN ('due', 'paid', 'waived')),
  starts_on TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinic_usage (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (length(period) = 7),
  package TEXT,
  plan_price_pence INTEGER,
  plan_reports_included INTEGER,
  plan_extra_report_pence INTEGER,
  reports_started INTEGER NOT NULL DEFAULT 0,
  reports_drafted INTEGER NOT NULL DEFAULT 0,
  reports_approved INTEGER NOT NULL DEFAULT 0,
  amendments_approved INTEGER NOT NULL DEFAULT 0,
  billable_reports INTEGER NOT NULL DEFAULT 0,
  billable_on_approval INTEGER NOT NULL DEFAULT 0,
  forms_read INTEGER NOT NULL DEFAULT 0,
  question_sets INTEGER NOT NULL DEFAULT 0,
  drafting_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  reading_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS usage_report (
  tenant_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  episode_fp TEXT NOT NULL DEFAULT '',
  root_report_id TEXT NOT NULL,
  started_at TEXT,
  first_drafted_at TEXT,
  first_approved_at TEXT,
  drafting_calls INTEGER NOT NULL DEFAULT 0,
  billable_period TEXT,
  billable_at TEXT,
  billable_via TEXT CHECK (billable_via IS NULL OR billable_via IN ('drafted', 'approved')),
  started_event TEXT,
  drafted_event TEXT,
  approved_event TEXT,
  billable_event TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, report_id, episode_fp)
);

CREATE INDEX IF NOT EXISTS usage_report_billable ON usage_report (tenant_id, billable_period);

CREATE TABLE IF NOT EXISTS usage_event (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_event_created ON usage_event (created_at);
