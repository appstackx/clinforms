-- audit_log stays append-only against REPLACE conflict resolution as well (INSERT OR REPLACE, REPLACE INTO,
-- an upsert on id): SQLite removes the conflicting row WITHOUT firing DELETE triggers while recursive_triggers
-- is off (always, on D1), so the 0001 triggers alone let an existing entry be overwritten.
-- This trigger refuses any insert whose id already exists, before conflict resolution runs.
-- (Postgres needs nothing extra: it has no REPLACE, and an upsert fires the BEFORE UPDATE trigger.)
CREATE TRIGGER IF NOT EXISTS audit_log_no_replace BEFORE INSERT ON audit_log
WHEN EXISTS (SELECT 1 FROM audit_log WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
