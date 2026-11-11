-- ClinForms 0234 (SQLite / Cloudflare D1): clinic system, billing - gift cards (PK04, docs/clinic-system/courses-giftcards-products.md).
-- pms_gift_cards: a card sold on an invoice line (made with the draft as pending, active once the invoice is issued).
-- The code is a bearer value: only its SHA-256 (of clinic and code) and last 4 characters are kept. Balance in pence,
-- never below zero. recipient_name_enc is encrypted. Hangs off the clinic's pms_billing_settings row (ON DELETE CASCADE,
-- offboarding only), its buyer, invoice and line likewise. Never deleted otherwise. New table only (additive).
-- Kept in step with supabase/migrations/20261024000234_pms_gift_cards.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_gift_cards (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  code_sha256 TEXT NOT NULL,
  code_last4 TEXT NOT NULL CHECK (length(code_last4) = 4),
  initial_pence INTEGER NOT NULL CHECK (initial_pence > 0),
  balance_pence INTEGER NOT NULL CHECK (balance_pence >= 0 AND balance_pence <= initial_pence),
  sold_on TEXT CHECK (sold_on IS NULL OR sold_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_on TEXT CHECK (expires_on IS NULL OR expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sale_invoice_id TEXT,
  sale_line_id TEXT,
  buyer_patient_id TEXT,
  recipient_name_enc TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'used', 'expired', 'cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, buyer_patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sale_invoice_id) REFERENCES pms_invoices (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sale_line_id) REFERENCES pms_invoice_lines (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pms_gift_cards_code ON pms_gift_cards (tenant_id, code_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS pms_gift_cards_sale_line ON pms_gift_cards (tenant_id, sale_line_id);
CREATE INDEX IF NOT EXISTS pms_gift_cards_created ON pms_gift_cards (tenant_id, created_at);
