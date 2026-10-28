/**
 * TESTS ONLY: the diary's server layer (src/server/pms/diary – what the server actions and route handlers call),
 * run unchanged on node:sqlite and PGlite (../service.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-diary-stack.test.ts). With a query log it ends with the tenant-scope guard.
 *
 * Covers: each role's permissions (reception books but cannot change rotas; a role without diary.view sees
 * nothing), the SITE SCOPE on every read and write (a member limited to site A never sees or changes anything of
 * site B), input validation with field errors, safe errors (nothing of an internal error reaches the answer), the
 * day and week views (practitioner and room columns, rota shading, blocked time, free slots), cancel with the
 * late-cancellation fee by the clock, rebook, resize, the day sheet (no notes), the patient's Appointments tab,
 * rotas, the waiting list with offers, and clinic isolation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import {
  pmsCan,
  type PmsPermission,
  type PmsRole,
} from "../../../../modules/pms/core/permissions";
import type { DiaryActionResult } from "../../../../modules/pms/diary/types";
import { parseDiaryParams } from "../../../../modules/pms/diary/view";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { createCase } from "../../../repos/pms/cases";
import { createAvailability } from "../../../repos/pms/diary/availability";
import {
  createPractitioner,
  createRoom,
  createService,
  createSite,
} from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import type { QueryLog } from "../../../repos/pms/testing/guarded-db";
import { unscopedStatements } from "../../../repos/pms/testing/guarded-db";
import type { DiaryCaller } from "../caller";
import { loadAppointmentDetails } from "../details";
import {
  loadBookingOptions,
  loadDaySheet,
  loadFreeSlots,
  loadPatientAppointments,
  loadRotas,
  loadWaitingList,
  loadWaitingListEntry,
  searchDiaryPatients,
} from "../reads";
import { loadDiaryView } from "../view";
import {
  addToWaitingListFor,
  answerWaitingListOfferFor,
  bookAppointmentFor,
  bookWaitingListOfferFor,
  cancelAppointmentFor,
  cancelSeriesFor,
  createBlockFor,
  createRotaEntryFor,
  endRotaEntryFor,
  moveAppointmentFor,
  offerWaitingListSlotFor,
  rebookAppointmentFor,
  resizeAppointmentFor,
  setAppointmentStatusFor,
  setWaitingListStatusFor,
  updateAppointmentDetailsFor,
  updateRotaEntryFor,
  updateWaitingListEntryFor,
  setDaySheetDobFor,
  startTreatmentFor,
} from "../writes";
import { checkBookingFor } from "../booking-check";

export interface DiaryServiceSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-svc";
const B = "harbour-svc";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
/** Monday 9 November 2026, 08:00 UK (GMT). */
const NOW = Date.parse("2026-11-09T08:00:00.000Z");
const MON = "2026-11-09";
const utc = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

interface Clinic {
  siteA: string;
  siteB: string;
  roomA1: string;
  roomA2: string;
  roomB1: string;
  sarah: string;
  tom: string;
  fu: string;
  megan: string;
  daniel: string;
  meganCase: string;
}

function ok(
  r: DiaryActionResult,
): asserts r is Extract<DiaryActionResult, { ok: true }> {
  assert.equal(
    r.ok,
    true,
    r.ok
      ? ""
      : `${r.error} ${JSON.stringify(r.fieldErrors ?? r.clashes ?? {})}`,
  );
}

function refused(r: DiaryActionResult, pattern: RegExp): void {
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", pattern);
}

