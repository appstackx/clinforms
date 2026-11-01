-- ClinForms 0143 (SQLite / Cloudflare D1): clinic system, comms - PREPAID text credits (1 credit = 1 text segment).
-- pms_sms_credit_accounts: one row per clinic - the cached balance (never negative, CHECK), the warning flags,
--   automatic top-up settings and the clinic's saved card (payment provider references and what is printed on a
--   receipt only - never a card number). last_entry_id names the ledger entry written by the latest change, so a
--   ledger INSERT in the same batch is made only when the balance change it belongs to was.
-- pms_sms_credit_entries: the APPEND-ONLY ledger (purchase, auto_topup, debit, adjustment, reversal). The sum of
--   credits equals the account balance. A payment is credited once (unique payment_ref), a debit reversed once
--   (unique reverses_id), a webhook event applied once (unique event_ref). No message text, no patient data.
-- Kept in step with supabase/migrations/20261024000143_pms_sms_credits.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_sms_credit_accounts (
  tenant_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_pack_credits INTEGER CHECK (last_pack_credits IS NULL OR last_pack_credits > 0),
  low_threshold INTEGER NOT NULL DEFAULT 100 CHECK (low_threshold >= 0),
  low_warned INTEGER NOT NULL DEFAULT 0 CHECK (low_warned IN (0, 1)),
  zero_warned INTEGER NOT NULL DEFAULT 0 CHECK (zero_warned IN (0, 1)),
  auto_topup INTEGER NOT NULL DEFAULT 0 CHECK (auto_topup IN (0, 1)),
  auto_topup_threshold INTEGER NOT NULL DEFAULT 100 CHECK (auto_topup_threshold BETWEEN 1 AND 100000),
  auto_topup_pack TEXT CHECK (auto_topup_pack IS NULL OR auto_topup_pack IN ('sms_500', 'sms_1000', 'sms_5000')),
  auto_topup_paused_at TEXT,
  auto_topup_failure TEXT,
  topup_claim TEXT,
  topup_claimed_at TEXT,
  customer_ref TEXT,
  card_method_ref TEXT,
  card_brand TEXT CHECK (card_brand IS NULL OR length(card_brand) BETWEEN 1 AND 20),
  card_last4 TEXT CHECK (card_last4 IS NULL OR length(card_last4) = 4),
  card_exp_month INTEGER CHECK (card_exp_month IS NULL OR card_exp_month BETWEEN 1 AND 12),
  card_exp_year INTEGER CHECK (card_exp_year IS NULL OR card_exp_year BETWEEN 2000 AND 2100),
  last_entry_id TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sms_credit_accounts_customer ON pms_sms_credit_accounts (customer_ref);

CREATE TABLE IF NOT EXISTS pms_sms_credit_entries (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'auto_topup', 'debit', 'adjustment', 'reversal')),
  credits INTEGER NOT NULL CHECK (credits <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  pack TEXT CHECK (pack IS NULL OR pack IN ('sms_500', 'sms_1000', 'sms_5000')),
  amount_pence INTEGER CHECK (amount_pence IS NULL OR amount_pence >= 0),
  message_id TEXT,
  reverses_id TEXT,
  payment_ref TEXT,
  event_ref TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_sms_credit_accounts (tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sms_credit_entries_payment ON pms_sms_credit_entries (payment_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sms_credit_entries_reverses ON pms_sms_credit_entries (tenant_id, reverses_id);
CREATE INDEX IF NOT EXISTS pms_sms_credit_entries_message ON pms_sms_credit_entries (tenant_id, message_id);
CREATE INDEX IF NOT EXISTS pms_sms_credit_entries_kind ON pms_sms_credit_entries (tenant_id, kind, id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sms_credit_entries_event ON pms_sms_credit_entries (event_ref);

-- The ledger is append-only: an entry never changes. Deleting stays possible ONLY for offboarding a whole clinic
-- after a verified export (contract section 10).
CREATE TRIGGER IF NOT EXISTS pms_sms_credit_entries_locked BEFORE UPDATE ON pms_sms_credit_entries
BEGIN
  SELECT RAISE(ABORT, 'pms_sms_credit_entries: entries are append-only');
END;
