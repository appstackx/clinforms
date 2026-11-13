-- ClinForms 0241 (SQLite / Cloudflare D1): clinic system, billing - a patient's membership (pk03), charged every
-- month to a saved card by the clinic system's own daily run (an invoice, then the charge - one per month, the
-- unique period in pms_card_intents). charge_day 1-28, next_charge_on, attempts (failed tries this period), status
-- active / payment_failed / cancelled. The patient's consent to the monthly charge: consent_wording (exact words),
-- consent_channel, consent_recorded_by, consent_at. Hangs off pms_card_settings, the patient, the plan and the
-- saved card (ON DELETE CASCADE, offboarding only).
-- Kept in step with supabase/migrations/20261024000241_pms_memberships.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_memberships (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  site_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'payment_failed', 'cancelled')),
  charge_day INTEGER NOT NULL CHECK (charge_day BETWEEN 1 AND 28),
  started_on TEXT NOT NULL CHECK (started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  next_charge_on TEXT CHECK (next_charge_on IS NULL OR next_charge_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consent_wording TEXT NOT NULL CHECK (length(consent_wording) BETWEEN 20 AND 2000),
  consent_channel TEXT NOT NULL CHECK (consent_channel IN ('portal', 'desk', 'phone')),
  consent_recorded_by TEXT,
  consent_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_card_settings (tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES pms_membership_plans (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, mandate_id) REFERENCES pms_card_mandates (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pms_memberships_due ON pms_memberships (tenant_id, status, next_charge_on);
CREATE INDEX IF NOT EXISTS pms_memberships_patient ON pms_memberships (tenant_id, patient_id);
