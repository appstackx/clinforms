-- ClinForms 0213 (SQLite / Cloudflare D1): clinic system, foundation module - M10 performance (handover §20.4): indexes only,
-- purely additive (no table, column or row changes). A practitioner's open cases (Today for clinicians, the caseload report, the patient list's practitioner filter) without reading every case of the clinic.
-- Kept in step with supabase/migrations/20261024000213_pms_cases_practitioner.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE INDEX IF NOT EXISTS pms_cases_practitioner ON pms_cases (tenant_id, practitioner_id, status);
