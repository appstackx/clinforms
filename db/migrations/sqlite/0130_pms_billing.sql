-- ClinForms 0130 (SQLite / Cloudflare D1): clinic system, billing part 1 - billing settings, VAT per
-- appointment type, invoices, invoice lines, credit notes and their lines.
-- Kept in step with supabase/migrations/20261024000130_pms_billing.sql (db/parity.test.ts).
-- Conventions (docs/clinic-system/contract.md section 4): PRIMARY KEY (tenant_id, id), foreign keys that include
-- tenant_id, money in whole pence, dates TEXT YYYY-MM-DD, free text AES-GCM encrypted in the _enc columns.
-- Invariants the database itself enforces (a failed CHECK aborts the whole write batch, D1 included):
--   an issued invoice has a number, numbers are unique per clinic, nothing is credited beyond what was charged,
--   one active invoice line per diary appointment (billing_lock).
-- Financial records are never deleted by the app. The one exception is the lines of a DRAFT invoice, which are
-- replaced when the draft is edited (a draft has no number and no legal standing).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_billing_settings (
  tenant_id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  invoice_prefix TEXT NOT NULL DEFAULT 'INV' CHECK (length(invoice_prefix) BETWEEN 1 AND 4),
  credit_note_prefix TEXT NOT NULL DEFAULT 'CN' CHECK (length(credit_note_prefix) BETWEEN 1 AND 4),
  first_invoice_number INTEGER NOT NULL DEFAULT 1 CHECK (first_invoice_number BETWEEN 1 AND 999999),
  first_credit_note_number INTEGER NOT NULL DEFAULT 1 CHECK (first_credit_note_number BETWEEN 1 AND 999999),
  self_pay_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (self_pay_terms_days BETWEEN 0 AND 90),
  account_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (account_terms_days BETWEEN 0 AND 180),
  vat_registered INTEGER NOT NULL DEFAULT 0 CHECK (vat_registered IN (0, 1)),
  vat_number TEXT,
  prices_include_vat INTEGER NOT NULL DEFAULT 1 CHECK (prices_include_vat IN (0, 1)),
  dna_charge_percent INTEGER NOT NULL DEFAULT 100 CHECK (dna_charge_percent BETWEEN 0 AND 100),
  late_cancel_charge_percent INTEGER NOT NULL DEFAULT 50 CHECK (late_cancel_charge_percent BETWEEN 0 AND 100),
  payment_instructions TEXT,
  payment_links_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payment_links_enabled IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS pms_service_vat (
  tenant_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  vat_code TEXT NOT NULL CHECK (vat_code IN ('exempt', 'standard', 'reduced', 'zero')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, service_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pms_invoices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  number_prefix TEXT,
  number_seq INTEGER CHECK (number_seq IS NULL OR number_seq BETWEEN 1 AND 999999),
  patient_id TEXT NOT NULL,
  case_id TEXT,
  bill_to TEXT NOT NULL CHECK (bill_to IN ('patient', 'payer')),
  payer_type TEXT NOT NULL CHECK (payer_type IN ('self_pay', 'insurer', 'mlc', 'solicitor', 'employer', 'other')),
  payer_referrer_id TEXT,
  authorisation_id TEXT,
  related_invoice_id TEXT,
  issued_on TEXT CHECK (issued_on IS NULL OR issued_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  first_service_on TEXT,
  last_service_on TEXT,
  net_pence INTEGER NOT NULL,
  vat_pence INTEGER NOT NULL CHECK (vat_pence >= 0),
  total_pence INTEGER NOT NULL CHECK (total_pence >= 0),
  paid_pence INTEGER NOT NULL DEFAULT 0 CHECK (paid_pence >= 0),
  credited_pence INTEGER NOT NULL DEFAULT 0 CHECK (credited_pence >= 0 AND credited_pence <= total_pence),
  prices_include_vat INTEGER NOT NULL CHECK (prices_include_vat IN (0, 1)),
  auth_sessions INTEGER NOT NULL DEFAULT 0 CHECK (auth_sessions >= 0),
  auth_value_pence INTEGER NOT NULL DEFAULT 0 CHECK (auth_value_pence >= 0),
  bill_to_enc TEXT,
  diagnosis_enc TEXT,
  notes_enc TEXT,
  exported_at TEXT,
  edit_token TEXT,
  import_ref TEXT,
  created_by TEXT,
  issued_by TEXT,
  issued_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (status <> 'issued' OR (number_seq IS NOT NULL AND number_prefix IS NOT NULL AND issued_on IS NOT NULL)),
  CHECK (status = 'issued' OR number_seq IS NULL),
  CHECK (bill_to = 'patient' OR payer_referrer_id IS NOT NULL),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, payer_referrer_id) REFERENCES pms_referrers (tenant_id, id),
  FOREIGN KEY (tenant_id, authorisation_id) REFERENCES pms_authorisations (tenant_id, id),
  FOREIGN KEY (tenant_id, related_invoice_id) REFERENCES pms_invoices (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_invoices_number ON pms_invoices (tenant_id, number_seq);
CREATE UNIQUE INDEX IF NOT EXISTS pms_invoices_import_ref ON pms_invoices (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_invoices_patient ON pms_invoices (tenant_id, patient_id, created_at);
CREATE INDEX IF NOT EXISTS pms_invoices_case ON pms_invoices (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS pms_invoices_status_issued ON pms_invoices (tenant_id, status, issued_on);
CREATE INDEX IF NOT EXISTS pms_invoices_payer ON pms_invoices (tenant_id, payer_referrer_id, status);

CREATE TABLE IF NOT EXISTS pms_invoice_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'item', 'excess', 'excess_deduction')),
  service_id TEXT,
  appointment_id TEXT,
  visit_status TEXT CHECK (visit_status IS NULL OR visit_status IN ('attended', 'did_not_attend', 'late_cancellation')),
  practitioner_id TEXT,
  service_on TEXT CHECK (service_on IS NULL OR service_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description_enc TEXT,
  billing_code TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_pence INTEGER NOT NULL,
  discount_pence INTEGER NOT NULL DEFAULT 0 CHECK (discount_pence >= 0),
  vat_code TEXT NOT NULL CHECK (vat_code IN ('exempt', 'standard', 'reduced', 'zero', 'none')),
  vat_rate_bp INTEGER NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  net_pence INTEGER NOT NULL,
  vat_pence INTEGER NOT NULL,
  total_pence INTEGER NOT NULL,
  credited_pence INTEGER NOT NULL DEFAULT 0 CHECK (credited_pence >= 0 AND credited_pence <= max(total_pence, 0)),
  billing_lock INTEGER NOT NULL DEFAULT 1 CHECK (billing_lock IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (kind = 'excess_deduction' OR (unit_price_pence >= 0 AND total_pence >= 0)),
  CHECK (kind <> 'excess_deduction' OR total_pence <= 0),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_invoice_lines_line_no ON pms_invoice_lines (tenant_id, invoice_id, line_no);
CREATE UNIQUE INDEX IF NOT EXISTS pms_invoice_lines_appointment ON pms_invoice_lines (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL AND billing_lock = 1;
CREATE INDEX IF NOT EXISTS pms_invoice_lines_service_on ON pms_invoice_lines (tenant_id, service_on);

CREATE TABLE IF NOT EXISTS pms_credit_notes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  number_prefix TEXT NOT NULL,
  number_seq INTEGER NOT NULL CHECK (number_seq BETWEEN 1 AND 999999),
  issued_on TEXT NOT NULL CHECK (issued_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  net_pence INTEGER NOT NULL,
  vat_pence INTEGER NOT NULL CHECK (vat_pence >= 0),
  total_pence INTEGER NOT NULL CHECK (total_pence >= 0),
  reason_enc TEXT,
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_credit_notes_number ON pms_credit_notes (tenant_id, number_seq);
CREATE UNIQUE INDEX IF NOT EXISTS pms_credit_notes_import_ref ON pms_credit_notes (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_credit_notes_invoice ON pms_credit_notes (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS pms_credit_notes_issued ON pms_credit_notes (tenant_id, issued_on);

CREATE TABLE IF NOT EXISTS pms_credit_note_lines (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  credit_note_id TEXT NOT NULL,
  invoice_line_id TEXT NOT NULL,
  net_pence INTEGER NOT NULL,
  vat_pence INTEGER NOT NULL CHECK (vat_pence >= 0),
  total_pence INTEGER NOT NULL CHECK (total_pence > 0),
  line_remaining_after INTEGER NOT NULL CHECK (line_remaining_after >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_note_id) REFERENCES pms_credit_notes (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_line_id) REFERENCES pms_invoice_lines (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_credit_note_lines_line ON pms_credit_note_lines (tenant_id, credit_note_id, invoice_line_id);
CREATE INDEX IF NOT EXISTS pms_credit_note_lines_invoice_line ON pms_credit_note_lines (tenant_id, invoice_line_id);
