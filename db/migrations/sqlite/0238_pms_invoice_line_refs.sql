-- ClinForms 0238 (SQLite / Cloudflare D1): clinic system, billing - what an invoice line sells (PK02).
-- pms_invoice_line_refs: an item line that sells a course (ref_id = the course type), a gift card or a product. The
-- line itself stays an ordinary line of kind item. snapshot_json (courses): the sessions, services and validity sold,
-- taken when the draft is made, so a later change to the course type never changes what that invoice sells. Goes with its line (ON DELETE CASCADE). New table only (additive).
-- Kept in step with supabase/migrations/20261024000238_pms_invoice_line_refs.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_invoice_line_refs (
  tenant_id TEXT NOT NULL,
  invoice_line_id TEXT NOT NULL,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('course', 'gift_card', 'product')),
  ref_id TEXT NOT NULL,
  snapshot_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, invoice_line_id),
  FOREIGN KEY (tenant_id, invoice_line_id) REFERENCES pms_invoice_lines (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pms_invoice_line_refs_ref ON pms_invoice_line_refs (tenant_id, ref_type, ref_id);
