-- ClinForms 0225 (SQLite / Cloudflare D1): clinic system, billing - Healthcode e-billing groundwork (HC13).
-- Where an insurer invoice's bill is with Healthcode: exported, validated, failed, collected or paid - set by the
-- clinic by hand for now (NULL = not set). One row per invoice, changed never deleted, every change audited.
-- New table only (additive).
-- Kept in step with supabase/migrations/20261024000225_pms_invoice_bill_status.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_invoice_bill_status (
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  status TEXT CHECK (status IS NULL OR status IN ('exported', 'validated', 'failed', 'collected', 'paid')),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, invoice_id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES pms_invoices (tenant_id, id) ON DELETE CASCADE
);
