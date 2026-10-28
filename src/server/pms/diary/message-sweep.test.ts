/**
 * The message run's diary sweep (M9b, handover §19): a diary write whose message sync failed is healed by the next
 * run – reminders, the confirmation it asked for, its cancellation notice – and a re-sync never cancels a notice
 * that is still true. On node:sqlite and PGlite, with the tenant-scope guard. Run by `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../db/testing/databases";
import type { RepoContext } from "../../repos/context";
import { bookAppointment, setAppointmentStatus } from "../../repos/pms/diary/appointments";
import { listScheduleForAppointment, syncAppointmentMessages } from "../../repos/pms/comms/schedule";
import { createPractitioner, createService, createSite } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { SWEEP_LOOK_BACK_MS, reconcileDiaryMessages } from "./message-sync";

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_reception_01", sessionId: "sess_01" };

function suite(label: string, factory: () => GuardedDb | Promise<GuardedDb>) {
  describe(`diary → messages sweep on ${label}`, () => {
    let g: GuardedDb;
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
      const megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", mobile: "07700 900123", email: "megan.hart@example.com", importRef: "sim-pat-001" }, ACTOR)).id;
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

    it("the sweep only looks back from where it got to (at most a day) and never at another clinic", async () => {
      clock += 60_000;
      const quiet = await reconcileDiaryMessages(ctx, A);
      assert.equal(quiet?.checked, 0, "nothing changed since the last sweep");
      clock += SWEEP_LOOK_BACK_MS * 3;
      assert.equal((await reconcileDiaryMessages(ctx, B))?.checked, 0);
      assert.deepEqual(unscopedStatements(g.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
