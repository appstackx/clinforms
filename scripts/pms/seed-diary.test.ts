/**
 * The demo diary (scripts/pms/seed-diary.ts) on the seeded demo clinic: refuses a clinic that is not a
 * demonstration clinic, loads a rota and a working week across two sites with mixed statuses, no double booking,
 * a second run adds nothing, a later week is added. node:sqlite and PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClinic } from "../../src/server/auth/platform";
import { createPgliteTestDb, createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import { listAudit } from "../../src/server/repos/audit";
import { listDiary } from "../../src/server/repos/pms/diary/appointments";
import { listAvailability } from "../../src/server/repos/pms/diary/availability";
import { listWaitingList } from "../../src/server/repos/pms/diary/waiting-list";
import { londonRange } from "../../src/modules/pms/diary/time";
import { findClashes } from "../../src/modules/pms/diary/rules";
import { DEMO_CLINIC } from "./demo-data";
import { seedDemoClinic } from "./seed-lib";
import { seedDiary } from "./seed-diary";

const SECRET = "s".repeat(40);
/** Wednesday 11 November 2026, 11:00 UK. */
const NOW = new Date("2026-11-11T11:00:00.000Z");

for (const [label, factory] of [
  ["SQLite", async () => createSqliteTestDb()],
  ["PGlite", () => createPgliteTestDb()],
] as const) {
  describe(`the demo diary on ${label}`, () => {
    let t: TestDb;
    const cipher = testCipher();
    const tid = DEMO_CLINIC.slug;
    before(async () => {
      t = await factory();
      await createClinic(t.db, { name: DEMO_CLINIC.name, slug: tid, ownerEmail: DEMO_CLINIC.ownerEmail, appOrigin: "http://localhost:3180", linkSecret: SECRET });
      await createClinic(t.db, { name: "Harbour Clinic", slug: "harbour-clinic", ownerEmail: "o@harbour.example.com", appOrigin: "http://localhost:3180", linkSecret: SECRET });
    });
    after(async () => {
      await t?.close();
    });

    it("refuses a clinic that is not a demonstration clinic", async () => {
      await assert.rejects(seedDiary({ db: t.db, cipher }, "harbour-clinic", { now: NOW }), /not flagged as a demonstration clinic/);
    });

    it("loads a rota and a week across two sites: mixed statuses, blocked time, a waiting list, no double booking", async () => {
      const ctx = { db: t.db, cipher, now: () => NOW };
      await seedDemoClinic(ctx, { tenantId: tid, markDemo: true, now: NOW });
      const summary = await seedDiary(ctx, tid, { now: NOW });
      assert.equal(summary.week, "2026-11-09");
      assert.ok(summary.rotaEntries >= 15, JSON.stringify(summary));
      assert.ok(summary.appointments >= 150 && summary.appointments <= 400, JSON.stringify(summary));
      assert.equal(summary.blocks >= 3, true);
      assert.equal(summary.waitingList, 4);
      const { items, truncated } = await listDiary(ctx, tid, { ...londonRange("2026-11-09", 5), includeCancelled: true, limit: 500 });
      assert.equal(truncated, false);
      assert.equal(new Set(items.map((i) => i.siteId)).size, 2, "two sites");
      const statuses = new Set(items.filter((i) => i.kind === "appointment").map((i) => i.status));
      for (const s of ["attended", "dna", "late_cancelled", "cancelled", "booked", "arrived"]) assert.ok(statuses.has(s as never), s);
      assert.ok(items.filter((i) => i.status === "dna" || i.status === "late_cancelled").every((i) => i.feeDue), "fee flags");
      assert.ok(items.filter((i) => i.startsAt > NOW.toISOString() && i.kind === "appointment").every((i) => ["booked", "cancelled", "late_cancelled"].includes(i.status)), "nothing in the future is attended");
      const occupying = items.filter((i) => i.status !== "cancelled" && i.status !== "late_cancelled");
      for (const i of occupying) assert.deepEqual(findClashes({ ...i, patientId: i.kind === "appointment" ? i.patientId : null }, occupying), [], i.id);
      assert.ok((await listAvailability(ctx, tid, { today: "2026-11-09" })).length >= 15);
      assert.equal((await listWaitingList(ctx, tid)).length, 4);
      assert.ok((await listAudit(ctx, tid, { action: "pms.appointment.bulk_create" })).length <= 12, "one audit row per batch of 40");
    });

    it("a second run adds nothing; a later week is added once", async () => {
      const ctx = { db: t.db, cipher, now: () => NOW };
      const again = await seedDiary(ctx, tid, { now: NOW });
      assert.deepEqual([again.weekExisted, again.appointments, again.rotaEntries, again.waitingList], [true, 0, 0, 0]);
      const later = new Date("2026-11-18T08:00:00.000Z");
      const next = await seedDiary({ ...ctx, now: () => later }, tid, { now: later });
      assert.equal(next.week, "2026-11-16");
      assert.ok(next.appointments > 100 && next.rotaEntries === 0);
      const nextWeek = await listDiary(ctx, tid, { ...londonRange("2026-11-16", 5), includeCancelled: true });
      assert.ok(nextWeek.items.some((i) => i.status === "attended") && nextWeek.items.some((i) => i.status === "booked"));
    });
  });
}
