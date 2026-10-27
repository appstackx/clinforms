/**
 * TESTS ONLY: the diary's repository suite, run unchanged on node:sqlite and PGlite
 * (src/server/repos/pms/diary/diary-repos.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-diary-stack.test.ts – the in-process stand-in and real local D1). With a query log
 * it ends with the tenant-scope guard (every clinic-system statement names tenant_id).
 *
 * Two clinics (A, B). Covers: booking (single, recurring across the clock change, all-or-nothing / skip clashes),
 * no double booking (practitioner, room, patient; enforced by the database too, also for two writers at once),
 * moves with revisions, statuses (attended → last seen + authorisation session, undo gives it back; did not attend
 * and late cancellation with the fee flag; reinstating needs a free slot), blocked time, rotas and free slots, the
 * waiting list, clinic isolation (reads, writes, foreign keys, ciphertext), encryption at rest and audit rows.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createAuthorisation, createCase, getAuthorisation } from "../../cases";
import { createPractitioner, createRoom, createService, createSite } from "../../directory";
import { createPatient, getPatient } from "../../patients";
import type { QueryLog } from "../../testing/guarded-db";
import { unscopedStatements } from "../../testing/guarded-db";
import {
  bookAppointment,
  bulkCreateDiaryItems,
  cancelSeriesFrom,
  countAppointmentsByStatus,
  countPatientAppointmentsByStatus,
  createBlock,
  getAppointment,
  getDiaryItem,
  listDiary,
  listFeesDue,
  listPatientAppointments,
  moveAppointment,
  nextAppointmentsFor,
  rebookAppointment,
  resizeAppointment,
  seriesSitesFrom,
  setAppointmentStatus,
  updateAppointmentDetails,
} from "../appointments";
import { availabilityWindows, createAvailability, endAvailability, listAvailability, updateAvailability } from "../availability";
import { findFreeSlots } from "../slots";
import {
  addToWaitingList,
  answerWaitingListOffer,
  countWaitingList,
  getWaitingListEntry,
  getWaitingListOffer,
  listWaitingList,
  listWaitingListOffers,
  offerWaitingListSlot,
  setWaitingListStatus,
  updateWaitingListEntry,
} from "../waiting-list";
import { londonDayRange } from "../../../../../modules/pms/diary/time";

export interface DiarySuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_reception_01", sessionId: "sess_01" };
const ACTOR_2 = { userId: "user_reception_02", sessionId: "sess_02" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };
/** Monday 26 October 2026 – the day after the clocks go back (GMT: UK time = UTC). */
const MON = "2026-10-26";
const utc = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

interface Clinic {
  site: string;
  site2: string;
  room1: string;
  room2: string;
  roomOther: string;
  sarah: string;
  tom: string;
  fu: string;
  ia: string;
  megan: string;
  daniel: string;
  meganCase: string;
  danielCase: string;
  auth: string;
}

