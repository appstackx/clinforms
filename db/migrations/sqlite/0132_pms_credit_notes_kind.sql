-- ClinForms 0132 (SQLite / Cloudflare D1): clinic system, billing - what a credit note is for.
-- credit (a correction), write_off (an amount the clinic will not collect, e.g. an insurer's short payment above
-- its agreed rate), void (the whole invoice cancelled after it was issued) or transfer (an insurer's unpaid part
-- moved to the patient's own invoice). Every kind is a numbered credit note, so the invoice trail stays gap-free.
-- Kept in step with supabase/migrations/20261024000132_pms_credit_notes_kind.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_credit_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'credit' CHECK (kind IN ('credit', 'write_off', 'void', 'transfer'));