export function defineDiaryServiceSuite(
  label: string,
  factory: () => Promise<DiaryServiceSuiteDb>,
): void {
  describe(`diary server layer on ${label}`, () => {
    let suite: DiaryServiceSuiteDb;
    let ctx: RepoContext;
    let clock = NOW;
    let a: Clinic;
    let b: Clinic;

    const caller = (
      tenantId: string,
      role: PmsRole | PmsPermission[],
      siteIds: string[] | null = null,
      userId = "user_reception_01",
    ): DiaryCaller => ({
      tenantId,
      actor: { userId, sessionId: `sess_${userId}` },
      can: (p) => (Array.isArray(role) ? role.includes(p) : pmsCan(role, p)),
      ctx,
      siteIds: siteIds === null ? null : new Set(siteIds),
    });
    const staff = (siteIds: string[] | null = null) =>
      caller(A, "staff", siteIds);

    async function clinic(tenantId: string): Promise<Clinic> {
      const siteA = (
        await createSite(
          ctx,
          tenantId,
          { name: "Bletchley (fictional)", code: "BLE" },
          SEED,
        )
      ).id;
      const siteB = (
        await createSite(
          ctx,
          tenantId,
          { name: "Wolverton (fictional)", code: "WOL" },
          SEED,
        )
      ).id;
      const roomA1 = (
        await createRoom(ctx, tenantId, { siteId: siteA, name: "Room 1" }, SEED)
      ).id;
      const roomA2 = (
        await createRoom(ctx, tenantId, { siteId: siteA, name: "Room 2" }, SEED)
      ).id;
      const roomB1 = (
        await createRoom(ctx, tenantId, { siteId: siteB, name: "Room 1" }, SEED)
      ).id;
      const sarah = (
        await createPractitioner(
          ctx,
          tenantId,
          {
            displayName: "Sarah Reid",
            registrationNumber: "PH-DEMO-01",
            defaultSiteId: siteA,
          },
          SEED,
        )
      ).id;
      const tom = (
        await createPractitioner(
          ctx,
          tenantId,
          {
            displayName: "Tom Ellis",
            registrationNumber: "PH-DEMO-02",
            defaultSiteId: siteB,
          },
          SEED,
        )
      ).id;
      const fu = (
        await createService(
          ctx,
          tenantId,
          { name: "Follow-up", durationMinutes: 30 },
          SEED,
        )
      ).id;
      const megan = (
        await createPatient(
          ctx,
          tenantId,
          {
            firstName: "Megan",
            lastName: "Hart",
            dateOfBirth: "1991-03-14",
            importRef: "sim-pat-001",
          },
          SEED,
        )
      ).id;
      const daniel = (
        await createPatient(
          ctx,
          tenantId,
          { firstName: "Daniel", lastName: "Brooks", importRef: "sim-pat-002" },
          SEED,
        )
      ).id;
      const meganCase = (
        await createCase(
          ctx,
          tenantId,
          {
            patientId: megan,
            title: "Neck (fictional)",
            openedOn: "2026-10-01",
          },
          SEED,
        )
      ).id;
      // Rotas: Sarah at A on Mondays 09:00–12:00 in Room 1; Tom at B on Mondays 13:00–17:00 in Room 1.
      await createAvailability(
        ctx,
        tenantId,
        {
          practitionerId: sarah,
          siteId: siteA,
          roomId: roomA1,
          weekday: 1,
          startTime: "09:00",
          endTime: "12:00",
          validFrom: "2026-11-02",
        },
        SEED,
      );
      await createAvailability(
        ctx,
        tenantId,
        {
          practitionerId: tom,
          siteId: siteB,
          roomId: roomB1,
          weekday: 1,
          startTime: "13:00",
          endTime: "17:00",
          validFrom: "2026-11-02",
        },
        SEED,
      );
      return {
        siteA,
        siteB,
        roomA1,
        roomA2,
        roomB1,
        sarah,
        tom,
        fu,
        megan,
        daniel,
        meganCase,
      };
    }

    const booking = (c: Clinic, extra: Record<string, unknown> = {}) => ({
      patientId: c.megan,
      serviceId: c.fu,
      practitionerId: c.sarah,
      siteId: c.siteA,
      roomId: c.roomA1,
      date: MON,
      startTime: "10:00",
      ...extra,
    });

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      a = await clinic(A);
      b = await clinic(B);
    });
    after(async () => {
      await suite?.close();
    });

    it("permissions: a role without diary.book cannot write; only diary.rota changes rotas and the waiting list", async () => {
      const viewer = caller(A, ["clinic.view", "diary.view", "patients.view"]);
      refused(await bookAppointmentFor(viewer, booking(a)), /permission/);
      refused(
        await createBlockFor(viewer, {
          siteId: a.siteA,
          practitionerId: a.sarah,
          blockKind: "meeting",
          date: MON,
          startTime: "13:00",
          endTime: "14:00",
        }),
        /permission/,
      );
      refused(
        await addToWaitingListFor(viewer, { patientId: a.megan }),
        /permission/,
      );
      // Roles design round 2: rotas and the waiting list are "diary.rota" – owner, admin and reception by default,
      // not clinicians.
      refused(
        await createRotaEntryFor(caller(A, "clinician"), {
          practitionerId: a.sarah,
          siteId: a.siteA,
          weekday: 3,
          startTime: "09:00",
          endTime: "12:00",
          validFrom: "2026-11-02",
        }),
        /permission/,
      );
      refused(await addToWaitingListFor(caller(A, "clinician"), { patientId: a.megan }), /permission/);
      assert.equal(caller(A, "staff").can("diary.rota"), true, "reception edits rotas and the waiting list");
      assert.equal(caller(A, "staff").can("diary.manage"), true, "the old id is an alias of diary.rota");
      const nobody = caller(A, ["clinic.view"]);
      const view = await loadDiaryView(
        nobody,
        parseDiaryParams({ date: MON }, MON),
        MON,
      );
      assert.deepEqual(view.ok ? null : view.status, 403);
      assert.equal((await loadPatientAppointments(nobody, a.megan)).ok, false);
      assert.equal(
        (await loadDaySheet(nobody, { siteId: a.siteA, date: MON })).ok,
        false,
      );
      assert.equal((await searchDiaryPatients(nobody, "Hart")).ok, false);
      assert.equal(
        (await loadBookingOptions(viewer, a.megan)).ok,
        false,
        "booking options need diary.book",
      );
      assert.equal(
        (await listAudit(ctx, A, { action: "pms.appointment.book" })).length,
        0,
        "nothing was written",
      );
    });

    it("input is validated: field errors, bad ids answered as gone, nothing written", async () => {
      const bad = await bookAppointmentFor(staff(), {
        ...booking(a),
        startTime: "25:00",
        date: "09/11/2026",
      });
      assert.equal(bad.ok, false);
      assert.ok(
        !bad.ok &&
          bad.fieldErrors &&
          "startTime" in bad.fieldErrors &&
          "date" in bad.fieldErrors,
      );
      refused(
        await moveAppointmentFor(staff(), {
          id: "not an id",
          expectedRev: 1,
          date: MON,
          startTime: "09:00",
        }),
        /no longer exists/,
      );
      refused(await moveAppointmentFor(staff(), null), /no longer exists/);
      const noRev = await setAppointmentStatusFor(staff(), {
        id: "appt_01J00000000000000000000000",
        status: "arrived",
      });
      assert.ok(
        !noRev.ok && noRev.fieldErrors && "expectedRev" in noRev.fieldErrors,
      );
      refused(
        await bookAppointmentFor(staff(), {
          ...booking(a),
          waitingListId: "<script>",
        }),
        /highlighted/,
      );
      refused(
        await cancelSeriesFor(staff(), {
          seriesId: "rec_01J00000000000000000000000",
          fromDate: "tomorrow",
        }),
        /highlighted/,
      );
    });

    it("book → day view by practitioner: the card, rota shading and free slots around it; by room; the week", async () => {
      const r = await bookAppointmentFor(
        staff(),
        booking(a, { notes: "Parking at the back (fictional)" }),
      );
      ok(r);
      assert.match(String(r.itemId), /^appt_/);
      assert.equal(r.rev, 1);
      const view = await loadDiaryView(
        staff(),
        parseDiaryParams({ date: MON, site: a.siteA }, MON),
        MON,
      );
      assert.ok(view.ok);
      const v = view.data;
      assert.equal(v.site?.id, a.siteA);
      const sarahCol = v.columns.find((c) => c.practitionerId === a.sarah);
      assert.ok(sarahCol);
      assert.deepEqual(sarahCol.windows, [
        { startMinute: 540, endMinute: 720, siteId: a.siteA },
      ]);
      assert.deepEqual(
        sarahCol.freeSlots.map((s) => s.startMinute),
        [540, 570, 630, 660, 690],
        "09:00, 09:30, 10:30, 11:00, 11:30 – not 10:00",
      );
      const card = v.cards.find((c) => c.id === r.itemId);
      assert.deepEqual(
        [card?.columnKey, card?.patientName, card?.timeLabel, card?.hasNotes],
        [`p:${a.sarah}`, "Megan Hart", "10:00–10:30", true],
      );
      assert.equal(
        JSON.stringify(v).includes("Parking"),
        false,
        "the grid never carries the note text",
      );
      assert.equal(
        JSON.stringify(v).includes("1991"),
        false,
        "nor a date of birth",
      );
      const byRoom = await loadDiaryView(
        staff(),
        parseDiaryParams({ date: MON, site: a.siteA, by: "room" }, MON),
        MON,
      );
      assert.ok(byRoom.ok);
      assert.deepEqual(
        byRoom.data.columns.map((c) => c.label),
        ["Room 1", "Room 2"],
      );
      assert.equal(
        byRoom.data.cards.find((c) => c.id === r.itemId)?.columnKey,
        `r:${a.roomA1}`,
      );
      assert.equal(byRoom.data.columns[0].freeSlots.length, 5);
      const week = await loadDiaryView(
        staff(),
        parseDiaryParams(
          { date: MON, site: a.siteA, view: "week", resource: a.sarah },
          MON,
        ),
        MON,
      );
      assert.ok(week.ok);
      assert.deepEqual(
        week.data.columns.map((c) => c.date),
        ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
      );
      assert.equal(
        week.data.cards.find((c) => c.id === r.itemId)?.columnKey,
        "d:2026-11-09",
      );
      assert.equal(week.data.columns[0].freeSlots.length, 5);
      // Blocked time shows in the practitioner's column and takes the free slots it covers.
      ok(
        await createBlockFor(staff(), {
          siteId: a.siteA,
          practitionerId: a.sarah,
          blockKind: "meeting",
          title: "Team meeting",
          date: MON,
          startTime: "11:00",
          endTime: "12:00",
        }),
      );
      const again = await loadDiaryView(
        staff(),
        parseDiaryParams({ date: MON, site: a.siteA }, MON),
        MON,
      );
      assert.ok(again.ok);
      assert.deepEqual(
        again.data.columns
          .find((c) => c.practitionerId === a.sarah)
          ?.freeSlots.map((s) => s.startMinute),
        [540, 570, 630],
      );
      assert.ok(
        again.data.cards.some(
          (c) => c.kind === "block" && c.title === "Team meeting",
        ),
      );
    });

    it("details, move, resize, status and undo through the server layer; a stale screen gets conflict", async () => {
      const r = await bookAppointmentFor(
        staff(),
        booking(a, {
          startTime: "09:00",
          caseId: a.meganCase,
          notes: "Ring first (fictional)",
        }),
      );
      ok(r);
      const id = r.itemId as string;
      const details = await loadAppointmentDetails(staff(), id);
      assert.ok(details.ok);
      assert.deepEqual(
        [
          details.data.notes,
          details.data.patient?.name,
          details.data.caseTitle,
          details.data.lateIfCancelledNow,
        ],
        ["Ring first (fictional)", "Megan Hart", "Neck (fictional)", true],
        "09:00 at 08:00 – cancelling now would be late",
      );
      const moved = await moveAppointmentFor(staff(), {
        id,
        expectedRev: 1,
        date: MON,
        startTime: "09:30",
      });
      ok(moved);
      assert.equal(moved.rev, 2);
      const stale = await moveAppointmentFor(staff(), {
        id,
        expectedRev: 1,
        date: MON,
        startTime: "09:00",
      });
      assert.ok(!stale.ok && stale.conflict);
      const clash = await resizeAppointmentFor(staff(), {
        id,
        expectedRev: 2,
        durationMinutes: 45,
      });
      assert.ok(
        !clash.ok &&
          clash.clashes &&
          clash.clashes[0].startsWith("The practitioner is already booked"),
        JSON.stringify(clash),
      );
      ok(
        await resizeAppointmentFor(staff(), {
          id,
          expectedRev: 2,
          durationMinutes: 20,
        }),
      );
      // Seen statuses only from 60 minutes before the start (handover §13.4 item 2): the clock is the visit's day.
      clock = Date.parse("2026-11-09T18:00:00.000Z");
      ok(
        await setAppointmentStatusFor(staff(), {
          id,
          expectedRev: 3,
          status: "arrived",
        }),
      );
      ok(
        await setAppointmentStatusFor(staff(), {
          id,
          expectedRev: 4,
          status: "booked",
        }),
      );
      clock = NOW;
      ok(
        await updateAppointmentDetailsFor(staff(), {
          id,
          expectedRev: 5,
          notes: "",
        }),
      );
      const shown = await loadAppointmentDetails(staff(), id);
      assert.ok(shown.ok && shown.data.notes === null && shown.data.rev === 6);
      // A clinic's own route answers 404 for another clinic's id.
      assert.equal(
        (await loadAppointmentDetails(caller(B, "staff"), id)).ok,
        false,
      );
    });

    it("cancel: late by the clock with the fee on, or not late; rebook a cancelled one", async () => {
      const soon = await bookAppointmentFor(
        staff(),
        booking(a, {
          patientId: a.daniel,
          startTime: "11:30",
          roomId: null,
          practitionerId: a.tom,
        }),
      );
      ok(soon);
      const late = await cancelAppointmentFor(staff(), {
        id: soon.itemId,
        expectedRev: 1,
        reason: "illness",
        note: "Rang at 07:50 (fictional)",
      });
      ok(late);
      assert.match(late.message, /late/);
      const d = await loadAppointmentDetails(staff(), soon.itemId as string);
      assert.ok(
        d.ok &&
          d.data.status === "late_cancelled" &&
          d.data.feeDue &&
          d.data.cancelReason === "illness" &&
          d.data.cancelNote === "Rang at 07:50 (fictional)",
      );
      const later = await bookAppointmentFor(
        staff(),
        booking(a, {
          patientId: a.daniel,
          date: "2026-11-23",
          startTime: "09:00",
        }),
      );
      ok(later);
      ok(
        await cancelAppointmentFor(staff(), {
          id: later.itemId,
          expectedRev: 1,
          reason: "patient",
        }),
      );
      const d2 = await loadAppointmentDetails(staff(), later.itemId as string);
      assert.ok(d2.ok && d2.data.status === "cancelled" && !d2.data.feeDue);
      const waived = await bookAppointmentFor(
        staff(),
        booking(a, {
          patientId: a.daniel,
          startTime: "11:30",
          roomId: null,
          practitionerId: a.tom,
        }),
      );
      ok(waived);
      ok(
        await cancelAppointmentFor(staff(), {
          id: waived.itemId,
          expectedRev: 1,
          reason: "clinic",
          feeDue: false,
        }),
      );
      const d3 = await loadAppointmentDetails(staff(), waived.itemId as string);
      assert.ok(
        d3.ok && d3.data.status === "late_cancelled" && !d3.data.feeDue,
        "the clinic cancelled: no fee",
      );
      const rebooked = await rebookAppointmentFor(staff(), {
        id: later.itemId,
        date: "2026-11-30",
        startTime: "09:00",
      });
      ok(rebooked);
      assert.notEqual(rebooked.itemId, later.itemId);
      refused(
        await rebookAppointmentFor(staff(), {
          id: rebooked.itemId,
          date: "2026-12-07",
          startTime: "09:00",
        }),
        /Move a booked appointment/,
      );
    });

    it("recurring with skips through the server layer, then cancel the rest of the series", async () => {
      ok(
        await bookAppointmentFor(
          staff(),
          booking(a, {
            patientId: a.daniel,
            date: "2026-11-16",
            startTime: "10:00",
          }),
        ),
      );
      const all = await bookAppointmentFor(
        staff(),
        booking(a, {
          date: "2026-11-09",
          startTime: "10:00",
          repeat: { intervalWeeks: 1, occurrences: 4 },
        }),
      );
      assert.ok(!all.ok && all.canSkipClashes, JSON.stringify(all));
      const some = await bookAppointmentFor(staff(), {
        ...booking(a, {
          date: "2026-11-02",
          startTime: "11:00",
          roomId: a.roomA2,
          repeat: { intervalWeeks: 1, occurrences: 4 },
        }),
        skipClashes: true,
      });
      ok(some);
      assert.deepEqual(
        some.skippedDates,
        ["2026-11-09"],
        "the meeting at 11:00 on the 9th",
      );
      assert.equal(some.itemIds?.length, 3);
      const items = await Promise.all(
        (some.itemIds ?? []).map((id) => loadAppointmentDetails(staff(), id)),
      );
      const seriesId = items[0].ok ? items[0].data.seriesId : null;
      assert.ok(seriesId);
      const cancelled = await cancelSeriesFor(staff(), {
        seriesId,
        fromDate: "2026-11-20",
        reason: "patient",
      });
      ok(cancelled);
      assert.equal(cancelled.message, "1 appointment cancelled.");
    });

    it("site scope: a member limited to site A sees and changes nothing of site B", async () => {
      const atB = await bookAppointmentFor(
        staff(),
        booking(a, {
          siteId: a.siteB,
          roomId: a.roomB1,
          practitionerId: a.tom,
          startTime: "14:00",
          notes: "B note (fictional)",
        }),
      );
      ok(atB);
      const onlyA = staff([a.siteA]);
      // Reads
      const view = await loadDiaryView(
        onlyA,
        parseDiaryParams({ date: MON, site: a.siteB }, MON),
        MON,
      );
      assert.ok(view.ok);
      assert.deepEqual(
        view.data.sites.map((s) => s.id),
        [a.siteA],
        "the switcher lists site A only",
      );
      assert.equal(view.data.site?.id, a.siteA, "asking for B shows A");
      assert.equal(
        view.data.cards.some((c) => c.siteId === a.siteB),
        false,
      );
      const tomWeek = await loadDiaryView(
        onlyA,
        parseDiaryParams(
          { date: MON, site: a.siteA, view: "week", resource: a.tom },
          MON,
        ),
        MON,
      );
      assert.ok(
        tomWeek.ok && tomWeek.data.cards.every((c) => c.siteId === a.siteA),
        "a practitioner's week hides other sites",
      );
      assert.equal(
        (await loadAppointmentDetails(onlyA, atB.itemId as string)).ok,
        false,
      );
      assert.equal(
        (await loadDaySheet(onlyA, { siteId: a.siteB, date: MON })).ok,
        false,
      );
      const tab = await loadPatientAppointments(onlyA, a.megan);
      assert.ok(
        tab.ok &&
          [...tab.data.upcoming, ...tab.data.past].every(
            (x) => x.siteId === a.siteA,
          ),
      );
      const all = await loadPatientAppointments(staff(), a.megan);
      assert.ok(
        all.ok &&
          [...all.data.upcoming, ...all.data.past].some(
            (x) => x.siteId === a.siteB,
          ),
      );
      const hits = await searchDiaryPatients(onlyA, "Hart");
      assert.ok(
        hits.ok && hits.data.every((h) => !h.next || h.next.siteId === a.siteA),
      );
      const slots = await loadFreeSlots(onlyA, {
        serviceId: a.fu,
        fromDate: MON,
        days: 7,
      });
      assert.ok(
        slots.ok &&
          slots.data.length > 0 &&
          slots.data.every((s) => s.siteId === a.siteA),
      );
      assert.equal(
        (await loadFreeSlots(onlyA, { serviceId: a.fu, siteId: a.siteB })).ok,
        false,
      );
      const rotas = await loadRotas(onlyA);
      assert.ok(rotas.ok && rotas.data.every((r) => r.siteId === a.siteA));
      // Writes
      refused(
        await bookAppointmentFor(
          onlyA,
          booking(a, {
            siteId: a.siteB,
            roomId: a.roomB1,
            practitionerId: a.tom,
            startTime: "15:00",
          }),
        ),
        /not one of yours/,
      );
      refused(
        await moveAppointmentFor(onlyA, {
          id: atB.itemId,
          expectedRev: 1,
          date: MON,
          startTime: "15:00",
        }),
        /no longer exists/,
      );
      refused(
        await setAppointmentStatusFor(onlyA, {
          id: atB.itemId,
          expectedRev: 1,
          status: "arrived",
        }),
        /no longer exists/,
      );
      refused(
        await cancelAppointmentFor(onlyA, {
          id: atB.itemId,
          expectedRev: 1,
          reason: "patient",
        }),
        /no longer exists/,
      );
      refused(
        await updateAppointmentDetailsFor(onlyA, {
          id: atB.itemId,
          expectedRev: 1,
          notes: "x",
        }),
        /no longer exists/,
      );
      refused(
        await resizeAppointmentFor(onlyA, {
          id: atB.itemId,
          expectedRev: 1,
          durationMinutes: 45,
        }),
        /no longer exists/,
      );
      const mineAtA = await bookAppointmentFor(
        onlyA,
        booking(a, {
          patientId: a.daniel,
          startTime: "09:00",
          roomId: a.roomA2,
          practitionerId: a.tom,
        }),
      );
      ok(mineAtA);
      refused(
        await moveAppointmentFor(onlyA, {
          id: mineAtA.itemId,
          expectedRev: 1,
          date: MON,
          startTime: "15:00",
          siteId: a.siteB,
        }),
        /not one of yours/,
      );
      refused(
        await createBlockFor(onlyA, {
          siteId: a.siteB,
          roomId: a.roomB1,
          blockKind: "closed",
          date: MON,
          startTime: "08:00",
          endTime: "09:00",
        }),
        /not one of yours/,
      );
      refused(
        await createRotaEntryFor(caller(A, "admin", [a.siteA]), {
          practitionerId: a.tom,
          siteId: a.siteB,
          weekday: 4,
          startTime: "09:00",
          endTime: "12:00",
          validFrom: "2026-11-02",
        }),
        /not one of yours/,
      );
      const bRota = (await loadRotas(staff(), { siteId: a.siteB })).ok
        ? (
            (await loadRotas(staff(), { siteId: a.siteB })) as {
              ok: true;
              data: { id: string; rev: number }[];
            }
          ).data[0]
        : null;
      assert.ok(bRota);
      refused(
        await updateRotaEntryFor(caller(A, "admin", [a.siteA]), {
          id: bRota.id,
          expectedRev: bRota.rev,
          endTime: "18:00",
        }),
        /no longer exists/,
      );
      const entryB = await addToWaitingListFor(staff(), {
        patientId: a.daniel,
        siteId: a.siteB,
      });
      ok(entryB);
      const list = await loadWaitingList(onlyA);
      assert.ok(list.ok && !list.data.some((e) => e.id === entryB.itemId));
      assert.equal(
        (await loadWaitingListEntry(onlyA, entryB.itemId as string)).ok,
        false,
      );
      refused(
        await setWaitingListStatusFor(onlyA, {
          id: entryB.itemId,
          expectedRev: 1,
          status: "removed",
        }),
        /no longer exists/,
      );
      refused(
        await addToWaitingListFor(onlyA, {
          patientId: a.daniel,
          siteId: a.siteB,
        }),
        /not one of yours/,
      );
      const seriesAtB = await bookAppointmentFor(
        staff(),
        booking(a, {
          siteId: a.siteB,
          roomId: null,
          practitionerId: a.tom,
          date: "2026-11-16",
          startTime: "13:00",
          repeat: { intervalWeeks: 1, occurrences: 2 },
        }),
      );
      ok(seriesAtB);
      const sb = await loadAppointmentDetails(
        staff(),
        seriesAtB.itemId as string,
      );
      assert.ok(sb.ok && sb.data.seriesId);
      refused(
        await cancelSeriesFor(onlyA, {
          seriesId: sb.data.seriesId,
          fromDate: "2026-11-01",
        }),
        /no longer exists/,
      );
      const det = await loadAppointmentDetails(staff(), atB.itemId as string);
      assert.ok(
        det.ok && det.data.status === "booked" && det.data.rev === 1,
        "site B's appointment untouched",
      );
    });

    it("day sheet: groups per practitioner with hours; names, times, rooms – never notes or dates of birth", async () => {
      const sheet = await loadDaySheet(staff(), { siteId: a.siteA, date: MON });
      assert.ok(sheet.ok);
      const s = sheet.data;
      assert.equal(s.site.name, "Bletchley (fictional)");
      const sarah = s.groups.find((g) => g.practitionerId === a.sarah);
      assert.ok(sarah && sarah.hours === "09:00–12:00");
      assert.ok(
        sarah.rows.some(
          (r) =>
            r.patientName === "Megan Hart" &&
            r.roomName === "Room 1" &&
            r.serviceName === "Follow-up",
        ),
      );
      assert.ok(
        sarah.rows.some(
          (r) => r.kind === "block" && r.blockLabel === "Meeting",
        ),
      );
      assert.deepEqual(
        sarah.rows.map((r) => r.startTime),
        [...sarah.rows.map((r) => r.startTime)].sort(),
        "by time",
      );
      const text = JSON.stringify(s);
      for (const secret of ["Parking", "Ring first", "1991", "Rang at"])
        assert.equal(text.includes(secret), false, secret);
      assert.equal(
        s.groups.some((g) => g.rows.some((r) => r.status === "late_cancelled")),
        false,
        "cancellations left out",
      );
      const withCancelled = await loadDaySheet(staff(), {
        siteId: a.siteA,
        date: MON,
        includeCancelled: true,
      });
      assert.ok(
        withCancelled.ok &&
          withCancelled.data.groups.some((g) =>
            g.rows.some((r) => r.status === "late_cancelled"),
          ),
      );
      const one = await loadDaySheet(staff(), {
        siteId: a.siteA,
        date: MON,
        practitionerId: a.sarah,
      });
      assert.ok(
        one.ok && one.data.groups.every((g) => g.practitionerId === a.sarah),
      );
    });

    it("day sheet: dates of birth only when the clinic's diary setting is on (default off, owners/administrators switch it)", async () => {
      const off = await loadDaySheet(staff(), { siteId: a.siteA, date: MON });
      assert.ok(off.ok);
      assert.equal(off.data.showsDateOfBirth, false, "default off");
      assert.ok(off.data.groups.every((g) => g.rows.every((r) => r.dateOfBirth === null)));
      assert.equal(JSON.stringify(off.data).includes("14/03/1991"), false);
      // Reception (no settings.manage) cannot switch it on.
      refused(await setDaySheetDobFor(staff(), { on: true }), /permission/);
      ok(await setDaySheetDobFor(caller(A, "owner", null, "user_owner_01"), { on: true }));
      const on = await loadDaySheet(staff(), { siteId: a.siteA, date: MON });
      assert.ok(on.ok && on.data.showsDateOfBirth);
      assert.ok(
        on.data.groups.some((g) => g.rows.some((r) => r.patientName === "Megan Hart" && r.dateOfBirth === "14/03/1991")),
        "Megan's date of birth printed",
      );
      // Another clinic is not affected.
      const other = await loadDaySheet(caller(B, "staff"), { siteId: b.siteA, date: MON });
      assert.ok(other.ok && !other.data.showsDateOfBirth);
      assert.equal((await listAudit(ctx, A, { action: "pms.diary_settings.update" })).length, 1, "audited");
      ok(await setDaySheetDobFor(caller(A, "admin", null, "user_admin_01"), { on: false }));
      const offAgain = await loadDaySheet(staff(), { siteId: a.siteA, date: MON });
      assert.ok(offAgain.ok && !offAgain.data.showsDateOfBirth && offAgain.data.groups.every((g) => g.rows.every((r) => r.dateOfBirth === null)));
    });

    it("booking check: free, a clash named with the patient's proper name and the next free slot, a series with a skipped date", async () => {
      clock = NOW;
      const free = await checkBookingFor(staff(), booking(a, { patientId: a.daniel, startTime: "11:30", date: "2026-11-16" }));
      assert.ok(free.ok && free.data.first.status === "free" && free.data.clashText === null);
      assert.match(free.ok ? free.data.first.dateLabel : "", /^Mon 16\/11\/2026$/);
      const meeting = await checkBookingFor(staff(), booking(a, { patientId: a.daniel, startTime: "11:30" }));
      assert.ok(meeting.ok && meeting.data.first.status === "unavailable" && /Sarah Reid is not available/.test(meeting.data.clashText ?? "") && meeting.data.nextFree !== null);
      // 10:00 holds Megan's appointment with Sarah (booked earlier in this suite) – Daniel at 10:00 clashes.
      const taken = await checkBookingFor(staff(), booking(a, { patientId: a.daniel, startTime: "10:00" }));
      assert.ok(taken.ok);
      if (taken.data.first.status === "clash") {
        assert.match(taken.data.clashText ?? "", /Sarah Reid already has Megan Hart/);
        assert.match(taken.data.first.note, /Megan Hart/, "proper names, not lower case");
      }
      const series = await checkBookingFor(staff(), { ...booking(a, { patientId: a.daniel, startTime: "11:30", date: "2026-11-16" }), repeat: { intervalWeeks: 1, occurrences: 3 } });
      assert.ok(series.ok && series.data.occurrences.length === 3);
      const booked = await bookAppointmentFor(staff(), { ...booking(a, { patientId: a.daniel, startTime: "11:30", date: "2026-11-16" }), repeat: { intervalWeeks: 1, occurrences: 3 }, skipDates: ["2026-11-23"], sendConfirmation: true });
      ok(booked);
      assert.equal(booked.itemIds?.length, 2);
      assert.deepEqual(booked.skippedDates, ["2026-11-23"]);
      const det = await loadAppointmentDetails(staff(), booked.itemId as string);
      assert.ok(det.ok && det.data.confirmationRequested && det.data.payerLabel === null);
      assert.equal(det.ok && det.data.bookedBy, null, "booked by: no such user in this test database");
    });

    it("the patient's Appointments tab: upcoming soonest first, past newest first, counts, paging", async () => {
      clock = Date.parse("2026-11-09T12:00:00.000Z");
      const tab = await loadPatientAppointments(staff(), a.megan, {
        pageSize: 200,
      });
      assert.ok(tab.ok);
      const t = tab.data;
      assert.ok(t.upcoming.length >= 3 && t.past.length >= 1);
      assert.deepEqual(
        t.upcoming.map((x) => x.startsAt),
        [...t.upcoming.map((x) => x.startsAt)].sort(),
      );
      assert.deepEqual(
        t.past.map((x) => x.startsAt),
        [...t.past.map((x) => x.startsAt)].sort().reverse(),
      );
      assert.ok(t.counts.booked >= 3);
      assert.ok(
        t.upcoming.every(
          (x) => x.statusLabel && x.siteName && x.practitionerName,
        ),
      );
      const page = await loadPatientAppointments(staff(), a.megan, {
        pageSize: 2,
      });
      assert.ok(page.ok && page.data.nextBefore);
      const next = await loadPatientAppointments(staff(), a.megan, {
        pageSize: 2,
        before: page.data.nextBefore,
      });
      assert.ok(
        next.ok &&
          [...next.data.upcoming, ...next.data.past].every(
            (x) => x.startsAt < (page.data.nextBefore as string),
          ),
      );
      assert.equal(
        (await loadPatientAppointments(caller(B, "staff"), a.megan)).ok &&
          (
            (await loadPatientAppointments(caller(B, "staff"), a.megan)) as {
              ok: true;
              data: { past: unknown[]; upcoming: unknown[] };
            }
          ).data.past.length,
        0,
      );
      clock = NOW;
    });

    it("rotas: add, change and end (diary.rota), overlap refused with a plain message", async () => {
      const admin = caller(A, "admin");
      const added = await createRotaEntryFor(admin, {
        practitionerId: a.sarah,
        siteId: a.siteA,
        weekday: 3,
        startTime: "09:00",
        endTime: "17:00",
        validFrom: "2026-11-02",
      });
      ok(added);
      refused(
        await createRotaEntryFor(admin, {
          practitionerId: a.sarah,
          siteId: a.siteB,
          weekday: 3,
          startTime: "16:00",
          endTime: "18:00",
          validFrom: "2026-11-02",
        }),
        /overlaps/,
      );
      const bad = await createRotaEntryFor(admin, {
        practitionerId: a.sarah,
        siteId: a.siteA,
        weekday: 4,
        startTime: "12:00",
        endTime: "09:00",
        validFrom: "2026-11-02",
      });
      assert.ok(!bad.ok && bad.fieldErrors?.endTime);
      const changed = await updateRotaEntryFor(admin, {
        id: added.itemId,
        expectedRev: 1,
        endTime: "16:00",
      });
      ok(changed);
      assert.equal(changed.rev, 2);
      const stale = await updateRotaEntryFor(admin, {
        id: added.itemId,
        expectedRev: 1,
        endTime: "15:00",
      });
      assert.ok(!stale.ok && stale.conflict);
      ok(
        await endRotaEntryFor(admin, {
          id: added.itemId,
          expectedRev: 2,
          lastDate: "2026-12-31",
        }),
      );
      const rows = await loadRotas(staff(), { practitionerId: a.sarah });
      assert.ok(
        rows.ok &&
          rows.data.some(
            (r) =>
              r.id === added.itemId &&
              r.validTo === "2026-12-31" &&
              r.endTime === "16:00" &&
              r.weekdayName === "Wednesday",
          ),
      );
      assert.equal(
        (await listAudit(ctx, A, { action: "pms.availability.update" })).filter(
          (e) => e.targetId === added.itemId,
        ).length,
        1,
      );
    });

    it("waiting list: add, change, offer a suitable slot, decline, offer again, book the offer", async () => {
      const added = await addToWaitingListFor(staff(), {
        patientId: a.daniel,
        serviceId: a.fu,
        practitionerId: a.sarah,
        siteId: a.siteA,
        priority: "urgent",
        preferredDays: [1],
        preferredTime: "morning",
        notes: "Can come at short notice (fictional)",
      });
      ok(added);
      const id = added.itemId as string;
      ok(
        await updateWaitingListEntryFor(staff(), {
          id,
          expectedRev: 1,
          priority: "soon",
        }),
      );
      const list = await loadWaitingList(staff());
      const row = list.ok ? list.data.find((e) => e.id === id) : undefined;
      assert.deepEqual(
        [
          row?.patientName,
          row?.priorityLabel,
          row?.preferenceLabel,
          row?.hasNotes,
        ],
        ["Daniel Brooks", "Soon", "Mon · Mornings", true],
      );
      assert.equal(
        JSON.stringify(list).includes("short notice"),
        false,
        "lists never decrypt",
      );
      const view = await loadWaitingListEntry(staff(), id);
      assert.ok(view.ok);
      assert.equal(view.data.notes, "Can come at short notice (fictional)");
      assert.ok(
        view.data.suggestions.length > 0 &&
          view.data.suggestions.every(
            (s) =>
              s.practitionerId === a.sarah &&
              s.siteId === a.siteA &&
              s.date >= MON,
          ),
      );
      const pick = view.data.suggestions[0];
      const offered = await offerWaitingListSlotFor(staff(), {
        id,
        expectedRev: 2,
        siteId: pick.siteId,
        practitionerId: pick.practitionerId,
        roomId: pick.roomId,
        date: pick.date,
        startTime: pick.time,
      });
      ok(offered);
      assert.match(String(offered.itemId), /^woff_/);
      ok(
        await answerWaitingListOfferFor(staff(), {
          offerId: offered.itemId,
          expectedRev: 3,
          status: "declined",
        }),
      );
      const again = await offerWaitingListSlotFor(staff(), {
        id,
        expectedRev: 4,
        siteId: pick.siteId,
        practitionerId: pick.practitionerId,
        roomId: pick.roomId,
        date: pick.date,
        startTime: pick.time,
      });
      ok(again);
      const booked = await bookWaitingListOfferFor(staff(), {
        offerId: again.itemId,
      });
      ok(booked);
      const after = await loadWaitingListEntry(staff(), id);
      assert.ok(after.ok && after.data.row.status === "booked");
      assert.deepEqual(
        after.data.offers.map((o) => o.status),
        ["accepted", "declined"],
      );
      assert.equal(
        after.data.suggestions.length,
        0,
        "a booked entry has nothing to offer",
      );
      refused(
        await bookWaitingListOfferFor(staff(), { offerId: again.itemId }),
        /answered already/,
      );
      const det = await loadAppointmentDetails(
        staff(),
        booked.itemId as string,
      );
      assert.ok(
        det.ok &&
          det.data.patient?.name === "Daniel Brooks" &&
          det.data.startsOn === pick.date,
      );
      // Back to waiting / removed.
      const other = await addToWaitingListFor(staff(), { patientId: a.megan });
      ok(other);
      ok(
        await setWaitingListStatusFor(staff(), {
          id: other.itemId,
          expectedRev: 1,
          status: "removed",
          reason: "Found a slot elsewhere",
        }),
      );
      refused(
        await updateWaitingListEntryFor(staff(), {
          id: other.itemId,
          expectedRev: 2,
          priority: "urgent",
        }),
        /booked or removed/,
      );
    });

    it("double-booking (Khuram's decision A): refused without diary.override; with it allowed, audited, marked on both; rooms and blocked time never", async () => {
      const MON2 = "2027-01-11";
      const owner = caller(A, "owner", null, "user_owner_01");
      const first = await bookAppointmentFor(staff(), booking(a, { date: MON2, startTime: "09:00", roomId: a.roomA1 }));
      ok(first);
      const firstId = first.itemId as string;
      // Same practitioner, another room, overlapping: reception (no diary.override) is refused and cannot ask.
      const other = booking(a, { patientId: a.daniel, date: MON2, startTime: "09:15", roomId: a.roomA2 });
      const plain = await bookAppointmentFor(staff(), other);
      refused(plain, /not free/);
      assert.equal(!plain.ok && plain.overridable, false, "reception may not book over it");
      refused(await bookAppointmentFor(staff(), { ...other, override: true }), /permission to override/);
      refused(await bookAppointmentFor(staff(), { ...other, allowPatientOverlap: true }), /permission to override/);
      // The owner sees it may be overridden…
      const ownerPlain = await bookAppointmentFor(owner, other);
      assert.equal(!ownerPlain.ok && ownerPlain.overridable, true);
      // …and books anyway: allowed, warned, audited with the clashing appointment.
      const anyway = await bookAppointmentFor(owner, { ...other, override: true });
      ok(anyway);
      assert.ok(anyway.warnings.some((w) => /double-booked/i.test(w)), anyway.warnings.join(" "));
      const secondId = anyway.itemId as string;
      const audit = (await listAudit(ctx, A, { action: "pms.appointment.book" })).find((e) => e.targetId === secondId);
      assert.ok(audit, "audited");
      assert.equal((audit!.detail as Record<string, unknown>).overbooked, true);
      assert.deepEqual((audit!.detail as Record<string, unknown>).doubleBookedWith, [firstId]);
      // Both blocks carry the marker; the drawer names the other appointment.
      const view = await loadDiaryView(owner, parseDiaryParams({ date: MON2, site: a.siteA }, MON2), MON2);
      assert.ok(view.ok);
      const cards = view.ok ? view.data.cards : [];
      assert.deepEqual(cards.find((c) => c.id === firstId)?.doubleBookedWith.map((x) => x.id), [secondId]);
      assert.deepEqual(cards.find((c) => c.id === secondId)?.doubleBookedWith.map((x) => x.id), [firstId]);
      assert.equal(cards.find((c) => c.id === secondId)?.doubleBookedWith[0].patientName, "Megan Hart");
      const d1 = await loadAppointmentDetails(staff(), firstId);
      assert.ok(d1.ok && d1.data.doubleBookedWith.length === 1 && d1.data.doubleBookedWith[0].id === secondId);
      // A double-booked appointment can still go through its day (arrived, in treatment) – no new clash.
      const det = await loadAppointmentDetails(staff(), secondId);
      clock = Date.parse(`${MON2}T09:10:00.000Z`);
      ok(await setAppointmentStatusFor(staff(), { id: secondId, expectedRev: det.ok ? det.data.rev : 0, status: "arrived" }));
      clock = NOW;
      // ROOM stays strict: the owner cannot put a third appointment in Room 1 at the same time, override or not.
      const room = await bookAppointmentFor(owner, booking(a, { patientId: a.daniel, practitionerId: a.tom, date: MON2, startTime: "09:00", roomId: a.roomA1, override: true }));
      refused(room, /not free/);
      assert.equal(!room.ok && room.overridable, false, "a room clash is never overridable");
      // Nor over the practitioner's blocked time.
      ok(await createBlockFor(owner, { siteId: a.siteA, practitionerId: a.sarah, blockKind: "meeting", date: MON2, startTime: "11:00", endTime: "12:00" }));
      refused(await bookAppointmentFor(owner, booking(a, { patientId: a.daniel, date: MON2, startTime: "11:00", roomId: a.roomA2, override: true })), /not free/);
      // Moving onto the practitioner's other appointment: refused for reception, allowed with the override (logged).
      const third = await bookAppointmentFor(staff(), booking(a, { patientId: a.daniel, date: MON2, startTime: "10:00", roomId: a.roomA2 }));
      ok(third);
      const t3 = third.itemId as string;
      const moveTo = { id: t3, expectedRev: third.rev as number, date: MON2, startTime: "09:00" };
      refused(await moveAppointmentFor(staff(), moveTo), /not free/);
      refused(await moveAppointmentFor(staff(), { ...moveTo, override: true }), /permission to override/);
      // 09:00 with Sarah in Room 2: Room 2 holds the 09:15 appointment – the room refuses even with the override.
      refused(await moveAppointmentFor(owner, { ...moveTo, override: true }), /not free/);
      const moved = await moveAppointmentFor(owner, { ...moveTo, startTime: "09:30", roomId: null, override: true });
      ok(moved);
      const moveAudit = (await listAudit(ctx, A, { action: "pms.appointment.move" })).find((e) => e.targetId === t3);
      assert.ok(moveAudit && (moveAudit.detail as Record<string, unknown>).overbooked === true, "the move is logged as a double-booking");
      // The flag is per write: moving it again without the override is checked again.
      refused(await moveAppointmentFor(owner, { id: t3, expectedRev: moved.rev as number, date: MON2, startTime: "09:15" }), /not free/);
    });

    it("statuses (Khuram's decision B): Start treatment → In treatment (+ the clinician's note), undo, Completed; reception gets no note", async () => {
      const day = "2027-01-18";
      const r = await bookAppointmentFor(staff(), booking(a, { date: day, startTime: "09:00" }));
      ok(r);
      const id = r.itemId as string;
      // The visit's day (seen statuses open 60 minutes before the start).
      clock = Date.parse(`${day}T08:30:00.000Z`);
      ok(await setAppointmentStatusFor(staff(), { id, expectedRev: r.rev as number, status: "arrived" }));
      // Reception: Start treatment sets the status only.
      const recep = await startTreatmentFor({ ...staff(), member: { name: "Jess Taylor", email: "user_reception_01@example.com" } }, { id });
      ok(recep);
      assert.equal(recep.noteId, undefined, "no note for reception");
      let det = await loadAppointmentDetails(staff(), id);
      assert.ok(det.ok && det.data.status === "in_treatment" && det.data.treatmentStarted);
      assert.ok(det.ok && det.data.nextStatuses.includes("attended") && det.data.nextStatuses.includes("arrived") && !det.data.canMove);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.start_treatment" })).filter((e) => e.targetId === id).length, 1, "audited");
      // Undo → arrived; the clinician starts treatment: status AND the note linked to the appointment.
      ok(await setAppointmentStatusFor(staff(), { id, expectedRev: det.ok ? det.data.rev : 0, status: "arrived" }));
      det = await loadAppointmentDetails(staff(), id);
      assert.ok(det.ok && det.data.status === "arrived" && !det.data.treatmentStarted);
      const clin: DiaryCaller = { ...caller(A, "clinician", null, "user_clinician_01"), member: { name: "Sarah Reid", email: "user_clinician_01@example.com" } };
      const started = await startTreatmentFor(clin, { id });
      ok(started);
      assert.ok(started.noteId, "the note opens");
      // Again (e.g. "Open note"): the same draft, not a second note; the status stays.
      const again = await startTreatmentFor(clin, { id });
      ok(again);
      assert.equal(again.noteId, started.noteId);
      // The day sheet and the patient's tab read "In treatment"; the counts have their own bucket.
      const sheet = await loadDaySheet(staff(), { siteId: a.siteA, date: day });
      assert.ok(sheet.ok && sheet.data.groups.some((g) => g.rows.some((x) => x.id === id && x.statusLabel === "In treatment")));
      const tab = await loadPatientAppointments(staff(), a.megan);
      assert.ok(tab.ok && tab.data.counts.in_treatment >= 1);
      // Completed (attended): reads "Completed"; undo goes back to in treatment.
      det = await loadAppointmentDetails(staff(), id);
      ok(await setAppointmentStatusFor(clin, { id, expectedRev: det.ok ? det.data.rev : 0, status: "attended" }));
      const done = await loadDaySheet(staff(), { siteId: a.siteA, date: day });
      assert.ok(done.ok && done.data.groups.some((g) => g.rows.some((x) => x.id === id && x.status === "attended" && x.statusLabel === "Completed")));
      det = await loadAppointmentDetails(staff(), id);
      assert.ok(det.ok && det.data.treatmentStarted && det.data.nextStatuses.includes("in_treatment"));
      ok(await setAppointmentStatusFor(staff(), { id, expectedRev: det.ok ? det.data.rev : 0, status: "in_treatment" }));
      det = await loadAppointmentDetails(staff(), id);
      assert.ok(det.ok && det.data.status === "in_treatment");
      // Start treatment needs an arrived patient; a role without diary.book cannot.
      const b2 = await bookAppointmentFor(staff(), booking(a, { patientId: a.daniel, date: day, startTime: "10:00" }));
      ok(b2);
      refused(await startTreatmentFor(staff(), { id: b2.itemId }), /arrived first/);
      refused(await startTreatmentFor(caller(A, ["clinic.view", "diary.view"]), { id }), /permission/);
      clock = NOW;
    });

    it("safe errors: an internal failure answers a plain message and leaks nothing", async () => {
      const broken: DiaryCaller = {
        ...staff(),
        ctx: {
          ...ctx,
          cipher: {
            ...ctx.cipher,
            encrypt: () => {
              throw new Error("SECRET-KEY-MATERIAL /var/db/internal");
            },
          },
        } as unknown as RepoContext,
      };
      const r = await bookAppointmentFor(
        broken,
        booking(a, { date: "2026-12-14", notes: "x" }),
      );
      assert.deepEqual(r, {
        ok: false,
        error: "Something went wrong. Please try again.",
      });
    });

    it("clinic isolation: another clinic's caller cannot read or change clinic A's diary", async () => {
      const otherClinic = caller(B, "owner");
      const view = await loadDiaryView(
        otherClinic,
        parseDiaryParams({ date: MON, site: a.siteA }, MON),
        MON,
      );
      assert.ok(
        view.ok &&
          view.data.site?.id === b.siteA &&
          view.data.cards.every((c) => c.siteId !== a.siteA),
      );
      const mine = await loadPatientAppointments(staff(), a.megan);
      const anyId = mine.ok ? mine.data.upcoming[0].id : "";
      refused(
        await setAppointmentStatusFor(otherClinic, {
          id: anyId,
          expectedRev: 1,
          status: "arrived",
        }),
        /no longer exists/,
      );
      refused(
        await bookAppointmentFor(
          otherClinic,
          booking(a, {
            siteId: b.siteA,
            roomId: b.roomA1,
            practitionerId: b.sarah,
            startTime: "09:00",
          }),
        ),
        /does not exist in this clinic/,
      );
    });

    it("every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
