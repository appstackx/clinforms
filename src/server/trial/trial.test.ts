/**
 * The self-serve free trial (docs/clinic-system/trial.md) on SQLite and PGlite (./testing/trial-suite.ts); D1 through
 * the gateway in workers/data-gateway/test/trial-stack.test.ts. Run by npm run test:db.
 */
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineTrialSuite } from "./testing/trial-suite";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadClinicProfile } from "../auth/medreport-actor";
import { createClinic } from "../auth/platform";
import { setClinicTrial } from "../repos/clinic-plan";
import { readSelfTrial } from "../repos/self-trial";
import { selfTrialEnded } from "./access";
import { runTrialEmailSweep, sendTrialEmailNow } from "./emails";
import { trialReportAllowance } from "./allowance";

defineTrialSuite("SQLite", async () => createSqliteTestDb());
defineTrialSuite("PGlite", async () => createPgliteTestDb());

/* ------------------------------------------------------------------ deployed before migration 0011 */

describe("self-serve free trial – a database before migration 0011 (the release deployed first, the switch off)", () => {
  it("every read path reads 'no self-serve trial'; the cron's sweep and the welcome do nothing", async () => {
    const t = createSqliteTestDb();
    try {
      t.sqlite.exec("DROP TABLE self_trial; DROP TABLE trial_email;");
      const c = await createClinic(t.db, { name: "Old Mill Physio (fictional)", slug: "old-mill", ownerEmail: "o@old-mill.example", appOrigin: "http://localhost:3000", linkSecret: "x".repeat(40), sendEmail: false });
      await setClinicTrial({ db: t.db }, c.tenantId, { days: 1, startOnFirstSignIn: false });
      assert.equal(await readSelfTrial({ db: t.db }, c.tenantId), null);
      assert.equal(await trialReportAllowance(t.db, c.tenantId), null);
      assert.equal(await selfTrialEnded(t.db, c.tenantId, new Date(Date.now() + 3 * 86_400_000)), false);
      assert.equal((await loadClinicProfile(t.db, c.tenantId))?.trialReports, undefined);
      assert.deepEqual(await runTrialEmailSweep(t.db), { clinics: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 });
      assert.equal(await sendTrialEmailNow(t.db, c.tenantId, "welcome"), "no_trial");
    } finally {
      await t.close();
    }
  });
});
