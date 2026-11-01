/**
 * TESTS ONLY: the Healthcode groundwork repository suite (../healthcode-repos.test.ts), run unchanged on node:sqlite
 * and PGlite. Fictional clinics and insurers only. Ends with the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createReferrer } from "../../referrers";
import { unscopedStatements, type GuardedDb } from "../../testing/guarded-db";
import { healthcodeForSite } from "../../../../../modules/pms/billing/healthcode";
import { createSite } from "../../directory";
import { getHealthcodeSettings, getPayerHealthcode, payerHealthcodes, setClinicHealthcode, setPayerHealthcode, setSiteHealthcode } from "../healthcode";

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_admin_01", sessionId: "sess_01" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };

export function defineHealthcodeRepoSuite(label: string, factory: () => Promise<GuardedDb>): void {
  describe(`Healthcode repositories on ${label}`, () => {
    let suite: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date("2026-11-01T09:00:00.000Z") };
      id.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health Insurance (fictional)" }, ACTOR)).id;
      id.insurerB = (await createReferrer(ctx, B, { kind: "insurer", name: "Harbour Health (fictional)" }, ACTOR_B)).id;
      id.site1 = (await createSite(ctx, A, { name: "Bletchley (fictional)" }, ACTOR)).id;
      id.site2 = (await createSite(ctx, A, { name: "Towcester (fictional)" }, ACTOR)).id;
      id.siteB = (await createSite(ctx, B, { name: "Harbour (fictional)" }, ACTOR_B)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("HC06 payer accounts: nothing set up reads as null; an audited upsert; clear a field; clinic B kept apart", async () => {
      assert.equal(await getPayerHealthcode(ctx, A, id.insurer), null);
      await setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "nwh", providerNumber: "PRV-DEMO-001", diagnosisRequired: true }, ACTOR);
      let p = await getPayerHealthcode(ctx, A, id.insurer);
      assert.deepEqual([p?.rev, p?.insurerCode, p?.providerNumber, p?.diagnosisRequired], [1, "nwh", "PRV-DEMO-001", true]);
      await setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "nwh", providerNumber: "", diagnosisRequired: null }, ACTOR);
      p = await getPayerHealthcode(ctx, A, id.insurer);
      assert.deepEqual([p?.rev, p?.providerNumber, p?.diagnosisRequired], [2, null, null]);
      const audit = (await listAudit(ctx, A, { limit: 20 })).filter((e) => e.action === "pms.payer_healthcode.set");
      assert.equal(audit.length, 2);
      assert.ok(!JSON.stringify(audit).includes("PRV-DEMO-001"), "the audit row never holds the number itself");
      // Clinic B: cannot write to A's payer account, sees none of A's rows.
      await assert.rejects(setPayerHealthcode(ctx, B, id.insurer, { insurerCode: "xx1" }, ACTOR_B), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await payerHealthcodes(ctx, B)).size, 0);
      await assert.rejects(setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "not a code!" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
    });

    it("HC07 Site ID and payee provider number: the clinic's, a site's own, blank = the clinic's again", async () => {
      const s0 = await getHealthcodeSettings(ctx, A);
      assert.deepEqual([s0.rev, s0.clinic.siteCode, Object.keys(s0.sites).length], [0, null, 0]);
      await setClinicHealthcode(ctx, A, { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" }, ACTOR);
      await setSiteHealthcode(ctx, A, id.site2, { siteCode: "SITE-DEMO-2" }, ACTOR);
      let s = await getHealthcodeSettings(ctx, A);
      assert.equal(s.rev, 1);
      assert.deepEqual(healthcodeForSite(s, id.site1), { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" });
      assert.deepEqual(healthcodeForSite(s, id.site2), { siteCode: "SITE-DEMO-2", payeeProviderNumber: "PAYEE-DEMO-1" });
      assert.deepEqual(healthcodeForSite(s, null), { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" });
      await setSiteHealthcode(ctx, A, id.site2, { siteCode: "", payeeProviderNumber: "" }, ACTOR);
      s = await getHealthcodeSettings(ctx, A);
      assert.deepEqual(s.sites, {});
      // Another clinic's site is refused; clinic B sees nothing of A's.
      await assert.rejects(setSiteHealthcode(ctx, A, id.siteB, { siteCode: "X1" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await getHealthcodeSettings(ctx, B)).rev, 0);
      await assert.rejects(setClinicHealthcode(ctx, A, { siteCode: "bad code" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      const audit = await listAudit(ctx, A, { limit: 50 });
      assert.equal(audit.filter((e) => e.action === "pms.healthcode_settings.set").length, 1);
      assert.equal(audit.filter((e) => e.action === "pms.site_healthcode.set").length, 2);
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
