-- ClinForms 0239 (SQLite / Cloudflare D1): clinic system, billing - a patient's card kept on file with the clinic's
-- connected account (account_ref - a card works only on the account it was saved on), and the patient's CONSENT to
-- it (cp04). Only the provider's references and what a receipt shows
-- (brand, last 4 digits, expiry) - never a card number. consent_wording = the exact words agreed to, consent_version,
-- consent_channel (portal / desk / phone), consent_recorded_by (the member who recorded it, NULL = the patient in the
-- portal), consent_at. allows_no_show = the patient also agreed to missed-appointment charges. Status pending (the
-- card form is open) / active / removed / failed. Removed by status, never deleted. Hangs off pms_card_settings and
-- the patient (ON DELETE CASCADE, offboarding only).
-- Kept in step with supabase/migrations/20261024000239_pms_card_mandates.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_card_mandates (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed', 'failed')),
  account_ref TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  method_ref TEXT,
  setup_ref TEXT,
  brand TEXT CHECK (brand IS NULL OR length(brand) BETWEEN 1 AND 20),
  last4 TEXT CHECK (last4 IS NULL OR length(last4) = 4),
  exp_month INTEGER CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  exp_year INTEGER CHECK (exp_year IS NULL OR exp_year BETWEEN 2000 AND 2100),
  consent_wording TEXT NOT NULL CHECK (length(consent_wording) BETWEEN 20 AND 2000),
  consent_version TEXT NOT NULL,
  consent_channel TEXT NOT NULL CHECK (consent_channel IN ('portal', 'desk', 'phone')),
  consent_recorded_by TEXT,
  consent_at TEXT NOT NULL,
  allows_no_show INTEGER NOT NULL DEFAULT 0 CHECK (allows_no_show IN (0, 1)),
  removed_at TEXT,
  removed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_card_mandates_setup ON pms_card_mandates (tenant_id, setup_ref);
CREATE INDEX IF NOT EXISTS pms_card_mandates_patient ON pms_card_mandates (tenant_id, patient_id, status);
