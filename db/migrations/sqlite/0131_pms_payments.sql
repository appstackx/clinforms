-- ClinForms 0131 (SQLite / Cloudflare D1): clinic system, billing part 2 - payments and refunds, how they are
-- allocated to invoices, card payment links (test mode only) and the insurer e-billing export log.
-- Kept in step with supabase/migrations/20261024000131_pms_payments.sql (db/parity.test.ts).
-- Invariants the database itself enforces (a failed CHECK or NOT NULL aborts the whole write batch):
--   a payment is never allocated beyond its amount, an allocation never takes an invoice below zero (a payment)
--   or above zero (a refund), and a payment or refund is allocated to an invoice only once.
-- Payments are never deleted: a mistaken payment is reversed (status) and its allocations marked reversed.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_payments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
  payer_kind TEXT NOT NULL CHECK (payer_kind IN ('patient', 'account')),
  patient_id TEXT,
  payer_referrer_id TEXT,
  received_on TEXT NOT NULL CHECK (received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  method TEXT NOT NULL CHECK (method IN ('card', 'cash', 'bank_transfer', 'cheque', 'online', 'other')),
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  allocated_pence INTEGER NOT NULL DEFAULT 0 CHECK (allocated_pence >= 0 AND allocated_pence <= amount_pence),
  reference TEXT,
  notes_enc TEXT,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  reversed_at TEXT,
  reversed_by TEXT,
  reverse_reason_enc TEXT,
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((payer_kind = 'patient' AND patient_id IS NOT NULL AND payer_referrer_id IS NULL) OR (payer_kind = 'account' AND payer_referrer_id IS NOT NULL AND patient_id IS NULL)),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_payments_provider_ref ON pms_payments (tenant_id, provider, provider_ref);
CREATE UNIQUE INDEX IF NOT EXISTS pms_payments_import_ref ON pms_payments (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_payments_received ON pms_payments (tenant_id, received_on);
CREATE INDEX IF NOT EXISTS pms_payments_patient ON pms_payments (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS pms_payments_payer ON pms_payments (tenant_id, payer_referrer_id);

CREATE TABLE IF NOT EXISTS pms_payment_allocations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence <> 0),
  invoice_balance_after INTEGER NOT NULL,
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((amount_pence > 0 AND invoice_balance_after >= 0) OR (amount_pence < 0 AND invoice_balance_after <= 0)),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES pms_payments (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_payment_allocations_pair ON pms_payment_allocations (tenant_id, payment_id, invoice_id) WHERE reversed = 0;
CREATE INDEX IF NOT EXISTS pms_payment_allocations_invoice ON pms_payment_allocations (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS pms_payment_links (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'test'),
  provider_link_id TEXT NOT NULL,
  url TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'deactivated')),
  last_checked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_payment_links_provider ON pms_payment_links (tenant_id, provider, provider_link_id);
CREATE INDEX IF NOT EXISTS pms_payment_links_invoice ON pms_payment_links (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS pms_invoice_exports (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('csv', 'healthcode')),
  batch_ref TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_invoice_exports_invoice ON pms_invoice_exports (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS pms_invoice_exports_batch ON pms_invoice_exports (tenant_id, batch_ref);
