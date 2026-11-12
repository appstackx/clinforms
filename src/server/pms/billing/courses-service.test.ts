/**
 * Courses server layer (PK02) on node:sqlite and PGlite, with the diary's visit adapter: Set-up (settings.setup,
 * whole clinic), selling on a patient's record, the visits list offering "Use course (N of M left)", invoicing with
 * those visits used instead (no line, no longer unbilled), reversing, cancelling (billing.refund) and the expiry
 * (owner or admin). Fictional clinic, patients and services only. Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../db/testing/databases";
import type { RepoContext } from "../../repos/context";
import { getInvoice } from "../../repos/pms/billing/invoices";
import { bulkCreateDiaryItems, setAppointmentStatus } from "../../repos/pms/diary/appointments";
import { createPractitioner, createService, createSite } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import type { SetupActor } from "../reporting/setup";
import { testActor } from "./access";
import { cancelCourseFor, courseTypesScreenFor, patientCoursesFor, reverseCourseUseFor, saveCourseTypeFor, sellCourseFor, setCourseExpiryFor } from "./courses";
import { billingHomeFor, uninvoicedVisitsFor } from "./views";
import { invoiceVisitsFor } from "./writes";
import { runExpirySweep } from "../../repos/pms/billing/expiry";

const A = "riverside-crs";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const DAY = "2026-11-09";
const utc = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`courses server layer on ${label}`, () => {
    let db: GuardedDb;
    let ctx: RepoContext;
    let clock = Date.parse(utc("2026-11-10", "09:00"));
    const id: Record<string, string> = {};
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
    const reception = () => testActor(ctx, A, "staff", { userId: "user_reception_01", name: "Jess Taylor (fictional)" });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Priya Shah (fictional)" });
    const setup = (a: ReturnType<typeof testActor>) => ({ ...a, organizationId: `org_${A}` }) as unknown as SetupActor;
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };

    async function attendedVisit(patientId: string, start: string, serviceId = id.fu, day = DAY) {
      const [apptId] = await bulkCreateDiaryItems(
        ctx,
        A,
        [{ kind: "appointment", siteId: id.site, practitionerId: id.prac, patientId, caseId: null, serviceId, authorisationId: null, startsAt: utc(day, start), endsAt: utc(day, `${start.slice(0, 2)}:30`), status: "booked", source: "staff" }],
        SEED,
      );
      const saved = clock;
      clock = Math.max(saved, Date.parse(utc(day, "18:00")));
      const r = await setAppointmentStatus(ctx, A, apptId, { expectedRev: 1, status: "attended" }, SEED);
      clock = saved;
      assert.ok(r.ok);
      return apptId;
    }

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date(clock) };
      id.site = (await createSite(ctx, A, { name: "Harbour Road (fictional)", code: "HAR" }, SEED)).id;
      id.prac = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-01", defaultSiteId: id.site }, SEED)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up 30 min", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.ia = (await createService(ctx, A, { name: "Initial assessment", category: "initial", durationMinutes: 45, defaultPricePence: 7500 }, SEED)).id;
      id.owen = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1990-12-02" }, SEED)).id;
      id.liam = (await createPatient(ctx, A, { firstName: "Liam", lastName: "Grey", dateOfBirth: "1985-06-21" }, SEED)).id;
    });
    after(async () => {
      await db?.close();
    });

    it("Set-up → Courses: settings.setup; reception refused; bad fields named; a course added and listed", async () => {
      assert.equal((await courseTypesScreenFor(setup(reception()))).ok, false);
      assert.equal((await saveCourseTypeFor(setup(reception()), { name: "x" })).ok, false);
      const bad = await saveCourseTypeFor(setup(owner()), { name: "", serviceIds: [], sessions: "0", price: "abc", validDays: "" });
      assert.ok(!bad.ok && bad.fieldErrors && "name" in bad.fieldErrors && "serviceIds" in bad.fieldErrors && "pricePence" in bad.fieldErrors);
      const saved = ok(await saveCourseTypeFor(setup(owner()), { name: "3 follow-ups", serviceIds: [id.fu], sessions: "3", price: "£150.00", validDays: "90" }));
      id.type = saved.id;
      const screen = ok(await courseTypesScreenFor(setup(owner())));
      assert.equal(screen.types.length, 1);
      assert.equal(screen.types[0].summary, "3 sessions · Follow-up 30 min · valid 90 days");
      assert.equal(screen.canEdit, true);
    });

    it("selling: billing.edit; the course starts on issue and reads '0 of 3 used · expires dd/mm/yyyy'", async () => {
      assert.equal((await sellCourseFor(clinician(), id.owen, { courseTypeId: id.type })).ok, false, "a clinician has no billing.edit");
      const draft = ok(await sellCourseFor(owner(), id.owen, { courseTypeId: id.type }));
      assert.equal(draft.issued, false);
      let view = ok(await patientCoursesFor(owner(), id.owen));
      assert.deepEqual(
        view.pending.map((p) => [p.name, p.totalPence]),
        [["3 follow-ups", 15000]],
      );
      assert.equal(view.courses.length, 0);
      const sold = ok(await sellCourseFor(owner(), id.liam, { courseTypeId: id.type, issue: true }));
      assert.ok(sold.issued && sold.number);
      view = ok(await patientCoursesFor(owner(), id.liam));
      assert.equal(view.courses.length, 1);
      assert.equal(view.courses[0].progress, "0 of 3 used · expires 07/02/2027");
      assert.equal(view.courses[0].stateLabel, "Active");
      assert.equal(view.canCancel, true);
      assert.equal(view.canExtend, true);
      id.course = view.courses[0].id;
      id.courseRev = String(view.courses[0].rev);
      const rec = ok(await patientCoursesFor(reception(), id.liam));
      assert.equal(rec.canExtend, false, "reception cannot move an expiry");
    });

    it("visits: a covered visit is offered 'Use course (N of 3 left)'; invoicing uses it instead of a line; it is no longer unbilled", async () => {
      id.v1 = await attendedVisit(id.liam, "09:00");
      id.v2 = await attendedVisit(id.liam, "10:00");
      id.v3 = await attendedVisit(id.liam, "11:00", id.ia);
      id.owenV = await attendedVisit(id.owen, "12:00");
      const list = ok(await uninvoicedVisitsFor(owner()));
      const byId = new Map(list.visits.map((v) => [v.appointmentId, v]));
      assert.equal(byId.get(id.v1)?.course?.label, "Use course (3 of 3 left)");
      assert.equal(byId.get(id.v2)?.course?.label, "Use course (2 of 3 left)");
      assert.equal(byId.get(id.v3)?.course ?? null, null, "the course does not cover an initial assessment");
      assert.equal(byId.get(id.owenV)?.course ?? null, null, "Owen's course is not issued yet");
      const before = ok(await billingHomeFor(owner())).figures.uninvoicedVisits;
      const r = ok(await invoiceVisitsFor(owner(), { appointmentIds: [id.v1, id.v2, id.v3], issue: true, useCourse: [id.v1, id.v2, id.v3] }));
      assert.equal(r.courseUses, 2);
      // Ticked "use course" but no course covers it: NOT invoiced instead (never charged without the member knowing).
      assert.equal(r.invoices.length, 0);
      assert.deepEqual(
        r.courseRefused.map((x) => x.appointmentId),
        [id.v3],
      );
      const r3 = ok(await invoiceVisitsFor(owner(), { appointmentIds: [id.v3], issue: true }));
      assert.equal(r3.invoices.length, 1, "the assessment is invoiced on its own");
      const inv = await getInvoice(ctx, A, r3.invoices[0].id);
      assert.deepEqual(
        inv?.lines.map((l) => l.appointmentId),
        [id.v3],
      );
      const after = ok(await uninvoicedVisitsFor(owner()));
      assert.ok(!after.visits.some((v) => [id.v1, id.v2, id.v3].includes(v.appointmentId)), "used and invoiced visits leave the list");
      assert.equal(ok(await billingHomeFor(owner())).figures.uninvoicedVisits, before - 3);
      const view = ok(await patientCoursesFor(owner(), id.liam));
      assert.equal(view.courses[0].progress, "2 of 3 used · expires 07/02/2027");
      // Only visits used from a course: no invoice, still a success.
      id.v4 = await attendedVisit(id.liam, "13:00");
      const only = ok(await invoiceVisitsFor(owner(), { appointmentIds: [id.v4], useCourse: [id.v4] }));
      assert.deepEqual([only.invoices.length, only.courseUses], [0, 1]);
      assert.equal(ok(await patientCoursesFor(owner(), id.liam)).courses[0].stateLabel, "Used up");
    });

    it("reverse: puts the visit back on the course and back on the list to invoice", async () => {
      const view = ok(await patientCoursesFor(owner(), id.liam));
      const use = view.courses[0].uses.find((u) => !u.reversed);
      assert.ok(use);
      assert.equal((await reverseCourseUseFor(clinician(), id.course, use.id)).ok, false);
      assert.equal(ok(await reverseCourseUseFor(owner(), id.course, use.id)).reversed, true);
      const again = ok(await patientCoursesFor(owner(), id.liam));
      assert.equal(again.courses[0].progress, "2 of 3 used · expires 07/02/2027");
      const list = ok(await uninvoicedVisitsFor(owner()));
      const back = list.visits.filter((v) => [id.v1, id.v2, id.v4].includes(v.appointmentId));
      assert.equal(back.length, 1, "the visit put back is on the list again");
      assert.equal(back[0].course?.label, "Use course (1 of 3 left)");
      id.back = back[0].appointmentId;
    });

    it("expiry: owners and admins only; cancel: billing.refund, credits the unused session pro rata", async () => {
      const c = ok(await patientCoursesFor(owner(), id.liam)).courses[0];
      assert.equal((await setCourseExpiryFor(reception(), id.course, c.rev, "2027-03-31")).ok, false);
      ok(await setCourseExpiryFor(owner(), id.course, c.rev, "2027-03-31"));
      assert.match(ok(await patientCoursesFor(owner(), id.liam)).courses[0].progress, /expires 31\/03\/2027$/);
      assert.equal(ok(await patientCoursesFor(owner(), id.liam)).courses[0].cancelQuote?.defaultPence, 5000);
      assert.equal((await cancelCourseFor(reception(), id.course, { reason: "Moved away" })).ok, false, "reception has no billing.refund");
      const r = ok(await cancelCourseFor(owner(), id.course, { reason: "Moved away" }));
      assert.equal(r.creditPence, 5000);
      assert.ok(r.creditNumber);
      const view = ok(await patientCoursesFor(owner(), id.liam));
      assert.equal(view.courses[0].stateLabel, "Cancelled");
      const list = ok(await uninvoicedVisitsFor(owner()));
      assert.ok(list.visits.find((v) => v.appointmentId === id.back)?.course == null, "a cancelled course is offered no more");
    });

    it("PK06 review: a visit on a course's last day is used from it when invoiced later, also after the sweep; a refused use is not charged", async () => {
      const t = ok(await saveCourseTypeFor(setup(owner()), { name: "2 follow-ups", serviceIds: [id.fu], sessions: "2", price: "£100.00", validDays: "30" })).id;
      id.mia = (await createPatient(ctx, A, { firstName: "Mia", lastName: "Hale", dateOfBirth: "1992-02-14" }, SEED)).id;
      const sold = ok(await sellCourseFor(owner(), id.mia, { courseTypeId: t, issue: true }));
      assert.ok(sold.issued);
      const c = ok(await patientCoursesFor(owner(), id.mia)).courses.find((x) => x.name === "2 follow-ups")!;
      ok(await setCourseExpiryFor(owner(), c.id, c.rev, "2026-11-10")); // the last valid day: 10/11/2026
      const last1 = await attendedVisit(id.mia, "09:00", id.fu, "2026-11-10");
      const last2 = await attendedVisit(id.mia, "10:00", id.fu, "2026-11-10");
      clock = Date.parse(utc("2026-11-11", "09:00"));
      const late = await attendedVisit(id.mia, "08:00", id.fu, "2026-11-11");
      clock = Date.parse(utc("2026-11-12", "09:00")); // two days on, the course past its expiry, not swept yet
      const list = new Map(ok(await uninvoicedVisitsFor(owner())).visits.map((v) => [v.appointmentId, v]));
      assert.equal(list.get(last1)?.course?.label, "Use course (2 of 2 left)", "offered for a visit dated within its validity");
      assert.equal(list.get(late)?.course ?? null, null, "not for a visit after the expiry");
      const r1 = ok(await invoiceVisitsFor(owner(), { appointmentIds: [last1], issue: true, useCourse: [last1] }));
      assert.deepEqual([r1.courseUses, r1.invoices.length, r1.courseRefused.length], [1, 0, 0]);
      // After the nightly sweep marked it expired: the other last-day visit still uses it.
      db.log.pause();
      try {
        assert.equal((await runExpirySweep(ctx)).courses, 1);
      } finally {
        db.log.resume();
      }
      const r2 = ok(await invoiceVisitsFor(owner(), { appointmentIds: [last2], issue: true, useCourse: [last2] }));
      assert.deepEqual([r2.courseUses, r2.invoices.length], [1, 0]);
      const after = ok(await patientCoursesFor(owner(), id.mia)).courses.find((x) => x.id === c.id)!;
      assert.equal(after.progress.startsWith("2 of 2 used"), true);
      // Ticked "use course" for the visit after the expiry: refused, said so, and not invoiced either.
      const r3 = await invoiceVisitsFor(owner(), { appointmentIds: [late], issue: true, useCourse: [late] });
      assert.ok(!r3.ok && /could not be used from its course and was not invoiced/.test(r3.error), r3.ok ? "ok" : r3.error);
      assert.ok(
        ok(await uninvoicedVisitsFor(owner())).visits.some((v) => v.appointmentId === late),
        "still on the list to invoice",
      );
      clock = Date.parse(utc("2026-11-10", "09:00"));
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
