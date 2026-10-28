-- ClinForms 0121 (SQLite / Cloudflare D1): clinic system, records module - the database backs up the app's
-- sign-and-lock rule. A signed clinical note's content, author, signature and links cannot change, and an
-- amendment cannot change at all. The one exception is anonymisation after the record-keeping period, which
-- sets anonymised_at in the same statement (src/server/repos/pms/records/anonymise.ts).
-- Deleting stays possible ONLY for offboarding a whole clinic after a verified export (contract section 10).
-- Kept in step with supabase/migrations/20261024000121_pms_records_locks.sql.
-- Idempotent. No transaction statements. Keep semicolons out of comments.

CREATE TRIGGER IF NOT EXISTS pms_clinical_notes_signed_locked BEFORE UPDATE ON pms_clinical_notes
WHEN OLD.status = 'signed' AND NEW.anonymised_at IS NULL AND (
  NEW.status IS NOT OLD.status
  OR NEW.sections_enc IS NOT OLD.sections_enc
  OR NEW.body_chart_enc IS NOT OLD.body_chart_enc
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.template_json IS NOT OLD.template_json
  OR NEW.seen_on IS NOT OLD.seen_on
  OR NEW.patient_id IS NOT OLD.patient_id
  OR NEW.case_id IS NOT OLD.case_id
  OR NEW.author_user_id IS NOT OLD.author_user_id
  OR NEW.signed_at IS NOT OLD.signed_at
  OR NEW.signed_by_user_id IS NOT OLD.signed_by_user_id
  OR NEW.signed_by_name IS NOT OLD.signed_by_name
  OR NEW.signed_registration IS NOT OLD.signed_registration
)
BEGIN
  SELECT RAISE(ABORT, 'pms_clinical_notes: a signed note is locked (append-only: add an amendment)');
END;

CREATE TRIGGER IF NOT EXISTS pms_note_amendments_locked BEFORE UPDATE ON pms_note_amendments
WHEN NEW.anonymised_at IS NULL
  OR NEW.kind IS NOT OLD.kind
  OR NEW.note_id IS NOT OLD.note_id
  OR NEW.patient_id IS NOT OLD.patient_id
  OR NEW.author_user_id IS NOT OLD.author_user_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'pms_note_amendments: an amendment is locked (append-only)');
END;
