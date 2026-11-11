-- ClinForms 0226 (SQLite / Cloudflare D1): clinic system, records module (B07) - pms_attachments.object_key. NULL = the
-- file's encrypted pieces are in pms_attachment_chunks (as before), otherwise the key of the ONE encrypted object
-- in the private file store ("<tenant>/attachment/<id>", src/server/storage/file-store.ts).
-- Kept in step with supabase/migrations/20261024000226_pms_attachments_object_key.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only (db/parity.test.ts).
ALTER TABLE pms_attachments ADD COLUMN object_key TEXT;
