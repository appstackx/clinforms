-- ClinForms 0104 (SQLite / Cloudflare D1): clinic-system foundation - pms_practitioners.registration_body, the
-- register the registration number is on (today "HCPC"). Set on Member access, "Signing details" (owners and
-- administrators, settings.members). NULL on rows written before this migration (read as HCPC).
-- Kept in step with supabase/migrations/20261024000104_pms_practitioner_registration_body.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_practitioners ADD COLUMN registration_body TEXT;
