-- ClinForms 0101 (SQLite / Cloudflare D1): clinic-system foundation, part 2 - the clinic directory: sites,
-- rooms, practitioners, services (appointment types), referrers and payer accounts, price lists.
-- Kept in step with supabase/migrations/20261024000101_pms_directory.sql (db/parity.test.ts).
-- Every table: PRIMARY KEY (tenant_id, id), foreign keys that include tenant_id (a row can never point at
-- another clinic's row), booleans 0/1, dates TEXT YYYY-MM-DD, money in whole pence, import_ref unique per clinic.
-- Rows are never deleted by the app (switched inactive instead) except price list items.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_sites (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  code TEXT,
  address_json TEXT,
  postcode TEXT,
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sites_name ON pms_sites (tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_sites_import_ref ON pms_sites (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_rooms (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_rooms_site_name ON pms_rooms (tenant_id, site_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_rooms_import_ref ON pms_rooms (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_practitioners (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  profession TEXT NOT NULL DEFAULT 'physiotherapist',
  registration_number TEXT,
  email TEXT,
  phone TEXT,
  colour TEXT,
  default_site_id TEXT,
  bookable INTEGER NOT NULL DEFAULT 1 CHECK (bookable IN (0, 1)),
  online_bookable INTEGER NOT NULL DEFAULT 0 CHECK (online_bookable IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, default_site_id) REFERENCES pms_sites (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_practitioners_user ON pms_practitioners (tenant_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS pms_practitioners_import_ref ON pms_practitioners (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_services (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  code TEXT,
  category TEXT NOT NULL DEFAULT 'treatment',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  default_price_pence INTEGER CHECK (default_price_pence IS NULL OR default_price_pence >= 0),
  colour TEXT,
  online_bookable INTEGER NOT NULL DEFAULT 0 CHECK (online_bookable IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_services_name ON pms_services (tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_services_import_ref ON pms_services (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_referrers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev > 0),
  kind TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  search_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address_json TEXT,
  postcode TEXT,
  notes_enc TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  import_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_referrers_kind_name ON pms_referrers (tenant_id, kind, search_name);
CREATE UNIQUE INDEX IF NOT EXISTS pms_referrers_import_ref ON pms_referrers (tenant_id, import_ref);

CREATE TABLE IF NOT EXISTS pms_price_lists (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  payer_type TEXT,
  referrer_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  valid_from TEXT,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES pms_referrers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_price_lists_name ON pms_price_lists (tenant_id, name);

CREATE TABLE IF NOT EXISTS pms_price_list_items (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  price_list_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  billing_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES pms_price_lists (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES pms_services (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pms_price_list_items_list_service ON pms_price_list_items (tenant_id, price_list_id, service_id);
CREATE INDEX IF NOT EXISTS pms_price_list_items_service ON pms_price_list_items (tenant_id, service_id);
