-- ClinForms 0123 (Postgres / Supabase): clinic system, records module - a clinical note can name the diary
-- appointment it was written for (K2-NOTE-002). Plain id, no foreign key yet (the diary's table belongs to the
-- diary module). Kept in step with db/migrations/sqlite/0123_pms_clinical_notes_appointment.sql. Idempotent.
alter table public.pms_clinical_notes add column if not exists appointment_id text;
