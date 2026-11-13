-- ClinForms 0226 (SQLite / Cloudflare D1): clinic system, billing - card payments through the clinic's OWN connected
-- payment account (docs/clinic-system/card-payments.md, cp01-cp09). Behind the platform switch
-- CLINFORMS_CARD_PAYMENTS=on AND this per-clinic setting (enabled), both off by default.
-- pms_card_settings: one row per clinic. account_ref = the provider's connected account id (acct_...), unique across
--   clinics (the webhook finds the clinic by it). account_mode = the key mode it was made with (test / live).
--   account_status / card_capability / payouts_capability / requirements_due = the provider's answer at last_synced_at.
--   fee_bps + fee_fixed_pence = the platform fee on each payment (0 by default - owner's decision).
--   no_show_enabled + no_show_policy = whether missed-appointment fees may be charged to saved cards, and the policy
--   wording the patient agrees to. Hangs off the clinic's pms_billing_settings row (ON DELETE CASCADE, offboarding only).
-- Kept in step with supabase/migrations/20261024000226_pms_card_settings.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_card_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  account_ref TEXT CHECK (account_ref IS NULL OR length(account_ref) BETWEEN 8 AND 64),
  account_mode TEXT CHECK (account_mode IS NULL OR account_mode IN ('test', 'live')),
  account_status TEXT NOT NULL DEFAULT 'none' CHECK (account_status IN ('none', 'pending', 'active', 'restricted', 'closed')),
  card_capability TEXT,
  payouts_capability TEXT,
  requirements_due INTEGER NOT NULL DEFAULT 0 CHECK (requirements_due >= 0),
  last_synced_at TEXT,
  fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (fee_bps BETWEEN 0 AND 1000),
  fee_fixed_pence INTEGER NOT NULL DEFAULT 0 CHECK (fee_fixed_pence BETWEEN 0 AND 500),
  no_show_enabled INTEGER NOT NULL DEFAULT 0 CHECK (no_show_enabled IN (0, 1)),
  no_show_policy TEXT CHECK (no_show_policy IS NULL OR length(no_show_policy) <= 500),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_settings_account ON pms_card_settings (account_ref);
