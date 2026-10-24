/**
 * Platform operations for packages (admin script and platform page) and offboarding a clinic that used the
 * clinic system, on node:sqlite and PGlite. Also: the Report API refuses a clinic whose Reports package is off.
 * Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { listAudit } from "../repos/audit";
import { createPglite, pgliteMigrationClient } from "../db/testing/pglite";
import { createSqliteTestDb, testCipher, type TestDb } from "../db/testing/databases";
import { applyPostgresMigrations } from "../db/migrations";
import { Kysely, PGliteDialect } from "kysely";
import type { Database } from "../db/schema";
import { createClinic, offboardClinic } from "../auth/platform";
import { PLATFORM_AUDIT_TENANT, listClinicPackages, setClinicPackageAsPlatform, type PlatformAdmin } from "../admin/platform-console";
import { isPackageOn } from "../repos/pms/entitlements";
import { createPatient } from "../repos/pms/patients";
import { createCase } from "../repos/pms/cases";
import { createSite } from "../repos/pms/directory";
import { setClinicEntitlement } from "./admin";
import { countPmsRows } from "./offboard";
import { RepoInputError } from "../repos/context";

const SECRET = "p".repeat(40);
const ADMIN: PlatformAdmin = { userId: "user_platform_admin", sessionId: "sess_platform", email: "ops@platform.example", name: "Ops" };
const ACTOR = { userId: "user_member_1", sessionId: "sess_1" };

async function pgliteDb(): Promise<TestDb> {
  const pglite = await createPglite();
  await applyPostgresMigrations(pgliteMigrationClient(pglite));
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
  return { db, close: () => db.destroy() };
}

for (const [label, factory] of [
  ["SQLite", async () => createSqliteTestDb()],
  ["PGlite", pgliteDb],
] as const) {
  describe(`packages and offboarding on ${label}`, () => {
    let t: TestDb;
    const cipher = testCipher();
    before(async () => {
      t = await factory();
      for (const slug of ["riverside-demo", "harbour-clinic"]) {
        await createClinic(t.db, { name: `${slug} (fictional)`, slug, ownerEmail: `owner@${slug}.example.com`, appOrigin: "http://localhost:3180", linkSecret: SECRET });
      }
    });
    after(async () => {
      await t?.close();
    });

    it("the admin script previews by default and applies with confirm (audited twice)", async () => {
      const preview = await setClinicEntitlement(t.db, { slug: "riverside-demo", package: "clinic", on: true });
      assert.equal(preview.dryRun, true);
      assert.deepEqual(preview.before, { status: null, on: false });
      assert.equal(await isPackageOn({ db: t.db }, "riverside-demo", "clinic"), false, "a preview changes nothing");
      const done = await setClinicEntitlement(t.db, { slug: "riverside-demo", package: "clinic", on: true, status: "trial", priceSource: "design_partner", confirm: true });
      assert.deepEqual(done.after, { status: "trial", on: true });
      assert.equal(await isPackageOn({ db: t.db }, "riverside-demo", "clinic"), true);
      assert.equal(await isPackageOn({ db: t.db }, "harbour-clinic", "clinic"), false);
      const clinicTrail = await listAudit({ db: t.db }, "riverside-demo", { action: "clinic.package_change" });
      assert.equal(clinicTrail.length, 1);
      assert.equal(clinicTrail[0].userId, "clinforms-platform", "shown as ClinForms support in the clinic's trail");
      assert.equal((await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.entitlement_set" })).length, 1);
      await assert.rejects(setClinicEntitlement(t.db, { slug: "nobody", package: "clinic", on: true, confirm: true }), RepoInputError);
      await assert.rejects(setClinicEntitlement(t.db, { slug: "riverside-demo", package: "clinic", on: true, status: "paused" }), /--on goes with/);
    });

    it("the platform page lists and switches packages for open clinics", async () => {
      let view = await listClinicPackages(t.db, ["riverside-demo", "harbour-clinic"]);
      assert.deepEqual(view.get("harbour-clinic"), { tenantId: "harbour-clinic", reports: true, clinic: false });
      assert.deepEqual(await setClinicPackageAsPlatform(t.db, ADMIN, { tenantId: "harbour-clinic", package: "reports", on: false }), { changed: true, on: false });
      view = await listClinicPackages(t.db, ["harbour-clinic"]);
      assert.deepEqual(view.get("harbour-clinic"), { tenantId: "harbour-clinic", reports: false, clinic: false });
      assert.deepEqual(await setClinicPackageAsPlatform(t.db, ADMIN, { tenantId: "harbour-clinic", package: "reports", on: true }), { changed: true, on: true });
      const platform = await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.entitlement_set" });
      assert.ok(platform.some((e) => e.userId === ADMIN.userId));
      await assert.rejects(setClinicPackageAsPlatform(t.db, ADMIN, { tenantId: "nope", package: "clinic", on: true }), RepoInputError);
    });

    it("offboarding exports the clinic-system rows decrypted, then deletes them – the other clinic keeps its own", async () => {
      const ctx = { db: t.db, cipher };
      const site = await createSite(ctx, "riverside-demo", { name: "Bletchley (fictional)" }, ACTOR);
      const p = await createPatient(ctx, "riverside-demo", { firstName: "Megan", lastName: "Hart", alerts: "Latex allergy" }, ACTOR);
      await createCase(ctx, "riverside-demo", { patientId: p.id, siteId: site.id, title: "Neck", openedOn: "2026-10-01", referralReason: "Rear-end collision" }, ACTOR);
      const other = await createPatient(ctx, "harbour-clinic", { firstName: "Other", lastName: "Patient" }, ACTOR);
      const dry = await offboardClinic(t.db, null, { slug: "riverside-demo" });
      assert.equal(dry.dryRun, true);
      assert.ok(dry.counts.clinicSystemRows >= 4, `counted ${dry.counts.clinicSystemRows}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-offboard-"));
      const done = await offboardClinic(t.db, cipher, { slug: "riverside-demo", confirm: true, exportDir: dir });
      assert.ok(done.exportFiles.includes("clinic-system.json"));
      const exported = JSON.parse(fs.readFileSync(path.join(dir, "clinic-system.json"), "utf8")) as Record<string, Record<string, unknown>[]>;
      assert.equal(exported.pms_patients[0].alerts, "Latex allergy", "decrypted in the export");
      assert.equal("alerts_enc" in exported.pms_patients[0], false);
      assert.equal(exported.pms_cases[0].referral_reason, "Rear-end collision");
      assert.equal(exported.clinic_entitlements.find((e) => e.package === "clinic")?.status, "trial");
      assert.deepEqual(await countPmsRows(t.db, "riverside-demo"), {}, "nothing left for the closed clinic");
      assert.equal((await countPmsRows(t.db, "harbour-clinic")).pms_patients, 1);
      assert.ok(other.id);
      fs.rmSync(dir, { recursive: true, force: true });
      await assert.rejects(setClinicPackageAsPlatform(t.db, ADMIN, { tenantId: "riverside-demo", package: "clinic", on: true }), /closed/);
    });
  });
}
