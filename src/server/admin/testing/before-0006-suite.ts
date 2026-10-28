/**
 * TESTS ONLY (security fix 24/10/2026, ops M1): the release running on a database BEFORE migration 0006 (no
 * clinic_plan table – production until the migration is applied). The app's read paths (the Report API's clinic
 * profile, the platform page's overview, the owner's first visit) must work as "no plan"; the strict reads used by the
 * admin scripts (admin:set-trial --show, the deploy gate) and every write must still fail loudly.
 *
 * Run on node:sqlite and PGlite (src/server/admin/before-0006.test.ts) and on D1 through the gateway – stand-in and
 * real local D1 (workers/data-gateway/test/admin-stack.test.ts). `factory` returns a database with clinic_plan dropped.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";
import { DbError } from "../../db/errors";
import { loadClinicProfile } from "../../auth/medreport-actor";
import { getClinicPlan, isMissingClinicPlanTable, listClinicPlans, readClinicPlan, readClinicPlans, setClinicTrial } from "../../repos/clinic-plan";
import { upsertClinicProfile } from "../../repos/clinic-profile";
import { clinicTrialRunning, noteClinicVisit } from "../clinic-plan";
import { listClinicsOverview } from "../platform-console";

export interface Before0006SuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const SLUG = "pre-0006-test";
const AT = "2026-10-24T09:00:00.000Z";

export function defineBefore0006Suite(label: string, factory: () => Promise<Before0006SuiteDb>, options: { skip?: string | false } = {}): void {
  describe(`a database before migration 0006 (no clinic_plan) – ${label}`, { skip: options.skip }, () => {
    let t: Before0006SuiteDb;
    before(async () => {
      t = await factory();
      const orgId = `org-${SLUG}`;
      await t.db.insertInto("organization").values({ id: orgId, name: "Pre-0006 Clinic (fictional)", slug: SLUG, logo: null, createdAt: AT, metadata: null }).execute();
      await upsertClinicProfile({ db: t.db, now: () => new Date(AT) }, SLUG, { organizationId: orgId, displayName: "Pre-0006 Clinic (fictional)", draftingEnabled: true });
      const userId = `u-owner-${SLUG}`;
      await t.db.insertInto("user").values({ id: userId, name: "Olive Owner (fictional)", email: `${userId}@clinic.example`, emailVerified: true, image: null, createdAt: AT, updatedAt: AT, twoFactorEnabled: true }).execute();
      await t.db.insertInto("member").values({ id: `m-${userId}`, organizationId: orgId, userId, role: "owner", createdAt: AT }).execute();
    });
    after(async () => {
      await t?.close();
    });

    it("strict reads and every write still fail – recognised as the missing table (the deploy gate stays loud)", async () => {
      await assert.rejects(getClinicPlan({ db: t.db }, SLUG), (err: unknown) => isMissingClinicPlanTable(err));
      await assert.rejects(listClinicPlans({ db: t.db }), (err: unknown) => isMissingClinicPlanTable(err));
      await assert.rejects(setClinicTrial({ db: t.db }, SLUG, { days: 3, startOnFirstSignIn: true }), (err: unknown) => isMissingClinicPlanTable(err));
    });

    it("the app's reads see 'no plan': Report API profile, platform overview, owner visit, trial wording", async () => {
      assert.equal(await readClinicPlan({ db: t.db }, SLUG), null);
      assert.deepEqual(await readClinicPlans({ db: t.db }), []);
      const profile = await loadClinicProfile(t.db, SLUG, new Date(AT));
      assert.ok(profile, "the clinic profile is still read");
      assert.equal(profile.displayName, "Pre-0006 Clinic (fictional)");
      assert.equal(profile.draftingEnabled, true);
      assert.equal(profile.trial, undefined, "no trial without the table");
      assert.equal(profile.draftingLimits, undefined);
      const overview = await listClinicsOverview(t.db, new Date(AT));
      const row = overview.find((c) => c.tenantId === SLUG);
      assert.ok(row, "the platform page lists the clinic");
      assert.equal(row.plan, null);
      assert.equal(row.access.state, "full");
      assert.equal(await noteClinicVisit(t.db, { tenantId: SLUG, userId: `u-owner-${SLUG}`, role: "owner" }, new Date(AT)), null);
      assert.equal(await clinicTrialRunning(t.db, SLUG, new Date(AT)), false);
    });
  });
}

/** The missing-table check itself (no database): only that table's absence, on every dialect's wording. */
export function defineMissingTableMatcherTests(): void {
  describe("isMissingClinicPlanTable (security fix 24/10, ops M1)", () => {
    it("matches SQLite, D1-through-the-gateway and Postgres wordings; nothing else", () => {
      assert.equal(isMissingClinicPlanTable(new Error("no such table: clinic_plan")), true);
      assert.equal(isMissingClinicPlanTable(new DbError("SQL_ERROR", "Data gateway: no such table: clinic_plan", { status: 400 })), true);
      assert.equal(isMissingClinicPlanTable(new DbError("SQL_ERROR", "Data gateway: D1_ERROR: no such table: clinic_plan: SQLITE_ERROR", { status: 400 })), true);
      assert.equal(isMissingClinicPlanTable(Object.assign(new Error('relation "clinic_plan" does not exist'), { code: "42P01" })), true);
      assert.equal(isMissingClinicPlanTable(Object.assign(new Error('relation "public.clinic_plan" does not exist'), { code: "42P01" })), true);
      assert.equal(isMissingClinicPlanTable(new Error("wrapped", { cause: new Error("no such table: clinic_plan") })), true);
      assert.equal(isMissingClinicPlanTable(new Error("no such table: clinic_profile")), false);
      assert.equal(isMissingClinicPlanTable(new Error("no such table: clinic_plans")), false);
      assert.equal(isMissingClinicPlanTable(Object.assign(new Error('relation "reports" does not exist'), { code: "42P01" })), false);
      assert.equal(isMissingClinicPlanTable(new DbError("GATEWAY_UNAVAILABLE", "Data gateway: unavailable")), false);
      assert.equal(isMissingClinicPlanTable(null), false);
      assert.equal(isMissingClinicPlanTable("no such table: clinic_plan"), false);
    });
  });
}
