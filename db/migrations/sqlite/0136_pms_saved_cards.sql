-- ClinForms 0136 (SQLite / Cloudflare D1): clinic system, billing - a patient's saved card (TEST MODE ONLY) and
-- the site indexes for 0133/0135.
-- pms_saved_cards keeps only the payment provider's references and what is printed on a receipt (brand, last four
-- digits, expiry) - never a card number. A card is removed by status, never deleted. The provider runs in test
-- mode only (src/server/pms/billing/payments), so no real card can be saved or charged.
-- Kept in step with supabase/migrations/20261024000136_pms_saved_cards.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_saved_cards (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'test'),
  customer_ref TEXT NOT NULL,
  method_ref TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (length(brand) BETWEEN 1 AND 20),
  last4 TEXT NOT NULL CHECK (length(last4) = 4),
  exp_month INTEGER NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year INTEGER NOT NULL CHECK (exp_year BETWEEN 2000 AND 2100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_saved_cards_method ON pms_saved_cards (tenant_id, provider, method_ref);
CREATE INDEX IF NOT EXISTS pms_saved_cards_patient ON pms_saved_cards (tenant_id, patient_id, status);
CREATE INDEX IF NOT EXISTS pms_invoices_site ON pms_invoices (tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS pms_payments_site_received ON pms_payments (tenant_id, site_id, received_on);
