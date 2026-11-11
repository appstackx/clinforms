-- ClinForms 0236 (SQLite / Cloudflare D1): clinic system, billing - products (PK05, docs/clinic-system/courses-giftcards-products.md).
-- pms_products: what the clinic sells over the counter - name, optional SKU (unique in the clinic), price in pence,
-- VAT code, low-stock level, on sale or not. Switched off, never deleted. Hangs off the clinic's pms_billing_settings
-- row (ON DELETE CASCADE, offboarding only - written first in the same batch). New table only (additive).
-- Kept in step with supabase/migrations/20261024000236_pms_products.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_products (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  sku TEXT,
  price_pence INTEGER NOT NULL CHECK (price_pence BETWEEN 0 AND 100000000),
  vat_code TEXT NOT NULL CHECK (vat_code IN ('exempt', 'standard', 'reduced', 'zero')),
  low_stock_at INTEGER CHECK (low_stock_at IS NULL OR low_stock_at >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES pms_billing_settings (tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pms_products_sku ON pms_products (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS pms_products_name ON pms_products (tenant_id, active, name);
