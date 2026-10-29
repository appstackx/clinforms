/**
 * TESTS ONLY: the message run's diary sweep (M9b, handover §19): a diary write whose message sync failed is healed
 * by the next run – reminders, the confirmation it asked for, its cancellation notice – and a re-sync never cancels
 * a notice that is still true; at scale (M10) the sweep reads in groups and writes in batches. Run on node:sqlite
 * and PGlite (../message-sweep.test.ts) and on D1 through the gateway (workers/data-gateway/test/
 * pms-diary-stack.test.ts – the in-process stand-in and real local D1). With a query log it ends with the
 * tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import type { RepoContext } from "../../../repos/context";
import { bookAppointment, bulkCreateDiaryItems, setAppointmentStatus } from "../../../repos/pms/diary/appointments";
import { listScheduleForAppointment, syncAppointmentMessages } from "../../../repos/pms/comms/schedule";
import { createReminderRule } from "../../../repos/pms/comms/rules";
import { createPractitioner, createService, createSite } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { unscopedStatements, type QueryLog } from "../../../repos/pms/testing/guarded-db";
import { SWEEP_LOOK_BACK_MS, reconcileDiaryMessages } from "../message-sync";

export interface MessageSweepSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_reception_01", sessionId: "sess_01" };

export function defineMessageSweepSuite(label: string, factory: () => Promise<MessageSweepSuiteDb>): void {
  describe(`diary → messages sweep on ${label}`, () => {
    let g: MessageSweepSuiteDb;
    let ctx: RepoContext;
    // Tue 27/10/2026 10:00 UTC (= UK time) – outside quiet hours.
    let clock = Date.parse("2026-10-27T10:00:00.000Z");
    let ids: { site: string; sarah: string; fu: string; megan: string };

    before(async () => {
      g = await factory();
      ctx = { db: g.db, cipher: testCipher(), now: () => new Date(clock) };
      const site = (await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE" }, ACTOR)).id;
      const sarah = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: site }, ACTOR)).id;
      const fu = (await createService(ctx, A, { name: "Follow-up", durationMinutes: 30 }, ACTOR)).id;
      const megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", phoneMobile: "07700 900123", email: "megan.hart@example.com", importRef: "sim-pat-001" }, ACTOR)).id;
      ids = { site, sarah, fu, megan };
    });
    after(async () => {
      await g?.close();
    });

    const kinds = async (appointmentId: string, status = "pending") =>
      (await listScheduleForAppointment(ctx, A, appointmentId))
        .filter((m) => m.status === status)
        .map((m) => `${m.kind}:${m.channel}`)
        .sort();

    it("a booking whose sync failed gets its confirmation at the next run; a second run changes nothing", async () => {
      // bookAppointment alone = the diary's write without the message sync (as when the sync fails).
      const r = await bookAppointment(ctx, A, { patientId: ids.megan, serviceId: ids.fu, practitionerId: ids.sarah, siteId: ids.site, date: "2026-11-03", startTime: "09:00", sendConfirmation: true }, ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      assert.deepEqual(await kinds(id), [], "nothing planned: the sync never ran");
      clock += 60_000;
      const first = await reconcileDiaryMessages(ctx, A);
      assert.ok(first && first.checked >= 1 && first.fixed === 1);
      assert.deepEqual(await kinds(id), ["confirmation:email", "confirmation:sms"], "the confirmation it asked for");
      clock += 60_000;
      const again = await reconcileDiaryMessages(ctx, A);
      assert.equal(again?.fixed, 0, "in step: nothing to do");
      assert.deepEqual(await kinds(id), ["confirmation:email", "confirmation:sms"], "the pending confirmation is NOT cancelled by a re-sync");
      // A later sync that does not ask for the confirmation again (a details change) keeps it while it is true.
      await syncAppointmentMessages(ctx, A, { id, patientId: ids.megan, startsAt: r.items[0].startsAt, endsAt: r.items[0].endsAt, siteId: ids.site, practitionerId: ids.sarah, serviceId: ids.fu, active: true }, ACTOR, { notify: "none" });
      assert.deepEqual(await kinds(id), ["confirmation:email", "confirmation:sms"]);
    });

    it("a cancellation whose sync failed: the pending confirmation is cancelled and the cancellation notice planned", async () => {
      const r = await bookAppointment(ctx, A, { patientId: ids.megan, serviceId: ids.fu, practitionerId: ids.sarah, siteId: ids.site, date: "2026-11-04", startTime: "09:00", sendConfirmation: true }, ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      clock += 60_000;
      await reconcileDiaryMessages(ctx, A);
      assert.deepEqual(await kinds(id), ["confirmation:email", "confirmation:sms"]);
      clock += 60_000;
      assert.ok((await setAppointmentStatus(ctx, A, id, { expectedRev: 1, status: "cancelled", cancelReason: "patient" }, ACTOR)).ok);
      clock += 60_000;
      const swept = await reconcileDiaryMessages(ctx, A);
      assert.ok(swept && swept.fixed >= 1);
      assert.deepEqual(await kinds(id), ["cancelled:email", "cancelled:sms"], "notice planned, confirmations gone");
      assert.deepEqual(await kinds(id, "cancelled"), ["confirmation:email", "confirmation:sms"]);
      clock += 60_000;
      await reconcileDiaryMessages(ctx, A);
      assert.deepEqual(await kinds(id), ["cancelled:email", "cancelled:sms"], "a re-sync keeps the cancellation notice");
    });

    it("M10 scale: the sweep checks 150 changed appointments in a handful of statements and writes only those out of step, in batches", async () => {
      const C = "scale-sweep";
      const site = (await createSite(ctx, C, { name: "Scale Road (fictional)", code: "SCA" }, ACTOR)).id;
      const prac = (await createPractitioner(ctx, C, { displayName: "Scale Physio", registrationNumber: "PH-DEMO-08", defaultSiteId: site }, ACTOR)).id;
      const fu = (await createService(ctx, C, { name: "Follow-up", durationMinutes: 30 }, ACTOR)).id;
      const patient = (await createPatient(ctx, C, { firstName: "Ivy", lastName: "Marston", phoneMobile: "07700 900456" }, ACTOR)).id;
      await createReminderRule(ctx, C, { name: "Text the day before", channel: "sms", timing: "days_before", daysBefore: 1, sendAt: "10:00" }, ACTOR);
      // 150 bookings written without their message sync (as when every sync failed).
      const items = Array.from({ length: 150 }, (_, i) => {
        const startsAt = new Date(Date.parse("2026-11-10T00:00:00.000Z") + i * 30 * 60_000).toISOString();
        return { kind: "appointment" as const, siteId: site, practitionerId: prac, patientId: patient, serviceId: fu, startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(), status: "booked" as const };
      });
      const ids150 = await bulkCreateDiaryItems(ctx, C, items, ACTOR, { source: "test" });
      clock += 60_000;
      let statements = 0;
      const counting: RepoContext = {
        ...ctx,
        db: ctx.db.withPlugin({
          transformQuery: (args) => {
            statements++;
            return args.node;
          },
          transformResult: async (args) => args.result,
        }),
      };
      const healed = await reconcileDiaryMessages(counting, C);
      assert.deepEqual([healed?.checked, healed?.fixed], [150, 150]);
      assert.deepEqual(await listScheduleForAppointment(ctx, C, ids150[149]).then((m) => m.map((x) => `${x.kind}:${x.status}`)), ["reminder:pending"]);
      assert.ok(statements <= 360, `writes packed with reads once (${statements} statements; one appointment at a time was over 750)`);
      // All 150 changed again but already in step: read, compared in memory, nothing written.
      clock += 60_000;
      await ctx.db.updateTable("pms_appointments").set({ updated_at: new Date(clock).toISOString() }).where("tenant_id", "=", C).execute();
      clock += 60_000;
      statements = 0;
      const quiet = await reconcileDiaryMessages(counting, C);
      assert.deepEqual([quiet?.checked, quiet?.fixed], [150, 0]);
      assert.ok(statements <= 12, `in step: a handful of statements (${statements}; it was over 450)`);
    });

    it("the sweep only looks back from where it got to (at most a day) and never at another clinic", async () => {
      clock += 60_000;
      const quiet = await reconcileDiaryMessages(ctx, A);
      assert.equal(quiet?.checked, 0, "nothing changed since the last sweep");
      clock += SWEEP_LOOK_BACK_MS * 3;
      assert.equal((await reconcileDiaryMessages(ctx, B))?.checked, 0);
      if (g.log) assert.deepEqual(unscopedStatements(g.log.statements), []);
    });
  });
}

