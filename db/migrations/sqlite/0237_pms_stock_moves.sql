-- ClinForms 0237 (SQLite / Cloudflare D1): clinic system, billing - stock (PK05).
-- pms_stock_moves: append-only stock changes per product and site - received (+), sold (-, when an invoice is issued),
-- returned (+, its line credited in full), adjusted (+ or -, with a reason, encrypted). On hand = the sum. One sold and
-- one returned move per invoice line (pms_stock_moves_line). Goes with its product, site and line (ON DELETE CASCADE,
-- offboarding only). New table only (additive).
-- Kept in step with supabase/migrations/20261024000237_pms_stock_moves.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_stock_moves (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('received', 'sold', 'returned', 'adjusted')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  invoice_line_id TEXT,
  reason_enc TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((kind IN ('received', 'returned') AND quantity > 0) OR (kind = 'sold' AND quantity < 0) OR kind = 'adjusted'),
  FOREIGN KEY (tenant_id, product_id) REFERENCES pms_products (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, invoice_line_id) REFERENCES pms_invoice_lines (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pms_stock_moves_line ON pms_stock_moves (tenant_id, invoice_line_id, kind) WHERE invoice_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pms_stock_moves_site ON pms_stock_moves (tenant_id, site_id, product_id);
CREATE INDEX IF NOT EXISTS pms_stock_moves_created ON pms_stock_moves (tenant_id, site_id, created_at);