export function defineDiaryRepoSuite(label: string, factory: () => Promise<DiarySuiteDb>): void {
  describe(`diary repositories on ${label}`, () => {
    let suite: DiarySuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-24T09:00:00.000Z");
    const tick = (ms = 1000) => {
      clock += ms;
    };
    let a: Clinic;
    let b: Clinic;

    async function clinic(tenantId: string, actor: typeof ACTOR): Promise<Clinic> {
      const site = (await createSite(ctx, tenantId, { name: "Bletchley (fictional)", code: "BLE" }, actor)).id;
      const site2 = (await createSite(ctx, tenantId, { name: "Wolverton (fictional)", code: "WOL" }, actor)).id;
      const room1 = (await createRoom(ctx, tenantId, { siteId: site, name: "Room 1" }, actor)).id;
      const room2 = (await createRoom(ctx, tenantId, { siteId: site, name: "Room 2" }, actor)).id;
      const roomOther = (await createRoom(ctx, tenantId, { siteId: site2, name: "Room 1" }, actor)).id;
      const sarah = (await createPractitioner(ctx, tenantId, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: site }, actor)).id;
      const tom = (await createPractitioner(ctx, tenantId, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", defaultSiteId: site }, actor)).id;
      const fu = (await createService(ctx, tenantId, { name: "Follow-up", durationMinutes: 30 }, actor)).id;
      const ia = (await createService(ctx, tenantId, { name: "Initial assessment", durationMinutes: 45 }, actor)).id;
      const megan = (await createPatient(ctx, tenantId, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-03-14", importRef: "sim-pat-001" }, actor)).id;
      const daniel = (await createPatient(ctx, tenantId, { firstName: "Daniel", lastName: "Brooks", importRef: "sim-pat-002" }, actor)).id;
      const meganCase = (await createCase(ctx, tenantId, { patientId: megan, title: "Neck (fictional)", openedOn: "2026-10-01", payerType: "insurer" }, actor)).id;
      const danielCase = (await createCase(ctx, tenantId, { patientId: daniel, title: "Back (fictional)", openedOn: "2026-10-01" }, actor)).id;
      const auth = (await createAuthorisation(ctx, tenantId, { caseId: meganCase, code: "NW-AUTH-1", sessionsAuthorised: 2 }, actor)).id;
      return { site, site2, room1, room2, roomOther, sarah, tom, fu, ia, megan, daniel, meganCase, danielCase, auth };
    }

    const book = (c: Clinic, extra: Record<string, unknown> = {}) => ({
      patientId: c.megan,
      serviceId: c.fu,
      practitionerId: c.sarah,
      siteId: c.site,
      roomId: c.room1,
      date: MON,
      startTime: "09:00",
      ...extra,
    });

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      a = await clinic(A, ACTOR);
      b = await clinic(B, ACTOR_B);
    });
    after(async () => {
      await suite?.close();
    });

    it("books an appointment: UK time to UTC, the booking note encrypted at rest, one audit row", async () => {
      const r = await bookAppointment(ctx, A, book(a, { caseId: a.meganCase, authorisationId: a.auth, notes: "Bring the MRI letter (fictional)" }), ACTOR);
      assert.ok(r.ok);
      assert.equal(r.items.length, 1);
      const item = r.items[0];
      assert.match(item.id, /^appt_[0-9A-Z]{26}$/);
      assert.deepEqual([item.startsAt, item.endsAt, item.startsOn, item.status, item.hasNotes], [utc(MON, "09:00"), utc(MON, "09:30"), MON, "booked", true]);
      assert.deepEqual(r.warnings, ["outside_hours"], "no rota yet: booked, with a warning");
      const raw = await suite.db.selectFrom("pms_appointments").select(["notes_enc"]).where("tenant_id", "=", A).where("id", "=", item.id).executeTakeFirstOrThrow();
      assert.ok(raw.notes_enc && !raw.notes_enc.includes("MRI"), "no plaintext at rest");
      assert.equal((await getAppointment(ctx, A, item.id))?.notes, "Bring the MRI letter (fictional)");
      const audit = await listAudit(ctx, A, { action: "pms.appointment.book" });
      assert.equal(audit.length, 1);
      assert.deepEqual(audit[0].detail, { count: 1, source: "staff" });
      assert.equal(JSON.stringify(audit).includes("MRI"), false, "no note text in the audit trail");
    });

    it("no double booking: the practitioner, the room and the patient are each checked; touching times are fine", async () => {
      const clashP = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, roomId: a.room2, startTime: "09:15" }), ACTOR);
      assert.equal(clashP.ok, false);
      assert.deepEqual(!clashP.ok && clashP.clashes.map((c) => c.resource), ["practitioner"]);
      const clashR = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, startTime: "09:20" }), ACTOR);
      assert.deepEqual(!clashR.ok && clashR.clashes.map((c) => c.resource), ["room"]);
      const clashPatient = await bookAppointment(ctx, A, book(a, { practitionerId: a.tom, roomId: a.room2, startTime: "09:00" }), ACTOR);
      assert.deepEqual(!clashPatient.ok && clashPatient.clashes.map((c) => c.resource), ["patient"]);
      const together = await bookAppointment(ctx, A, book(a, { practitionerId: a.tom, roomId: null, startTime: "09:00" }), ACTOR, { allowPatientOverlap: true });
      assert.ok(together.ok, "two practitioners seeing one patient together is allowed when asked for");
      const touching = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, startTime: "09:30" }), ACTOR);
      assert.ok(touching.ok, "09:30 straight after 09:00–09:30");
      assert.equal((await bookAppointment(ctx, B, book(b), ACTOR_B)).ok, true, "another clinic's diary is separate");
    });

    it("the database refuses a double booking even when the repository's check is bypassed", async () => {
      const at = new Date(clock).toISOString();
      const row = (id: string, extra: Record<string, unknown>) => ({
        tenant_id: A,
        id,
        rev: 1,
        kind: "appointment",
        site_id: a.site,
        practitioner_id: a.sarah,
        room_id: null,
        patient_id: a.daniel,
        service_id: a.fu,
        starts_at: utc(MON, "09:10"),
        ends_at: utc(MON, "09:20"),
        starts_on: MON,
        status: "booked",
        created_at: at,
        updated_at: at,
        ...extra,
      });
      await assert.rejects(suite.db.insertInto("pms_appointments").values(row("appt_RAW00000000000000000000001", {})).execute(), /pms_appointments_practitioner_clash/);
      await assert.rejects(
        suite.db.insertInto("pms_appointments").values(row("appt_RAW00000000000000000000002", { kind: "block", practitioner_id: null, room_id: a.room1, patient_id: null, service_id: null })).execute(),
        /pms_appointments_room_clash/,
      );
      // A cancelled row may sit there; making it occupy the slot again is refused.
      await suite.db.insertInto("pms_appointments").values(row("appt_RAW00000000000000000000003", { status: "cancelled" })).execute();
      await assert.rejects(
        suite.db.updateTable("pms_appointments").set({ status: "booked" }).where("tenant_id", "=", A).where("id", "=", "appt_RAW00000000000000000000003").execute(),
        /pms_appointments_practitioner_clash/,
      );
      // The same ids in another clinic do not clash.
      const otherClinic = await bookAppointment(ctx, B, book(b, { startTime: "09:10", durationMinutes: 10, roomId: null, patientId: b.daniel }), ACTOR_B);
      assert.equal(otherClinic.ok, false, "B's own Sarah is busy at 09:00–09:30 in B");
    });

    it("two receptionists booking the same slot at the same moment: exactly one gets it", async () => {
      const results = await Promise.all([
        bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: a.room2, startTime: "11:00" }), ACTOR),
        bookAppointment(ctx, A, book(a, { practitionerId: a.tom, roomId: a.room2, startTime: "11:15" }), ACTOR_2),
      ]);
      assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
      const lost = results.find((r) => !r.ok);
      assert.ok(lost && !lost.ok && lost.clashes.length > 0, "the loser is told what is in the way");
    });

    it("recurring booking: weekly across the clock change stays at 09:00 UK time; all or nothing unless skipClashes", async () => {
      // Tue 20 Oct (BST) … Tue 3 Nov (GMT)
      const blocked = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-10-27", startTime: "14:00" }), ACTOR);
      assert.ok(blocked.ok);
      const all = await bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.tom, roomId: null, date: "2026-10-20", startTime: "14:00", repeat: { intervalWeeks: 1, occurrences: 3 } }), ACTOR);
      assert.equal(all.ok, false);
      assert.deepEqual(!all.ok && all.clashes.map((c) => c.date), ["2026-10-27"]);
      assert.equal((await listPatientAppointments(ctx, A, a.megan)).filter((i) => i.seriesId).length, 0, "nothing booked");
      const some = await bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.tom, roomId: null, date: "2026-10-20", startTime: "14:00", repeat: { intervalWeeks: 1, occurrences: 3 } }), ACTOR, { skipClashes: true });
      assert.ok(some.ok);
      assert.deepEqual(some.skippedDates, ["2026-10-27"]);
      assert.deepEqual(some.items.map((i) => i.startsAt), ["2026-10-20T13:00:00.000Z", "2026-11-03T14:00:00.000Z"], "14:00 BST, then 14:00 GMT");
      assert.ok(some.seriesId && some.items.every((i) => i.seriesId === some.seriesId));
      const audit = (await listAudit(ctx, A, { action: "pms.appointment.book" }))[0];
      assert.deepEqual(audit.detail, { count: 2, seriesId: some.seriesId, skipped: 1, source: "staff" });
      // Cancel the rest of the series from 1 Nov.
      tick();
      assert.deepEqual(await seriesSitesFrom(ctx, A, some.seriesId as string, "2026-11-01"), [a.site]);
      assert.equal(await cancelSeriesFrom(ctx, A, some.seriesId as string, "2026-11-01", ACTOR), 1);
      assert.deepEqual((await listAudit(ctx, A, { action: "pms.appointment.cancel_series" }))[0].detail, { fromDate: "2026-11-01", reason: "patient" });
      assert.equal(await cancelSeriesFrom(ctx, A, some.seriesId as string, "2026-11-01", ACTOR), 0, "nothing left");
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.cancel_series" })).length, 1, "no audit row for a change that changed nothing");
      assert.equal((await listPatientAppointments(ctx, A, a.megan)).find((i) => i.startsOn === "2026-11-03")?.status, "cancelled");
    });

    it("a time that does not exist (the spring clock change) is refused with a plain message", async () => {
      await rejects(bookAppointment(ctx, A, book(a, { date: "2027-03-28", startTime: "01:30" }), ACTOR), /clocks go forward/);
    });

    it("moves keep the revision: a stale screen gets a conflict, a clash is refused, a new site clears the room", async () => {
      const r = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, startTime: "15:00" }), ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      tick();
      const moved = await moveAppointment(ctx, A, id, { expectedRev: 1, date: MON, startTime: "15:30" }, ACTOR);
      assert.ok(moved.ok);
      assert.deepEqual([moved.item.startsAt, moved.item.rev], [utc(MON, "15:30"), 2]);
      const stale = await moveAppointment(ctx, A, id, { expectedRev: 1, date: MON, startTime: "16:00" }, ACTOR_2);
      assert.deepEqual(stale, { ok: false, reason: "conflict", currentRev: 2 });
      const clash = await moveAppointment(ctx, A, id, { expectedRev: 2, date: MON, startTime: "09:15" }, ACTOR);
      assert.equal(clash.ok, false);
      assert.equal(!clash.ok && clash.reason, "clash");
      const otherSite = await moveAppointment(ctx, A, id, { expectedRev: 2, date: MON, startTime: "15:30", siteId: a.site2 }, ACTOR);
      assert.ok(otherSite.ok);
      assert.deepEqual([otherSite.item.siteId, otherSite.item.roomId], [a.site2, null]);
      await rejects(moveAppointment(ctx, A, id, { expectedRev: 3, date: MON, startTime: "15:30", roomId: a.room1 }, ACTOR), /another site/);
      const toTom = await moveAppointment(ctx, A, id, { expectedRev: 3, date: MON, startTime: "15:30", practitionerId: a.tom, roomId: a.roomOther }, ACTOR);
      assert.ok(toTom.ok && toTom.item.practitionerId === a.tom);
      const moves = await listAudit(ctx, A, { action: "pms.appointment.move" });
      assert.deepEqual(moves[0].detail, { fields: ["practitionerId", "roomId"], rev: 4 });
      assert.equal((await moveAppointment(ctx, A, "appt_01J00000000000000000000000", { expectedRev: 1, date: MON, startTime: "10:00" }, ACTOR)).ok, false);
    });

    it("statuses: attended counts an authorisation session and moves last seen; undo gives the session back", async () => {
      const r = await bookAppointment(ctx, A, book(a, { startTime: "10:00", caseId: a.meganCase, authorisationId: a.auth }), ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      tick();
      const arrived = await setAppointmentStatus(ctx, A, id, { expectedRev: 1, status: "arrived" }, ACTOR);
      assert.ok(arrived.ok && arrived.item.status === "arrived");
      const attended = await setAppointmentStatus(ctx, A, id, { expectedRev: 2, status: "attended" }, ACTOR);
      assert.ok(attended.ok && attended.item.authSessionUsed);
      assert.equal((await getAuthorisation(ctx, A, a.auth))?.sessionsUsed, 1);
      assert.equal((await getPatient(ctx, A, a.megan))?.lastSeenOn, MON);
      await rejects(moveAppointment(ctx, A, id, { expectedRev: 3, date: MON, startTime: "10:30" }, ACTOR), /cannot be moved/);
      await rejects(setAppointmentStatus(ctx, A, id, { expectedRev: 3, status: "cancelled" }, ACTOR), /cannot be changed/);
      const undo = await setAppointmentStatus(ctx, A, id, { expectedRev: 3, status: "booked" }, ACTOR);
      assert.ok(undo.ok && !undo.item.authSessionUsed);
      assert.equal((await getAuthorisation(ctx, A, a.auth))?.sessionsUsed, 0, "given back");
      const usage = await listAudit(ctx, A, { action: "pms.authorisation.usage" });
      assert.deepEqual(usage.map((u) => u.detail), [
        { sessions: -1, valuePence: 0, reference: id },
        { sessions: 1, valuePence: 0, reference: id },
      ]);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.status_undo" })).length, 1);
    });

    it("an authorisation that is used up: attended still works, nothing is counted, a warning says so", async () => {
      const ids: string[] = [];
      for (const t of ["12:00", "12:30", "13:00"]) {
        const r = await bookAppointment(ctx, A, book(a, { startTime: t, caseId: a.meganCase, authorisationId: a.auth }), ACTOR);
        assert.ok(r.ok);
        if (t === "13:00") assert.deepEqual(r.warnings.includes("authorisation_short"), true, "3 booked against 2 sessions");
        ids.push(r.items[0].id);
      }
      const done = [];
      for (const id of ids) done.push(await setAppointmentStatus(ctx, A, id, { expectedRev: 1, status: "attended" }, ACTOR));
      assert.deepEqual(
        done.map((d) => d.ok && d.warnings),
        [[], [], ["authorisation_used_up"]],
      );
      assert.equal((await getAuthorisation(ctx, A, a.auth))?.sessionsUsed, 2);
    });

    it("did not attend and late cancellation carry the fee flag; cancelled frees the slot; reinstating needs it free", async () => {
      const r1 = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: a.room1, startTime: "16:00" }), ACTOR);
      const r2 = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: a.room1, startTime: "16:30" }), ACTOR);
      assert.ok(r1.ok && r2.ok);
      const dna = await setAppointmentStatus(ctx, A, r1.items[0].id, { expectedRev: 1, status: "dna", feeDue: true, feePence: 3000 }, ACTOR);
      assert.ok(dna.ok && dna.item.feeDue && dna.item.feePence === 3000);
      const late = await setAppointmentStatus(ctx, A, r2.items[0].id, { expectedRev: 1, status: "late_cancelled", cancelReason: "illness", cancelNote: "Unwell, rang at 08:00 (fictional)" }, ACTOR);
      assert.ok(late.ok && late.item.feeDue && late.item.cancelReason === "illness");
      const full = await getAppointment(ctx, A, r2.items[0].id);
      assert.equal(full?.cancelNote, "Unwell, rang at 08:00 (fictional)");
      assert.equal((await listFeesDue(ctx, A)).map((i) => i.id).sort().join(), [r1.items[0].id, r2.items[0].id].sort().join());
      const audit = await listAudit(ctx, A, { action: "pms.appointment.late_cancel" });
      assert.deepEqual(audit[0].detail, { from: "booked", to: "late_cancelled", rev: 2, feeDue: true, reason: "illness" });
      // The late-cancelled slot is free again …
      const refill = await bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.tom, roomId: a.room1, startTime: "16:30" }), ACTOR);
      assert.ok(refill.ok);
      // … so reinstating the cancelled appointment now clashes.
      const back = await setAppointmentStatus(ctx, A, r2.items[0].id, { expectedRev: 2, status: "booked" }, ACTOR);
      assert.equal(!back.ok && back.reason, "clash");
      const day = londonDayRange(MON);
      const counts = await countAppointmentsByStatus(ctx, A, day);
      assert.ok(counts.dna >= 1 && counts.late_cancelled >= 1 && counts.attended >= 3);
      const shown = await listDiary(ctx, A, { ...day, siteId: a.site });
      assert.equal(shown.items.some((i) => i.status === "late_cancelled"), false, "cancellations are hidden by default");
      assert.equal((await listDiary(ctx, A, { ...day, siteId: a.site, includeCancelled: true })).items.some((i) => i.status === "late_cancelled"), true);
    });

    it("details: the booking note, the case and the authorisation, with the revision", async () => {
      const r = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, startTime: "17:00" }), ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      const saved = await updateAppointmentDetails(ctx, A, id, 1, { notes: "Wheelchair access (fictional)", caseId: a.danielCase, serviceId: a.ia }, ACTOR);
      assert.ok(saved.ok && saved.item.caseId === a.danielCase && saved.item.serviceId === a.ia && saved.item.hasNotes);
      assert.deepEqual(await updateAppointmentDetails(ctx, A, id, 1, { notes: "x" }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      await rejects(updateAppointmentDetails(ctx, A, id, 2, { caseId: a.meganCase }, ACTOR), /not one of this patient's cases/);
      await rejects(updateAppointmentDetails(ctx, A, id, 2, { authorisationId: a.auth }, ACTOR), /does not belong to this case/);
      assert.deepEqual((await listAudit(ctx, A, { action: "pms.appointment.update" }))[0].detail, { fields: ["notes", "caseId", "serviceId"], rev: 2 });
    });

    it("blocked time: refused over appointments, stops bookings, removed and restored by status", async () => {
      await rejects(createBlock(ctx, A, { siteId: a.site, blockKind: "meeting", date: MON, startTime: "08:00", endTime: "09:00" }, ACTOR), /practitioner or a room/);
      const over = await createBlock(ctx, A, { siteId: a.site, practitionerId: a.sarah, blockKind: "meeting", date: MON, startTime: "08:30", endTime: "09:15" }, ACTOR);
      assert.equal(!over.ok && over.reason, "clash");
      const leave = await createBlock(ctx, A, { siteId: a.site, practitionerId: a.sarah, blockKind: "leave", title: "Annual leave", date: "2026-10-30", startTime: "00:00", endTime: "24:00" }, ACTOR);
      assert.ok(leave.ok);
      assert.match(leave.item.id, /^blk_/);
      assert.deepEqual([leave.item.startsAt, leave.item.endsAt], ["2026-10-30T00:00:00.000Z", "2026-10-31T00:00:00.000Z"]);
      const into = await bookAppointment(ctx, A, book(a, { date: "2026-10-30", startTime: "10:00" }), ACTOR);
      assert.deepEqual(!into.ok && into.clashes.map((c) => c.withKind), ["block"]);
      const roomOut = await createBlock(ctx, A, { siteId: a.site, roomId: a.room2, blockKind: "closed", title: "Repairs", date: "2026-10-30", startTime: "09:00", endTime: "12:00" }, ACTOR);
      assert.ok(roomOut.ok);
      const removed = await setAppointmentStatus(ctx, A, leave.item.id, { expectedRev: 1, status: "cancelled" }, ACTOR);
      assert.ok(removed.ok);
      await rejects(setAppointmentStatus(ctx, A, roomOut.item.id, { expectedRev: 1, status: "attended" }, ACTOR), /removed or restored/);
      assert.ok((await bookAppointment(ctx, A, book(a, { date: "2026-10-30", startTime: "10:00" }), ACTOR)).ok, "free once the leave is removed");
      assert.equal((await listAudit(ctx, A, { action: "pms.block.create" })).length, 2);
      assert.equal((await listAudit(ctx, A, { action: "pms.block.remove" })).length, 1);
    });

    it("rotas: overlaps refused, alternate weeks allowed, windows by date, free slots inside them", async () => {
      const mon = await createAvailability(ctx, A, { practitionerId: a.tom, siteId: a.site, roomId: a.room2, weekday: 1, startTime: "09:00", endTime: "12:00", validFrom: "2026-10-05" }, ACTOR);
      assert.match(mon.id, /^avl_/);
      await rejects(createAvailability(ctx, A, { practitionerId: a.tom, siteId: a.site2, weekday: 1, startTime: "11:00", endTime: "13:00", validFrom: "2026-11-02" }, ACTOR), /overlaps/);
      const wed1 = await createAvailability(ctx, A, { practitionerId: a.tom, siteId: a.site, weekday: 3, startTime: "09:00", endTime: "17:00", validFrom: "2026-10-07", everyWeeks: 2 }, ACTOR);
      await createAvailability(ctx, A, { practitionerId: a.tom, siteId: a.site2, weekday: 3, startTime: "09:00", endTime: "17:00", validFrom: "2026-10-14", everyWeeks: 2 }, ACTOR);
      await rejects(createAvailability(ctx, A, { practitionerId: a.tom, siteId: a.site, roomId: a.roomOther, weekday: 2, startTime: "09:00", endTime: "17:00", validFrom: "2026-10-07" }, ACTOR), /another site/);
      const windows = await availabilityWindows(ctx, A, ["2026-10-26", "2026-10-28", "2026-11-04"]);
      assert.deepEqual(
        windows.map((w) => `${w.date} ${w.siteId === a.site ? "BLE" : "WOL"} ${w.startMinute}-${w.endMinute}`),
        ["2026-10-26 BLE 540-720", "2026-10-28 WOL 540-1020", "2026-11-04 BLE 540-1020"],
      );
      const slots = (await findFreeSlots(ctx, A, { fromDate: MON, days: 1, practitionerIds: [a.tom], serviceId: a.fu, stepMinutes: 30 })).map((s) => s.startsAt.slice(11, 16));
      // Tom works at BLE 09:00–12:00 in Room 2: busy 09:00–09:30 (seeing Megan with Sarah) and from 11:00 or 11:15
      // (whichever receptionist won the race).
      for (const t of ["09:30", "10:00", "10:30"]) assert.ok(slots.includes(t), `${t} free: ${slots.join(" ")}`);
      for (const t of ["09:00", "11:00"]) assert.ok(!slots.includes(t), `${t} busy: ${slots.join(" ")}`);
      const saved = await updateAvailability(ctx, A, mon.id, 1, { endTime: "13:00" }, ACTOR);
      assert.ok(saved.ok);
      assert.deepEqual(await updateAvailability(ctx, A, mon.id, 1, { endTime: "14:00" }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      const ended = await endAvailability(ctx, A, wed1.id, 1, "2026-10-21", ACTOR);
      assert.ok(ended.ok);
      assert.equal((await availabilityWindows(ctx, A, ["2026-11-04"])).length, 0, "ended");
      const switchedOff = await endAvailability(ctx, A, mon.id, 2, "2026-10-01", ACTOR);
      assert.ok(switchedOff.ok);
      assert.equal((await listAvailability(ctx, A, { practitionerId: a.tom, includeEnded: true })).some((r) => r.id === mon.id), false, "switched off");
      assert.equal((await listAudit(ctx, A, { action: "pms.availability.create" })).length, 3);
    });

    it("waiting list: priority order, booking from an entry marks it booked in the same write, notes encrypted", async () => {
      const routine = await addToWaitingList(ctx, A, { patientId: a.daniel, priority: "routine", preferredDays: [2, 4], preferredTime: "morning" }, ACTOR);
      tick();
      const urgent = await addToWaitingList(ctx, A, { patientId: a.megan, priority: "urgent", practitionerId: a.sarah, notes: "Wants an earlier slot (fictional)" }, ACTOR);
      assert.match(urgent.id, /^wait_/);
      assert.deepEqual((await listWaitingList(ctx, A)).map((e) => e.id), [urgent.id, routine.id]);
      const raw = await suite.db.selectFrom("pms_waiting_list").select("notes_enc").where("tenant_id", "=", A).where("id", "=", urgent.id).executeTakeFirstOrThrow();
      assert.ok(raw.notes_enc && !raw.notes_enc.includes("earlier"));
      assert.equal((await getWaitingListEntry(ctx, A, urgent.id))?.notes, "Wants an earlier slot (fictional)");
      assert.ok((await updateWaitingListEntry(ctx, A, routine.id, 1, { preferredDays: [1] }, ACTOR)).ok);
      const r = await bookAppointment(ctx, A, book(a, { startTime: "18:00" }), ACTOR, { waitingListId: urgent.id });
      assert.ok(r.ok);
      const entry = await getWaitingListEntry(ctx, A, urgent.id);
      assert.deepEqual([entry?.status, entry?.bookedAppointmentId], ["booked", r.items[0].id]);
      await rejects(setWaitingListStatus(ctx, A, urgent.id, { expectedRev: 2, status: "removed" }, ACTOR), /booked already/);
      const removed = await setWaitingListStatus(ctx, A, routine.id, { expectedRev: 2, status: "removed", reason: "Found another clinic" }, ACTOR);
      assert.ok(removed.ok);
      assert.deepEqual((await listWaitingList(ctx, A)).length, 0);
      assert.equal((await listWaitingList(ctx, A, { status: "removed" })).length, 1);
    });

    it("clinic isolation: another clinic's items are invisible and unchangeable; its records cannot be linked", async () => {
      const mine = await listPatientAppointments(ctx, A, a.megan);
      const id = mine[0].id;
      assert.equal(await getAppointment(ctx, B, id), null);
      assert.deepEqual(await moveAppointment(ctx, B, id, { expectedRev: mine[0].rev, date: MON, startTime: "07:00" }, ACTOR_B), { ok: false, reason: "not_found" });
      assert.deepEqual(await setAppointmentStatus(ctx, B, id, { expectedRev: mine[0].rev, status: "cancelled" }, ACTOR_B), { ok: false, reason: "not_found" });
      assert.equal((await listPatientAppointments(ctx, B, a.megan)).length, 0);
      await rejects(bookAppointment(ctx, A, book(a, { practitionerId: b.sarah, startTime: "19:00" }), ACTOR), /does not exist in this clinic/);
      await rejects(bookAppointment(ctx, A, book(a, { patientId: b.megan, startTime: "19:00" }), ACTOR), /does not exist in this clinic/);
      await rejects(bookAppointment(ctx, A, book(a, { caseId: b.meganCase, startTime: "19:00" }), ACTOR), /not one of this patient's cases/);
      // Straight to the database: the composite foreign keys refuse another clinic's practitioner.
      const at = new Date(clock).toISOString();
      await assert.rejects(
        suite.db
          .insertInto("pms_appointments")
          .values({ tenant_id: A, id: "appt_RAW00000000000000000000009", rev: 1, kind: "appointment", site_id: a.site, practitioner_id: b.tom, patient_id: a.megan, service_id: a.fu, starts_at: utc("2026-11-20", "09:00"), ends_at: utc("2026-11-20", "09:30"), starts_on: "2026-11-20", status: "booked", created_at: at, updated_at: at })
          .execute(),
        /FOREIGN KEY|foreign key/i,
      );
      // A ciphertext copied onto another row (or clinic) does not decrypt there.
      const withNote = (await listPatientAppointments(ctx, A, a.megan)).find((i) => i.hasNotes) ?? (await listPatientAppointments(ctx, A, a.megan))[0];
      const enc = (await suite.db.selectFrom("pms_appointments").select("notes_enc").where("tenant_id", "=", A).where("id", "=", withNote.id).executeTakeFirstOrThrow()).notes_enc;
      const other = (await listPatientAppointments(ctx, A, a.daniel))[0];
      await suite.db.updateTable("pms_appointments").set({ notes_enc: enc }).where("tenant_id", "=", A).where("id", "=", other.id).execute();
      await assert.rejects(getAppointment(ctx, A, other.id));
      await suite.db.updateTable("pms_appointments").set({ notes_enc: null }).where("tenant_id", "=", A).where("id", "=", other.id).execute();
    });

    it("quick search helpers and the patient's list", async () => {
      const next = await nextAppointmentsFor(ctx, A, [a.megan, a.daniel], utc(MON, "00:00"));
      assert.ok(next.get(a.megan) && next.get(a.daniel));
      const list = await listPatientAppointments(ctx, A, a.megan);
      assert.ok(list.length >= 5 && list[0].startsAt >= list[list.length - 1].startsAt, "newest first");
    });

    it("bulk loads: batches of 40 with one audit row each; a clash inside a batch refuses that batch", async () => {
      const items = Array.from({ length: 45 }, (_, i) => ({
        kind: "appointment" as const,
        siteId: a.site2,
        practitionerId: a.sarah,
        roomId: null,
        patientId: a.daniel,
        serviceId: a.fu,
        startsAt: new Date(Date.parse("2026-12-01T09:00:00.000Z") + i * 86_400_000).toISOString(),
        endsAt: new Date(Date.parse("2026-12-01T09:30:00.000Z") + i * 86_400_000).toISOString(),
        status: i % 10 === 0 ? ("cancelled" as const) : ("booked" as const),
        importRef: `old-${i}`,
      }));
      const ids = await bulkCreateDiaryItems(ctx, A, items, ACTOR, { source: "test" });
      assert.equal(ids.length, 45);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.bulk_create" })).length, 2);
      await rejects(
        bulkCreateDiaryItems(ctx, A, [{ ...items[1], importRef: "dup-clash" }], ACTOR),
        /share a practitioner or a room/,
      );
      await rejects(bulkCreateDiaryItems(ctx, A, [{ ...items[0], startsAt: "2026-12-01T09:00:00Z" }], ACTOR), /ISO-8601/);
    });

    it("a change and its audit row are one batch: a stale or refused change leaves no audit row", async () => {
      const r = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-11-16", startTime: "09:00" }), ACTOR);
      assert.ok(r.ok);
      const id = r.items[0].id;
      const moves = async () => (await listAudit(ctx, A, { action: "pms.appointment.move" })).filter((e) => e.targetId === id).length;
      tick();
      assert.ok((await moveAppointment(ctx, A, id, { expectedRev: 1, date: "2026-11-16", startTime: "09:30" }, ACTOR)).ok);
      assert.equal(await moves(), 1);
      assert.equal((await moveAppointment(ctx, A, id, { expectedRev: 1, date: "2026-11-16", startTime: "10:00" }, ACTOR_2)).ok, false, "stale");
      assert.equal(await moves(), 1, "the stale move wrote no audit row");
      const raw = await suite.db.selectFrom("pms_appointments").select(["write_id", "rev"]).where("tenant_id", "=", A).where("id", "=", id).executeTakeFirstOrThrow();
      assert.match(String(raw.write_id), /^w_[0-9A-Z]{26}$/);
      // Status: the same rule.
      assert.ok((await setAppointmentStatus(ctx, A, id, { expectedRev: 2, status: "arrived" }, ACTOR)).ok);
      assert.equal((await setAppointmentStatus(ctx, A, id, { expectedRev: 2, status: "dna" }, ACTOR_2)).ok, false);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.dna" })).filter((e) => e.targetId === id).length, 0);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.arrive" })).filter((e) => e.targetId === id).length, 1);
    });

    it("resize: same start, new end; a clash is refused; history does not change length", async () => {
      const first = await bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.tom, roomId: null, date: "2026-11-16", startTime: "11:00" }), ACTOR);
      const second = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-11-16", startTime: "11:45" }), ACTOR);
      assert.ok(first.ok && second.ok);
      const id = first.items[0].id;
      const longer = await resizeAppointment(ctx, A, id, { expectedRev: 1, durationMinutes: 45 }, ACTOR);
      assert.ok(longer.ok);
      assert.deepEqual([longer.item.startsAt, longer.item.endsAt, longer.item.rev], [utc("2026-11-16", "11:00"), utc("2026-11-16", "11:45"), 2]);
      const tooLong = await resizeAppointment(ctx, A, id, { expectedRev: 2, durationMinutes: 60 }, ACTOR);
      assert.equal(!tooLong.ok && tooLong.reason, "clash");
      assert.deepEqual((await listAudit(ctx, A, { action: "pms.appointment.move" })).find((e) => e.targetId === id)?.detail, { fields: ["endsAt"], rev: 2 });
      assert.ok((await setAppointmentStatus(ctx, A, id, { expectedRev: 2, status: "attended" }, ACTOR)).ok);
      await rejects(resizeAppointment(ctx, A, id, { expectedRev: 3, durationMinutes: 30 }, ACTOR), /cannot be moved/);
    });

    it("rebook: a cancelled or missed appointment gets a new one like it; the old one stays", async () => {
      const r = await bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.sarah, roomId: a.room2, date: "2026-11-17", startTime: "09:00", caseId: a.meganCase, notes: "Old note (fictional)" }), ACTOR);
      assert.ok(r.ok);
      const old = r.items[0].id;
      await rejects(rebookAppointment(ctx, A, old, { date: "2026-11-18", startTime: "09:00" }, ACTOR), /Move a booked appointment/);
      assert.ok((await setAppointmentStatus(ctx, A, old, { expectedRev: 1, status: "dna", feeDue: true }, ACTOR)).ok);
      const again = await rebookAppointment(ctx, A, old, { date: "2026-11-18", startTime: "10:00" }, ACTOR);
      assert.ok(again.ok);
      const fresh = again.items[0];
      assert.deepEqual([fresh.patientId, fresh.serviceId, fresh.practitionerId, fresh.roomId, fresh.caseId, fresh.status, fresh.hasNotes], [a.megan, a.fu, a.sarah, a.room2, a.meganCase, "booked", false]);
      assert.equal((await getDiaryItem(ctx, A, old))?.status, "dna", "the missed one stays (fee flag for billing)");
      const audit = (await listAudit(ctx, A, { action: "pms.appointment.book" })).find((e) => e.targetId === fresh.id);
      assert.equal(audit?.detail?.rebookOf, old);
      const elsewhere = await rebookAppointment(ctx, A, old, { date: "2026-11-19", startTime: "10:00", siteId: a.site2 }, ACTOR);
      assert.ok(elsewhere.ok && elsewhere.items[0].siteId === a.site2 && elsewhere.items[0].roomId === null, "another site: no room");
      await rejects(rebookAppointment(ctx, B, old, { date: "2026-11-19", startTime: "11:00" }, ACTOR_B), /no longer exists/);
    });

    it("waiting list: an entry booked or removed meanwhile books nothing at all", async () => {
      const entry = await addToWaitingList(ctx, A, { patientId: a.daniel, serviceId: a.fu }, ACTOR);
      const taken = await bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-11-20", startTime: "09:00" }), ACTOR, { waitingListId: entry.id });
      assert.ok(taken.ok);
      const before = (await listPatientAppointments(ctx, A, a.daniel)).length;
      await rejects(
        bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-11-20", startTime: "10:00", repeat: { intervalWeeks: 1, occurrences: 2 } }), ACTOR, { waitingListId: entry.id }),
        /booked or removed already/,
      );
      assert.equal((await listPatientAppointments(ctx, A, a.daniel)).length, before, "nothing booked");
      await rejects(bookAppointment(ctx, A, book(a, { patientId: a.megan, practitionerId: a.tom, roomId: null, date: "2026-11-20", startTime: "11:00" }), ACTOR, { waitingListId: entry.id }), /not this patient's/);
      // Two receptionists booking one entry at the same moment (different free times, so only the entry is in
      // the way): both pass the pre-check, exactly one batch writes anything.
      const second = await addToWaitingList(ctx, A, { patientId: a.daniel, serviceId: a.fu }, ACTOR);
      const race = await Promise.allSettled([
        bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.tom, roomId: null, date: "2026-11-20", startTime: "12:00" }), ACTOR, { waitingListId: second.id }),
        bookAppointment(ctx, A, book(a, { patientId: a.daniel, practitionerId: a.sarah, roomId: null, date: "2026-11-20", startTime: "14:00" }), ACTOR_2, { waitingListId: second.id }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
      const lost = race.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(lost.reason instanceof RepoInputError && /booked or removed already/.test(lost.reason.message));
      assert.equal((await listPatientAppointments(ctx, A, a.daniel)).length, before + 1, "one booking, not two");
      const settled = await getWaitingListEntry(ctx, A, second.id);
      const won = (race.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof bookAppointment>>>).value;
      assert.ok(won.ok && settled?.bookedAppointmentId === won.items[0].id);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.book" })).filter((e) => e.detail?.waitingListId === second.id).length, 1, "one audit row");
    });

    it("offers: offer a slot (entry offered), decline (back to waiting), offer again and book it in one write", async () => {
      const entry = await addToWaitingList(ctx, A, { patientId: a.megan, serviceId: a.fu, siteId: a.site, notes: "Any cancellation (fictional)" }, ACTOR);
      const first = await offerWaitingListSlot(ctx, A, entry.id, { expectedRev: 1, siteId: a.site, practitionerId: a.sarah, roomId: a.room1, date: "2026-11-23", startTime: "09:00" }, ACTOR);
      assert.ok(first.ok);
      assert.match(first.offer.id, /^woff_/);
      assert.deepEqual([first.offer.status, first.offer.startsAt, first.offer.endsAt, first.entryRev], ["open", utc("2026-11-23", "09:00"), utc("2026-11-23", "09:30"), 2]);
      assert.equal((await getWaitingListEntry(ctx, A, entry.id))?.status, "offered");
      const stale = await offerWaitingListSlot(ctx, A, entry.id, { expectedRev: 1, siteId: a.site, practitionerId: a.sarah, date: "2026-11-23", startTime: "10:00" }, ACTOR);
      assert.deepEqual(stale, { ok: false, reason: "conflict", currentRev: 2 });
      assert.equal((await listWaitingListOffers(ctx, A, entry.id)).length, 1, "a stale offer writes nothing");
      const declined = await answerWaitingListOffer(ctx, A, first.offer.id, { expectedRev: 2, status: "declined" }, ACTOR);
      assert.ok(declined.ok);
      assert.equal((await getWaitingListEntry(ctx, A, entry.id))?.status, "waiting");
      assert.equal((await getWaitingListOffer(ctx, A, first.offer.id))?.status, "declined");
      await rejects(answerWaitingListOffer(ctx, A, first.offer.id, { expectedRev: 3, status: "withdrawn" }, ACTOR), /answered already/);
      const second = await offerWaitingListSlot(ctx, A, entry.id, { expectedRev: 3, siteId: a.site, practitionerId: a.sarah, roomId: a.room1, date: "2026-11-23", startTime: "10:00" }, ACTOR);
      assert.ok(second.ok);
      const booked = await bookAppointment(ctx, A, book(a, { date: "2026-11-23", startTime: "10:00" }), ACTOR, { waitingListId: entry.id, offerId: second.offer.id });
      assert.ok(booked.ok);
      const after = await getWaitingListEntry(ctx, A, entry.id);
      assert.deepEqual([after?.status, after?.bookedAppointmentId], ["booked", booked.items[0].id]);
      assert.deepEqual([(await getWaitingListOffer(ctx, A, second.offer.id))?.status, (await getWaitingListOffer(ctx, A, second.offer.id))?.appointmentId], ["accepted", booked.items[0].id]);
      assert.deepEqual(
        (await listAudit(ctx, A, { action: "pms.waiting_list.offer" })).map((e) => e.detail?.offerId).sort(),
        [first.offer.id, second.offer.id].sort(),
      );
      assert.equal((await listAudit(ctx, A, { action: "pms.waiting_list.offer_decline" })).length, 1);
      // Removing an entry withdraws its open offers in the same batch.
      const other = await addToWaitingList(ctx, A, { patientId: a.daniel, serviceId: a.fu }, ACTOR);
      const o = await offerWaitingListSlot(ctx, A, other.id, { expectedRev: 1, siteId: a.site, practitionerId: a.tom, date: "2026-11-24", startTime: "09:00" }, ACTOR);
      assert.ok(o.ok);
      assert.ok((await setWaitingListStatus(ctx, A, other.id, { expectedRev: 2, status: "removed", reason: "No longer needed" }, ACTOR)).ok);
      assert.equal((await getWaitingListOffer(ctx, A, o.offer.id))?.status, "withdrawn");
      // Clinic isolation.
      assert.equal(await getWaitingListOffer(ctx, B, o.offer.id), null);
      assert.deepEqual(await answerWaitingListOffer(ctx, B, o.offer.id, { expectedRev: 3, status: "withdrawn" }, ACTOR_B), { ok: false, reason: "not_found" });
      assert.equal(await countWaitingList(ctx, A, { siteIds: [a.site2] }) >= 0, true);
    });

    it("site filters: the diary, a patient's list, next appointments, counts and the waiting list by site", async () => {
      const day = londonDayRange("2026-11-19");
      const atSite2 = await listDiary(ctx, A, { ...day, siteIds: [a.site2] });
      assert.ok(atSite2.items.length >= 1 && atSite2.items.every((i) => i.siteId === a.site2));
      assert.equal((await listDiary(ctx, A, { ...day, siteIds: [] })).items.length, 0);
      const megan = await listPatientAppointments(ctx, A, a.megan, { siteIds: [a.site2] });
      assert.ok(megan.length >= 1 && megan.every((i) => i.siteId === a.site2));
      const page = await listPatientAppointments(ctx, A, a.megan, { limit: 2 });
      const older = await listPatientAppointments(ctx, A, a.megan, { limit: 2, before: page[1].startsAt });
      assert.ok(older.every((i) => i.startsAt < page[1].startsAt));
      const next = await nextAppointmentsFor(ctx, A, [a.megan], utc("2026-11-19", "00:00"), { siteIds: [a.site2] });
      assert.equal(next.get(a.megan)?.siteId, a.site2);
      const counts = await countPatientAppointmentsByStatus(ctx, A, a.megan);
      assert.ok(counts.booked >= 1 && counts.dna >= 1);
      assert.deepEqual(await countPatientAppointmentsByStatus(ctx, A, a.megan, { siteIds: [] }), { booked: 0, arrived: 0, attended: 0, dna: 0, late_cancelled: 0, cancelled: 0 });
      const forSite2 = await addToWaitingList(ctx, A, { patientId: a.megan, siteId: a.site2 }, ACTOR);
      const scoped = await listWaitingList(ctx, A, { siteIds: [a.site] });
      assert.equal(scoped.some((e) => e.id === forSite2.id), false, "an entry for another site is not shown");
      assert.ok((await listWaitingList(ctx, A, { siteIds: [a.site2] })).some((e) => e.id === forSite2.id));
    });

    it("free slots that suit a waiting patient: preferred days, time of day and dates", async () => {
      await createAvailability(ctx, A, { practitionerId: a.sarah, siteId: a.site2, weekday: 2, startTime: "09:00", endTime: "17:00", validFrom: "2026-11-24", validTo: "2026-12-31" }, ACTOR);
      const prefs = { preferredDays: [2], preferredTime: "afternoon" as const, earliestOn: "2026-12-01", latestOn: null };
      const slots = await findFreeSlots(ctx, A, { fromDate: "2026-11-24", days: 14, practitionerIds: [a.sarah], serviceId: a.fu, stepMinutes: 60, notBefore: utc("2026-11-01", "00:00"), preferences: prefs, limit: 50 });
      assert.ok(slots.length > 0);
      assert.ok(slots.every((s) => s.date === "2026-12-01" && s.startMinute >= 720 && s.startMinute < 1020), slots.map((s) => `${s.date} ${s.startMinute}`).join(" "));
      assert.equal((await findFreeSlots(ctx, A, { fromDate: "2026-11-24", days: 14, practitionerIds: [a.sarah], serviceId: a.fu, siteIds: [a.site], notBefore: utc("2026-11-01", "00:00") })).length, 0, "no rota at the allowed site");
    });

    it("every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
