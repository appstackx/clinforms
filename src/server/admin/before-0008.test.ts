/**
 * Deploy order (10/2026): the release running on a database that has clinic_plan (0006) but NOT migration 0008
 * (clinic_plan.demo_clinic) – production between the deploy and the migration. Every app read must work and see
 * "a real clinic"; trials and limits must keep working; only switching the demo flag on fails, loudly.
 * On node:sqlite and PGlite. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { createMigratedPgliteDb } from "../db/testing/pglite";
import { createSqliteTestDb } from "../db/testing/databases";
import { loadClinicProfile } from "../auth/medreport-actor";
import { getClinicPlan, setClinicDemoFlag, setClinicDraftingLimits, setClinicTrial } from "../repos/clinic-plan";
import { upsertClinicProfile } from "../repos/clinic-profile";
import { isDemoClinic, setDemoClinic } from "./clinic-plan";
import { listClinicsOverview } from "./platform-console";

const SLUG = "pre-0008-test";
const AT = "2026-10-25T09:00:00.000Z";

function defineBefore0008Suite(label: string, factory: () => Promise<{ db: Kysely<Database>; close: () => Promise<void> }>): void {
  describe(`a database before migration 0008 (no clinic_plan.demo_clinic) – ${label}`, () => {
    let t: { db: Kysely<Database>; close: () => Promise<void> };
    const ctx = () => ({ db: t.db, now: () => new Date(AT) });
    before(async () => {
      t = await factory();
      const orgId = `org-${SLUG}`;
      await t.db.insertInto("organization").values({ id: orgId, name: "Pre-0008 Clinic (fictional)", slug: SLUG, logo: null, createdAt: AT, metadata: null }).execute();
      await upsertClinicProfile(ctx(), SLUG, { organizationId: orgId, displayName: "Pre-0008 Clinic (fictional)", draftingEnabled: true });
    });
    after(async () => {
      await t?.close();
    });

    it("trials and limits still work; every read sees a real clinic (Report API, pages, platform overview)", async () => {
      await setClinicTrial(ctx(), SLUG, { days: 3, startOnFirstSignIn: false });
      await setClinicDraftingLimits(ctx(), SLUG, { perMinute: 5, perDay: 50 });
      const plan = await getClinicPlan(ctx(), SLUG);
      assert.equal(plan?.status, "trial");
      assert.equal(plan?.livePerDay, 50);
      assert.equal(plan?.demoClinic, false);
      assert.equal(await isDemoClinic(t.db, SLUG), false);
      const profile = await loadClinicProfile(t.db, SLUG, new Date(AT));
      assert.equal(profile?.trial?.state, "running");
      assert.equal(profile?.demoClinic, undefined);
      assert.equal((await listClinicsOverview(t.db, new Date(AT))).find((c) => c.tenantId === SLUG)?.plan?.demoClinic, false);
    });

    it("switching the demo flag on fails loudly (apply migration 0008 first)", async () => {
      await assert.rejects(setClinicDemoFlag(ctx(), SLUG, true), /demo_clinic/);
      await assert.rejects(setDemoClinic(t.db, { kind: "script" }, SLUG, true, new Date(AT)), /demo_clinic/);
      assert.equal(await isDemoClinic(t.db, SLUG), false);
    });
  });
}

defineBefore0008Suite("node:sqlite", async () => {
  const t = createSqliteTestDb();
  t.sqlite.exec("ALTER TABLE clinic_plan DROP COLUMN demo_clinic");
  return t;
});

defineBefore0008Suite("PGlite (Postgres)", async () => {
  const { db, pglite } = await createMigratedPgliteDb();
  await pglite.exec("ALTER TABLE public.clinic_plan DROP COLUMN demo_clinic");
  return { db, close: () => db.destroy() };
});
