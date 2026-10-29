/**
 * M10 review (production readiness): the release reaching a database BEFORE the clinic system's migrations (only
 * ClinForms' own 0001–0008 applied – production until they run). The platform page's package list and the
 * offboarding must keep working for every ClinForms clinic: a missing clinic-system table reads as empty, and the
 * offboarding names no clinic-system table at all for a clinic without rows in them. On node:sqlite and PGlite.
 * Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Kysely, PGliteDialect } from "kysely";
import { applyPostgresMigrations, applySqliteMigrations, readMigrations, repoPath, POSTGRES_MIGRATIONS_DIR, SQLITE_MIGRATIONS_DIR } from "../db/migrations";
import { NodeSqliteDialect, openSqliteDatabase } from "../db/dialects/sqlite-local";
import { createPglite, pgliteMigrationClient } from "../db/testing/pglite";
import { testCipher } from "../db/testing/databases";
import type { Database } from "../db/schema";
import { createClinic, offboardClinic } from "../auth/platform";
import { listClinicPackages } from "../admin/platform-console";
import { listAudit } from "../repos/audit";
import { countPmsRows } from "./offboard";
import { isMissingPmsTable } from "./missing-table";

const SECRET = "b".repeat(40);
/** ClinForms' own migrations end at 0008; the clinic system's start at 0100 (Postgres twins end in the same number). */
const isClinFormsOwn = (name: string, kind: "sqlite" | "postgres") => (kind === "sqlite" ? name.slice(0, 4) : name.slice(10, 14)) < "0100";

function onlyClinFormsMigrations(kind: "sqlite" | "postgres"): string {
  const src = repoPath(kind === "sqlite" ? SQLITE_MIGRATIONS_DIR : POSTGRES_MIGRATIONS_DIR);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clinforms-pre-k2-${kind}-`));
  for (const file of readMigrations(src, kind).filter((f) => isClinFormsOwn(f.name, kind))) fs.writeFileSync(path.join(dir, file.name), file.sql);
  return dir;
}

interface Handle {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const factories: [string, () => Promise<Handle>][] = [
  [
    "node:sqlite",
    async () => {
      const sqlite = openSqliteDatabase(":memory:");
      const dir = onlyClinFormsMigrations("sqlite");
      const applied = applySqliteMigrations(sqlite, dir);
      assert.ok(applied.length >= 8 && applied.every((n) => n < "0100"), applied.join(","));
      fs.rmSync(dir, { recursive: true, force: true });
      const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: sqlite }) });
      return { db, close: () => db.destroy() };
    },
  ],
  [
    "PGlite (Postgres)",
    async () => {
      const pglite = await createPglite();
      const dir = onlyClinFormsMigrations("postgres");
      await applyPostgresMigrations(pgliteMigrationClient(pglite), dir);
      fs.rmSync(dir, { recursive: true, force: true });
      const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
      return { db, close: () => db.destroy() };
    },
  ],
];

describe("isMissingPmsTable", () => {
  it("recognises SQLite / D1 and Postgres wording for the named table only", () => {
    assert.ok(isMissingPmsTable(new Error("D1_ERROR: no such table: clinic_entitlements: SQLITE_ERROR"), "clinic_entitlements"));
    assert.ok(isMissingPmsTable(new Error("no such table: main.pms_patients"), "pms_patients"));
    assert.ok(isMissingPmsTable(Object.assign(new Error('relation "pms_patients" does not exist'), { code: "42P01" }), "pms_patients"));
    assert.ok(isMissingPmsTable(new Error("wrapped", { cause: new Error('relation "public.clinic_entitlements" does not exist') }), "clinic_entitlements"));
    assert.equal(isMissingPmsTable(new Error("no such table: pms_patients_x"), "pms_patients"), false);
    assert.equal(isMissingPmsTable(new Error("no such table: pms_cases"), "pms_patients"), false, "another table");
    assert.equal(isMissingPmsTable(new Error("SQLITE_BUSY: database is locked"), "pms_patients"), false);
    assert.equal(isMissingPmsTable(null, "pms_patients"), false);
    assert.equal(isMissingPmsTable(new Error("no such table: x"), "x|y"), false, "table names are never a pattern");
  });
});

for (const [label, factory] of factories) {
  describe(`a database before the clinic system's migrations – ${label}`, () => {
    let t: Handle;
    before(async () => {
      t = await factory();
      for (const slug of ["harbour-clinic", "quay-clinic"]) {
        await createClinic(t.db, { name: `${slug} (fictional)`, slug, ownerEmail: `owner@${slug}.example.com`, appOrigin: "http://localhost:3224", linkSecret: SECRET });
      }
    });
    after(async () => {
      await t?.close();
    });

    it("has no clinic-system table (the premise)", async () => {
      await assert.rejects(t.db.selectFrom("clinic_entitlements").selectAll().execute(), (err: unknown) => isMissingPmsTable(err, "clinic_entitlements"));
    });

    it("the platform page's package list reads the defaults: Reports on, the clinic system off", async () => {
      const view = await listClinicPackages(t.db, ["harbour-clinic", "quay-clinic"]);
      assert.deepEqual(view.get("harbour-clinic"), { tenantId: "harbour-clinic", reports: true, clinic: false });
      assert.deepEqual(view.get("quay-clinic"), { tenantId: "quay-clinic", reports: true, clinic: false });
    });

    it("countPmsRows reads every missing table as empty", async () => {
      assert.deepEqual(await countPmsRows(t.db, "harbour-clinic"), {});
    });

    it("offboarding a ClinForms clinic works – dry run and confirmed, one batch, the other clinic untouched", async () => {
      const dry = await offboardClinic(t.db, null, { slug: "harbour-clinic" });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.counts.clinicSystemRows, 0);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-offboard-pre-k2-"));
      try {
        const done = await offboardClinic(t.db, testCipher(), { slug: "harbour-clinic", confirm: true, exportDir: dir });
        assert.equal(done.dryRun, false);
        assert.ok(!done.exportFiles.includes("clinic-system.json"), "nothing of the clinic system to export");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const org = await t.db.selectFrom("organization").select("metadata").where("slug", "=", "harbour-clinic").executeTakeFirstOrThrow();
      assert.match(String(org.metadata), /offboardedAt/);
      const trail = await listAudit({ db: t.db }, "harbour-clinic", { action: "clinic.offboard" });
      assert.equal(trail.length, 1);
      assert.equal((trail[0].detail as { deleteBatches?: number }).deleteBatches, 1);
      const quay = await t.db.selectFrom("organization").select("metadata").where("slug", "=", "quay-clinic").executeTakeFirstOrThrow();
      assert.equal(quay.metadata, null, "the other clinic stays open");
    });
  });
}
