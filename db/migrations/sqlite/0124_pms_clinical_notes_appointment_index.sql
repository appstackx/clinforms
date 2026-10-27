-- ClinForms 0124 (SQLite / Cloudflare D1): clinic system, records module - the notes of one appointment.
-- Kept in step with supabase/migrations/20261024000124_pms_clinical_notes_appointment_index.sql. Idempotent.
CREATE INDEX IF NOT EXISTS pms_clinical_notes_appointment ON pms_clinical_notes (tenant_id, appointment_id);
