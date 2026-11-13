-- ClinForms 0228 (SQLite / Cloudflare D1): clinic system, billing - every payment, saved-card set-up and refund made
-- through the clinic's connected account (cp03-cp06, l04, pk03). Written BEFORE the provider is asked, so a payment
-- that succeeds while the app is not looking (a crash, a closed tab) is still found and recorded - once.
-- kind payment / setup / refund, purpose reader / saved_card / portal / membership / save_card / refund.
-- intent_ref = the provider's payment intent (pi_...), set-up intent (seti_...) or refund (re_...), checkout_ref = a
-- hosted checkout (cs_...), parent_ref = the payment a refund belongs to. payment_id = the pms_payments row recorded
-- for it (no foreign key - a payment is never deleted, and pms_payments stays the one record of money: a payment is
-- recorded once because its provider reference is unique per clinic). membership_id + period: one monthly charge per
-- membership and month (unique). Hangs off pms_card_settings, its invoice and patient (ON DELETE CASCADE, offboarding).
-- Kept in step with supabase/migrations/20261024000228_pms_card_intents.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_card_intents (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'setup', 'refund')),
  purpose TEXT NOT NULL CHECK (purpose IN ('reader', 'saved_card', 'portal', 'membership', 'save_card', 'refund')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'succeeded', 'failed', 'canceled')),
  intent_ref TEXT,
  checkout_ref TEXT,
  parent_ref TEXT,
  invoice_id TEXT,
  patient_id TEXT,
  mandate_id TEXT,
  reader_id TEXT,
  membership_id TEXT,
  period TEXT CHECK (period IS NULL OR period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount_pence INTEGER NOT NULL CHECK (amount_pence >= 0),
  fee_pence INTEGER NOT NULL DEFAULT 0 CHECK (fee_pence >= 0),
  payment_id TEXT,
  failure_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_intents_intent ON pms_card_intents (tenant_id, intent_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_intents_checkout ON pms_card_intents (tenant_id, checkout_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_intents_period ON pms_card_intents (tenant_id, membership_id, period) WHERE kind = 'payment' AND membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pms_card_intents_invoice ON pms_card_intents (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS pms_card_intents_parent ON pms_card_intents (tenant_id, parent_ref);
CREATE INDEX IF NOT EXISTS pms_card_intents_status ON pms_card_intents (tenant_id, status, updated_at);
