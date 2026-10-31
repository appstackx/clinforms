-- ClinForms 0211 (SQLite / Cloudflare D1): clinic system, records module - M10 performance (handover §20.4): indexes only,
-- purely additive (no table, column or row changes). The unsigned-notes list and counts (status = draft, oldest first) without reading every note of the clinic.
-- Kept in step with supabase/migrations/20261024000211_pms_clinical_notes_status_seen.sql (db/parity.test.ts). Idempotent.
-- Keep semicolons out of comments.

CREATE INDEX IF NOT EXISTS pms_clinical_notes_status_seen ON pms_clinical_notes (tenant_id, status, seen_on);
