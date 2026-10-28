-- ClinForms 0103 (SQLite / Cloudflare D1): clinic-system foundation, part 4 - configurable access. The clinic's
-- overrides of a role's permissions, a member's own exceptions, the sites a member works at and can see, whether
-- their clinic-system access is on, and the change history (who, when, what - never patient data).
-- Kept in step with supabase/migrations/20261024000103_pms_access.sql (db/parity.test.ts).
-- Permission ids and the locks live in src/modules/pms/core/permissions.ts - the database stores choices only and
-- the locks are applied again whenever permissions are read. user_id is the Better Auth user id.
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_role_permissions (
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'clinician', 'staff')),
  permission TEXT NOT NULL CHECK (length(permission) BETWEEN 3 AND 40),
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, role, permission)
);

CREATE TABLE IF NOT EXISTS pms_member_access (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  all_sites INTEGER NOT NULL DEFAULT 1 CHECK (all_sites IN (0, 1)),
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS pms_member_permissions (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (length(permission) BETWEEN 3 AND 40),
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, permission),
  FOREIGN KEY (tenant_id, user_id) REFERENCES pms_member_access (tenant_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pms_member_sites (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  works_at INTEGER NOT NULL DEFAULT 0 CHECK (works_at IN (0, 1)),
  can_see INTEGER NOT NULL DEFAULT 0 CHECK (can_see IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, site_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES pms_member_access (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, site_id) REFERENCES pms_sites (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_member_sites_site ON pms_member_sites (tenant_id, site_id);

CREATE TABLE IF NOT EXISTS pms_access_changes (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('role', 'member')),
  subject_role TEXT,
  subject_user_id TEXT,
  items_json TEXT NOT NULL,
  changed_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS pms_access_changes_created ON pms_access_changes (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS pms_access_changes_subject ON pms_access_changes (tenant_id, subject_user_id, created_at);
