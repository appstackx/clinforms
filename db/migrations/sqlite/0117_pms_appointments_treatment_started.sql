-- ClinForms 0117 (SQLite / Cloudflare D1): clinic system, diary module - pms_appointments.treatment_started_at.
-- Status "in treatment" (Khuram's decision B, 28/10/2026: booked, arrived, in treatment, attended) is stored as
-- status 'arrived' with this instant set: SQLite cannot widen the status CHECK of 0110 without rebuilding the
-- table, and D1 refuses that rebuild while other tables (waiting list, offers) point at appointments. The
-- repositories map it both ways, so readers of the raw column see "arrived" (not billable until attended).
-- Kept in step with supabase/migrations/20261024000117_pms_appointments_treatment_started.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_appointments ADD COLUMN treatment_started_at TEXT;
