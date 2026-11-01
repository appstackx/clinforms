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
import { getPayerHealthcode, payerHealthcodes, setPayerHealthcode } from "../healthcode";

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

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
