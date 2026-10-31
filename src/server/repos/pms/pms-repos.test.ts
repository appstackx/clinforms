/**
 * The clinic-system repository suite on node:sqlite and PGlite, with the tenant-scope guard, plus the 0100
 * backfill: clinics that existed before entitlements keep Reports (an explicit row) and get no clinic system.
 * The D1 run is in workers/data-gateway/test/stack.test.ts. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openSqliteDatabase } from "../../db/dialects/sqlite-local";
import { applyPostgresMigrations, applySqliteMigrations, repoPath, POSTGRES_MIGRATIONS_DIR, SQLITE_MIGRATIONS_DIR } from "../../db/migrations";
import { createPglite, pgliteMigrationClient } from "../../db/testing/pglite";
import { createGuardedPgliteDb, createGuardedSqliteDb } from "./testing/guarded-db";
import { definePmsRepoSuite } from "./testing/pms-suite";

definePmsRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
definePmsRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());

/** A copy of a migrations folder holding only the files before `firstNew` (the database as production has it). */
function folderBefore(dir: string, firstNew: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-mig-"));
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".sql") && f < firstNew) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
  return tmp;
}

describe("migration 0100 backfill (existing clinics keep Reports, no clinic system)", () => {
  it("SQLite / D1", () => {
    const db = openSqliteDatabase(":memory:");
    applySqliteMigrations(db, folderBefore(repoPath(SQLITE_MIGRATIONS_DIR), "0100"));
    db.prepare(
      "INSERT INTO clinic_profile (tenant_id, organization_id, display_name, retention_days, drafting_enabled, created_at, updated_at) VALUES (?, ?, ?, 30, 0, ?, ?)",
    ).run("appstackx", "org_1", "AppStackX (internal)", "2026-10-10T17:00:00.000Z", "2026-10-10T17:00:00.000Z");
    applySqliteMigrations(db);
    const rows = db.prepare("SELECT tenant_id, package, status, starts_at FROM clinic_entitlements").all() as Record<string, unknown>[];
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ tenant_id: "appstackx", package: "reports", status: "active", starts_at: "2026-10-10T17:00:00.000Z" }]);
    // Re-applying the file does nothing (a clinic switched off later stays off).
    db.prepare("UPDATE clinic_entitlements SET status = 'paused'").run();
    db.exec(fs.readFileSync(path.join(repoPath(SQLITE_MIGRATIONS_DIR), "0100_clinic_entitlements.sql"), "utf8"));
    assert.equal((db.prepare("SELECT status FROM clinic_entitlements").all()[0] as { status: string }).status, "paused");
    db.close();
  });

  it("Postgres", async () => {
    const pglite = await createPglite();
    const client = pgliteMigrationClient(pglite);
    await applyPostgresMigrations(client, folderBefore(repoPath(POSTGRES_MIGRATIONS_DIR), "20261024000100"));
    await pglite.query(
      "insert into clinic_profile (tenant_id, organization_id, display_name, retention_days, drafting_enabled, created_at, updated_at) values ($1, $2, $3, 30, 0, $4, $4)",
      ["appstackx", "org_1", "AppStackX (internal)", "2026-10-10T17:00:00.000Z"],
    );
    await applyPostgresMigrations(client);
    const { rows } = await pglite.query<Record<string, unknown>>("select tenant_id, package, status, starts_at from clinic_entitlements");
    assert.deepEqual(rows, [{ tenant_id: "appstackx", package: "reports", status: "active", starts_at: "2026-10-10T17:00:00.000Z" }]);
    await pglite.close();
  });
});
