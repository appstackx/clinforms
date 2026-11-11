-- ClinForms 0226 (Postgres / Supabase): clinic system, records module (B07) - pms_attachments.object_key. NULL = the
-- file's encrypted pieces are in pms_attachment_chunks (as before), otherwise the key of the ONE encrypted object in
-- the private file store ("<tenant>/attachment/<id>", src/server/storage/file-store.ts).
-- Kept in step with db/migrations/sqlite/0226_pms_attachments_object_key.sql. Idempotent.
alter table public.pms_attachments add column if not exists object_key text;
