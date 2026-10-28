-- ClinForms 0123 (SQLite / Cloudflare D1): clinic system, records module - a clinical note can name the diary
-- appointment it was written for (K2-NOTE-002). Plain id, no foreign key yet: the diary's table belongs to the diary
-- module and the link is checked by the app until both modules are on one branch.
-- A lone ALTER TABLE (SQLite has no ADD COLUMN IF NOT EXISTS - docs/database.md section 3).
-- Kept in step with supabase/migrations/20261024000123_pms_clinical_notes_appointment.sql.
ALTER TABLE pms_clinical_notes ADD COLUMN appointment_id TEXT;
