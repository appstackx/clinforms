-- ClinForms 0010 (SQLite / Cloudflare D1): self-serve sign-up with online acceptance of the terms and the data
-- processing agreement (12/11/2026, tracker l01; behind CLINFORMS_SELF_SIGNUP, off by default). Kept in step with
-- supabase/migrations/20261112000010_self_signup.sql. Idempotent. No patient data. Written by src/server/signup only.
--
-- signup_requests - one row per "Start free trial" form that passed the checks, waiting for the email link.
--   token_hash      SHA-256 (base64url) of the one-time link's token; the token itself is never stored
--   brand           clinforms | clinic - the host the form was filled in on (the clinic is created for it)
--   clinic_name / owner_name / email   what the person typed (email lower-cased)
--   password_hash   the chosen password, hashed as the sign-in hashes it; NULL once the link has been used.
--                   At the link the person types the password again: it is checked against this hash, so only the
--                   person who chose it can finish (a stranger who signed up with someone else's address cannot)
--   terms_version / dpa_version   the versions on screen when the box was ticked
--   ip_hash / ua_hash             keyed hashes (HMAC under BETTER_AUTH_SECRET) - never the address or user agent
--   expires_at      the link's end (24 hours); the retention cron deletes rows 7 days after it
--   claimed_at      set once when the link is used (one statement: two clicks cannot both create a clinic)
--   tenant_id       the clinic created from it; completed_at when the owner's account joined it
--
-- signup_acceptances - the record of acceptance, one per clinic created by self sign-up. Kept for the life of the
--   account (like audit_log, never edited): who (user_id, tenant_id), when the box was ticked (accepted_at) and when
--   the email was confirmed (confirmed_at), the keyed IP and user-agent hashes, the terms and DPA versions.

CREATE TABLE IF NOT EXISTS signup_requests (
  id TEXT NOT NULL PRIMARY KEY,
  token_hash TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (brand IN ('clinforms', 'clinic')),
  clinic_name TEXT NOT NULL CHECK (length(clinic_name) BETWEEN 2 AND 200),
  owner_name TEXT NOT NULL CHECK (length(owner_name) BETWEEN 1 AND 200),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash TEXT,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 80),
  dpa_version TEXT NOT NULL CHECK (length(dpa_version) BETWEEN 1 AND 80),
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  tenant_id TEXT,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_token ON signup_requests (token_hash);
CREATE INDEX IF NOT EXISTS signup_requests_email ON signup_requests (email);
CREATE INDEX IF NOT EXISTS signup_requests_expires ON signup_requests (expires_at);

CREATE TABLE IF NOT EXISTS signup_acceptances (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  signup_id TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (brand IN ('clinforms', 'clinic')),
  terms_version TEXT NOT NULL,
  dpa_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS signup_acceptances_signup ON signup_acceptances (signup_id);
CREATE INDEX IF NOT EXISTS signup_acceptances_tenant ON signup_acceptances (tenant_id);
