-- ClinForms 0124 (Postgres / Supabase): clinic system, records module - the notes of one appointment.
-- Kept in step with db/migrations/sqlite/0124_pms_clinical_notes_appointment_index.sql. Idempotent.
create index if not exists pms_clinical_notes_appointment on public.pms_clinical_notes (tenant_id, appointment_id);
