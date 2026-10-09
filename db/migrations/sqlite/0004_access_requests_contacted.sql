-- ClinForms 0004 (SQLite / Cloudflare D1): access_requests.contacted_at - when ClinForms staff marked a
-- "Request access" submission as contacted (the platform page /app/platform). NULL = not contacted yet.
-- Kept in step with supabase/migrations/20261010000004_access_requests_contacted.sql.
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this file holds this ONE statement only: the migration runners
-- apply it once (wrangler d1_migrations, the local _migrations table), and db/parity.test.ts accepts exactly
-- "duplicate column name" when it applies a lone ADD COLUMN file a second time.
ALTER TABLE access_requests ADD COLUMN contacted_at TEXT;
