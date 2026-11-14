-- ClinForms 0011 (SQLite / Cloudflare D1): the self-serve 14-day free trial (13/11/2026, behind CLINFORMS_SELF_SIGNUP,
-- off by default). Kept in step with supabase/migrations/20261113000011_self_trial.sql. Idempotent. No patient data, no
-- names, no email addresses: clinic ids, keyed hashes, counts and dates only. Written by src/server/trial only.
--
-- Coexists with the two other 0010s: 0010_self_signup (main) and the parked branch's 0010_lifecycle_email (its tables
-- lifecycle_email / lifecycle_email_pref already exist, empty, on production). This migration uses NEW table names
-- (self_trial, trial_email) so neither of them is touched or reused.
--
-- self_trial - one row per clinic created by self sign-up with a free trial (and one per its SAMPLE clinic,
--   sample_of = the real clinic's id). What the trial was given and how it went:
--   email_key / network_key  keyed hashes (HMAC under BETTER_AUTH_SECRET) of the owner's address (normalised: case,
--                   +tags, gmail dots) and of the network the link was confirmed from (IPv4 /24, IPv6 /64) - abuse
--                   brakes: a repeat trial from the same address or a busy network gets no free allowance
--   domain_key      keyed hash of the address's own domain (NULL for webmail) - the per-domain brake
--   reports_included / texts_granted   the free allowance actually given (0 for a repeat - repeat_reason says why)
--   sample_tenant_id / sample_state / sample_claimed_at   the separate SAMPLE clinic (fictional data), created once
--   tips_off_at     the owner stopped the tips emails (welcome / tips)
--   converted_at    the first paid activation ended the trial ("paid")
--   reports_reserved   free reports RESERVED before a live drafting call (one conditional UPDATE: never more than
--                   reports_included, even with parallel drafts), released when a call failed without cost
--   sample_step     how far the sample clinic's creation got (it is made in short resumable steps)
--
-- trial_report_hold - the reports holding a free-report reservation (one per report and fingerprint): a report that
--   holds one may be drafted again without a second reservation.
--
-- trial_email - one row per trial email per clinic (recipient_ref '') and one per recipient (the owner's user id),
--   each CLAIMED before the send (the primary key): a retried cron or a second request never sends twice, and a send
--   that failed for one owner is retried for that owner only. status claimed | sent | failed | skipped, and attempts counts the failed sends
--   retried (at most 3).

CREATE TABLE IF NOT EXISTS self_trial (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  brand TEXT NOT NULL CHECK (brand IN ('clinforms', 'clinic')),
  sample_of TEXT,
  email_key TEXT NOT NULL,
  network_key TEXT NOT NULL,
  domain_key TEXT,
  reports_included INTEGER NOT NULL CHECK (reports_included BETWEEN 0 AND 1000),
  texts_granted INTEGER NOT NULL CHECK (texts_granted BETWEEN 0 AND 1000),
  reports_reserved INTEGER NOT NULL DEFAULT 0 CHECK (reports_reserved >= 0),
  repeat_reason TEXT CHECK (repeat_reason IS NULL OR repeat_reason IN ('email', 'network', 'domain')),
  sample_tenant_id TEXT,
  sample_state TEXT CHECK (sample_state IS NULL OR sample_state IN ('creating', 'ready', 'declined')),
  sample_claimed_at TEXT,
  sample_step INTEGER NOT NULL DEFAULT 0 CHECK (sample_step BETWEEN 0 AND 20),
  tips_off_at TEXT,
  converted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS self_trial_email ON self_trial (email_key);
CREATE INDEX IF NOT EXISTS self_trial_network ON self_trial (network_key, created_at);
CREATE INDEX IF NOT EXISTS self_trial_domain ON self_trial (domain_key, created_at);

CREATE TABLE IF NOT EXISTS trial_report_hold (
  tenant_id TEXT NOT NULL,
  report_key TEXT NOT NULL,
  episode_fp TEXT NOT NULL DEFAULT '',
  held_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, report_key, episode_fp)
);

CREATE TABLE IF NOT EXISTS trial_email (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'tips', 'four_days', 'last_day', 'ended', 'paid')),
  recipient_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 10),
  recipients INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (tenant_id, kind, recipient_ref)
);
CREATE INDEX IF NOT EXISTS trial_email_kind ON trial_email (kind, claimed_at);
