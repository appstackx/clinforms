-- ClinForms 0102 (SQLite / Cloudflare D1): clinic-system foundation, part 3 - the shared patient record:
-- patients, cases (episodes of care, each with its payer) and treatment authorisations.
-- Kept in step with supabase/migrations/20261024000102_pms_patients.sql (db/parity.test.ts).
-- Demographics are plain, indexed columns (the diary shows names all day) - record this in the DPIA.
-- Free text (medical alerts, notes, referral reasons) is AES-GCM encrypted per clinic in the _enc columns.
-- Clinical records are never deleted by the app or by any scheduled job (contract section 4).
-- An authorisation's (patient, case) pair must be one case of that patient: its foreign key goes to the
-- unique (tenant_id, patient_id, id) of pms_cases.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_patients (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_number INTEGER NOT NULL CHECK (patient_number > 0),
  title TEXT,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 80),
  preferred_name TEXT,
  date_of_birth TEXT CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sex TEXT CHECK (sex IS NULL OR sex IN ('female', 'male', 'other', 'unknown')),
  email TEXT,
  phone_mobile TEXT,
  phone_home TEXT,
  phone_work TEXT,
  address_json TEXT,
  postcode TEXT,
  occupation TEXT,
  employer TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relationship TEXT,
  gp_name TEXT,
  gp_practice TEXT,
  gp_phone TEXT,
  gp_address_json TEXT,
  gp_postcode TEXT,
  consent_treatment INTEGER NOT NULL DEFAULT 0 CHECK (consent_treatment IN (0, 1)),
  consent_treatment_at TEXT,
  consent_share_gp INTEGER NOT NULL DEFAULT 0 CHECK (consent_share_gp IN (0, 1)),
  reminder_sms INTEGER NOT NULL DEFAULT 1 CHECK (reminder_sms IN (0, 1)),
  reminder_email INTEGER NOT NULL DEFAULT 1 CHECK (reminder_email IN (0, 1)),
  marketing_email INTEGER NOT NULL DEFAULT 0 CHECK (marketing_email IN (0, 1)),
  marketing_sms INTEGER NOT NULL DEFAULT 0 CHECK (marketing_sms IN (0, 1)),
  marketing_consent_at TEXT,
  marketing_consent_source TEXT CHECK (marketing_consent_source IS NULL OR marketing_consent_source IN ('verbal', 'written', 'online', 'import')),
  alerts_enc TEXT,
  notes_enc TEXT,
  search_name TEXT NOT NULL,
  search_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deceased')),
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1)),
  last_seen_on TEXT CHECK (last_seen_on IS NULL OR last_seen_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  merged_into_id TEXT,
  archived_at TEXT,
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES pms_patients (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_patients_number ON pms_patients (tenant_id, patient_number);
CREATE UNIQUE INDEX IF NOT EXISTS pms_patients_import_ref ON pms_patients (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_patients_search_name ON pms_patients (tenant_id, search_name);
CREATE INDEX IF NOT EXISTS pms_patients_dob ON pms_patients (tenant_id, date_of_birth);
CREATE INDEX IF NOT EXISTS pms_patients_last_name ON pms_patients (tenant_id, last_name, first_name);

CREATE TABLE IF NOT EXISTS pms_cases (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  patient_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'discharged', 'closed')),
  opened_on TEXT NOT NULL CHECK (opened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  closed_on TEXT CHECK (closed_on IS NULL OR closed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  practitioner_id TEXT,
  site_id TEXT,
  payer_type TEXT NOT NULL DEFAULT 'self_pay' CHECK (payer_type IN ('self_pay', 'insurer', 'mlc', 'solicitor', 'employer', 'other')),
  payer_referrer_id TEXT,
  membership_number TEXT,
  claim_reference TEXT,
  excess_pence INTEGER CHECK (excess_pence IS NULL OR excess_pence >= 0),
  price_list_id TEXT,
  referrer_id TEXT,
  referral_received_on TEXT,
  injury_on TEXT,
  referral_reason_enc TEXT,
  notes_enc TEXT,
  import_ref TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES pms_patients (tenant_id, id),
  FOREIGN KEY (tenant_id, practitioner_id) REFERENCES pms_practitioners (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_referrer_id) REFERENCES pms_referrers (tenant_id, id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES pms_price_lists (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_cases_patient ON pms_cases (tenant_id, patient_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_cases_import_ref ON pms_cases (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_cases_status ON pms_cases (tenant_id, status, opened_on);
CREATE INDEX IF NOT EXISTS pms_cases_payer ON pms_cases (tenant_id, payer_referrer_id);

CREATE TABLE IF NOT EXISTS pms_authorisations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  case_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  referrer_id TEXT,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  sessions_authorised INTEGER CHECK (sessions_authorised IS NULL OR sessions_authorised >= 0),
  value_authorised_pence INTEGER CHECK (value_authorised_pence IS NULL OR value_authorised_pence >= 0),
  sessions_used INTEGER NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  value_used_pence INTEGER NOT NULL DEFAULT 0 CHECK (value_used_pence >= 0),
  valid_from TEXT,
  expires_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes_enc TEXT,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id, case_id) REFERENCES pms_cases (tenant_id, patient_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_authorisations_case_code ON pms_authorisations (tenant_id, case_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS pms_authorisations_import_ref ON pms_authorisations (tenant_id, import_ref);
CREATE INDEX IF NOT EXISTS pms_authorisations_patient ON pms_authorisations (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS pms_authorisations_expires ON pms_authorisations (tenant_id, expires_on);
