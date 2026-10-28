-- ClinForms 0137 (SQLite / Cloudflare D1): clinic system, billing - how the patient's part of an insured visit is
-- billed (Khuram's decision 28/10/2026). Two modes: 'per_case' (the case's excess is one amount, used up visit by
-- visit - the default) and 'per_visit' (the patient pays a fixed contribution on every visit, the payer the rest).
-- pms_payer_billing_terms holds the mode of a payer account (an insurer, MLC company, solicitor or employer of
-- pms_referrers), pms_case_billing_terms a case's own override (NULL mode = as its payer account). No row = the
-- default. The amount stays the case's excess_pence. Rows are changed, never deleted.
-- Kept in step with supabase/migrations/20261024000137_pms_contribution_terms.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_payer_billing_terms (
  tenant_id TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  contribution_mode TEXT NOT NULL CHECK (contribution_mode IN ('per_case', 'per_visit')),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, referrer_id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pms_case_billing_terms (
  tenant_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  contribution_mode TEXT CHECK (contribution_mode IS NULL OR contribution_mode IN ('per_case', 'per_visit')),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, case_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES pms_cases (tenant_id, id)
);
