/**
 * `npm run pms:seed-demo` order (scripts/pms/seed-demo.ts): the demonstration clinic, then the diary week, then the
 * clinical records – both module seeds run on the same clinic, and a second run of the pair adds nothing.
 * Run by `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClinic } from "../../src/server/auth/platform";
import { createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import { DEMO_CLINIC } from "./demo-data";
import { seedDiary } from "./seed-diary";
import { seedDemoClinic } from "./seed-lib";
import { seedBilling } from "./seed-billing";
import { seedRecords } from "./seed-records";

const NOW = new Date("2026-10-27T10:00:00.000Z");

describe("demo seed: clinic → diary → records → billing", () => {
  let t: TestDb;
  const cipher = testCipher();
  before(async () => {
    t = await createSqliteTestDb();
    await createClinic(t.db, { name: DEMO_CLINIC.name, slug: DEMO_CLINIC.slug, ownerEmail: DEMO_CLINIC.ownerEmail, appOrigin: "http://localhost:3180", linkSecret: "s".repeat(40) });
  });
  after(async () => {
    await t?.close();
  });

  it("both module seeds load on the demo clinic, in order, and a re-run adds nothing", async () => {
    const ctx = { db: t.db, cipher, now: () => NOW };
    const tid = DEMO_CLINIC.slug;
    await seedDemoClinic(ctx, { tenantId: tid, markDemo: true, now: NOW });
    const diary = await seedDiary(ctx, tid, { now: NOW });
    const records = await seedRecords(ctx, tid, { now: NOW });
    const billing = await seedBilling(ctx, tid, { now: NOW });
    assert.ok(diary.appointments > 0 && !diary.weekExisted, JSON.stringify(diary));
    assert.ok(billing.invoices > 5 && billing.payments > 0 && billing.uninvoicedLeft > 0 && !billing.existed, JSON.stringify(billing));
    assert.ok(records.notes > 0 && records.skipped === 0, JSON.stringify(records));

    const diaryAgain = await seedDiary(ctx, tid, { now: NOW });
    const recordsAgain = await seedRecords(ctx, tid, { now: NOW });
    assert.ok(diaryAgain.weekExisted && diaryAgain.appointments === 0, JSON.stringify(diaryAgain));
    assert.deepEqual([recordsAgain.notes, recordsAgain.outcomes], [0, 0]);
    assert.equal((await seedBilling(ctx, tid, { now: NOW })).existed, true, "billing: nothing added twice");
  });
});
