/**
 * TESTS ONLY: the courses repository suite (PK02, ../courses-repos.test.ts), run unchanged on node:sqlite and PGlite.
 * Fictional clinics, patients and services only. Ends with offboarding and the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { courseSaleLine } from "../../../../../modules/pms/billing/courses";
import { testCipher } from "../../../../db/testing/databases";
import { runBatch } from "../../../../db/batch";
import { COURSE_CASCADE_DELETED_TABLES } from "../../../../db/pms-schema/billing";
import { countPmsRows, deletePmsQueries } from "../../../../pms/offboard";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createCase } from "../../cases";
import { createService } from "../../directory";
import { createPatient } from "../../patients";
import { unscopedStatements, type GuardedDb } from "../../testing/guarded-db";
import { cancelPatientCourse, courseCancelQuote } from "../course-cancel";
import {
  courseUsedAppointmentIds,
  createCourseType,
  getPatientCourse,
  listCourseTypes,
  listCourseUses,
  listPatientCourses,
  pendingCourseSales,
  recordCourseUse,
  reverseCourseUse,
  setCourseExpiry,
  updateCourseType,
} from "../courses";
import { voidInvoice } from "../credit-notes";
import { cancelDraftInvoice, createDraftInvoice, getInvoice, issueInvoice, updateDraftInvoice } from "../invoices";

const A = "riverside-courses";
const B = "harbour-courses";
const ACTOR = { userId: "user_admin_01", sessionId: "sess_01" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };
const appt = (n: number) => `appt_01JCOURSE00000000000000${String(n).padStart(2, "0")}`;

export function defineCoursesRepoSuite(label: string, factory: () => Promise<GuardedDb>): void {
  describe(`course repositories on ${label}`, () => {
    let suite: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};

    async function sell(typeId: string, patientId = id.patient, caseId: string | null = null) {
      const types = await listCourseTypes(ctx, A, { includeArchived: true });
      const t = types.find((x) => x.id === typeId);
      assert.ok(t);
      const { invoice } = await createDraftInvoice(ctx, A, { patientId, caseId, lines: [courseSaleLine(t)] }, ACTOR, { lineRefs: [{ lineIndex: 0, refType: "course", refId: typeId }] });
      return invoice;
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date("2026-11-10T09:00:00.000Z") };
      id.fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, ACTOR)).id;
      id.massage = (await createService(ctx, A, { name: "Sports massage", category: "treatment", durationMinutes: 45, defaultPricePence: 6000 }, ACTOR)).id;
      id.ia = (await createService(ctx, A, { name: "Initial assessment", category: "initial", durationMinutes: 45, defaultPricePence: 7500 }, ACTOR)).id;
      id.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30 }, ACTOR_B)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1990-04-02" }, ACTOR)).id;
      id.patient2 = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19" }, ACTOR)).id;
      id.case = (await createCase(ctx, A, { patientId: id.patient, title: "Neck", openedOn: "2026-10-01" }, ACTOR)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("course types: add, change, archive; services must be the clinic's; clinic B sees none", async () => {
      const t = await createCourseType(ctx, A, { name: "6 follow-ups", serviceIds: [id.fu, id.massage], sessions: 6, pricePence: 27000, validDays: 180 }, ACTOR);
      assert.deepEqual([t.rev, t.sessions, t.pricePence, t.validDays, t.vatCode, t.active, t.serviceIds.length], [1, 6, 27000, 180, "exempt", true, 2]);
      id.six = t.id;
      id.three = (await createCourseType(ctx, A, { name: "3 sessions", serviceIds: [id.fu], sessions: 3, pricePence: 15000, validDays: null }, ACTOR)).id;
      await assert.rejects(createCourseType(ctx, A, { name: "Bad", serviceIds: [id.svcB], sessions: 2, pricePence: 100 }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      await assert.rejects(createCourseType(ctx, A, { name: "", serviceIds: [id.fu], sessions: 0, pricePence: 100 }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      const archived = (await createCourseType(ctx, A, { name: "Old course", serviceIds: [id.fu], sessions: 4, pricePence: 100 }, ACTOR)).id;
      const r = await updateCourseType(ctx, A, archived, 1, { name: "Old course", serviceIds: [id.fu], sessions: 4, pricePence: 100, active: false }, ACTOR);
      assert.deepEqual(r, { ok: true, rev: 2 });
      assert.equal((await updateCourseType(ctx, A, archived, 1, { name: "x", serviceIds: [id.fu], sessions: 4, pricePence: 1 }, ACTOR)).ok, false, "a stale revision changes nothing");
      assert.deepEqual(
        (await listCourseTypes(ctx, A)).map((x) => x.name),
        ["3 sessions", "6 follow-ups"],
      );
      assert.equal((await listCourseTypes(ctx, A, { includeArchived: true })).length, 3);
      assert.equal((await listCourseTypes(ctx, B)).length, 0);
      const audit = (await listAudit(ctx, A, { limit: 50 })).map((e) => e.action);
      assert.equal(audit.filter((a) => a === "pms.course_type.create").length, 3);
      assert.equal(audit.filter((a) => a === "pms.course_type.update").length, 1);
    });

    it("selling: a draft with an item line and its reference; nothing starts until the invoice is issued", async () => {
      const draft = await sell(id.six);
      assert.equal(draft.lines[0].kind, "item");
      assert.equal(draft.totalPence, 27000);
      assert.deepEqual(
        (await pendingCourseSales(ctx, A, id.patient)).map((p) => p.courseTypeId),
        [id.six],
      );
      assert.equal((await listPatientCourses(ctx, A, [id.patient])).length, 0, "a draft starts no course");
      await assert.rejects(updateDraftInvoice(ctx, A, draft.id, draft.rev, { lines: [{ kind: "item", description: "Something else", unitPricePence: 100 }] }, ACTOR), /sells a course/);
      await assert.rejects(createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ ...courseSaleLine({ name: "x", pricePence: 1, vatCode: "exempt" }), quantity: 2 } as never] }, ACTOR, { lineRefs: [{ lineIndex: 0, refType: "course", refId: id.six }] }), /one to a line/);
      const issued = await issueInvoice(ctx, A, draft.id, draft.rev, { issuedOn: "2026-11-02" }, ACTOR);
      assert.ok(issued.ok);
      const [course] = await listPatientCourses(ctx, A, [id.patient]);
      assert.deepEqual([course.status, course.sessionsTotal, course.sessionsUsed, course.soldOn, course.expiresOn, course.name, course.saleInvoiceId], ["active", 6, 0, "2026-11-02", "2027-04-30", "6 follow-ups", draft.id]);
      assert.equal((await pendingCourseSales(ctx, A, id.patient)).length, 0);
      id.course = course.id;
      id.saleInvoice = draft.id;
      const actions = (await listAudit(ctx, A, { limit: 100 })).map((e) => e.action);
      assert.ok(actions.includes("pms.course.sell") && actions.includes("pms.course.start"));
      // A cancelled draft starts nothing and leaves nothing pending.
      const other = await sell(id.three, id.patient2);
      assert.ok((await cancelDraftInvoice(ctx, A, other.id, other.rev, ACTOR)).ok);
      assert.equal((await pendingCourseSales(ctx, A, id.patient2)).length, 0);
      assert.equal((await listPatientCourses(ctx, A, [id.patient2])).length, 0);
    });

    it("using sessions: one per visit, covered services only, never past the last session or the expiry; reverse puts it back", async () => {
      const use = (n: number, over: Partial<{ serviceId: string; usedOn: string; patientId: string; caseId: string | null }> = {}) =>
        recordCourseUse(ctx, A, { patientCourseId: id.course, appointmentId: appt(n), usedOn: "2026-11-05", patientId: id.patient, serviceId: id.fu, caseId: null, ...over }, ACTOR);
      const first = await use(1);
      await assert.rejects(use(1), /already used/);
      await assert.rejects(use(2, { serviceId: id.ia }), /does not cover/);
      await assert.rejects(use(2, { patientId: id.patient2 }), /another patient/);
      await assert.rejects(use(2, { usedOn: "2027-05-02" }), /expired/);
      for (let n = 2; n <= 6; n++) await use(n, { serviceId: n % 2 ? id.fu : id.massage });
      let c = await getPatientCourse(ctx, A, id.course);
      assert.deepEqual([c?.status, c?.sessionsUsed], ["used_up", 6]);
      await assert.rejects(use(7), (e: unknown) => e instanceof RepoInputError);
      assert.deepEqual(Array.from(await courseUsedAppointmentIds(ctx, A, [appt(1), appt(7)])), [appt(1)]);
      // A visit used from the course cannot be invoiced too.
      await assert.rejects(
        createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ kind: "service", serviceId: id.fu, appointmentId: appt(1), serviceOn: "2026-11-05", unitPricePence: 5500 }] }, ACTOR),
        /used from a course/,
      );
      // Reverse: the session comes back, the course is active again, the visit can be invoiced.
      assert.deepEqual(await reverseCourseUse(ctx, A, first.id, ACTOR), { reversed: true, patientCourseId: id.course });
      assert.equal((await reverseCourseUse(ctx, A, first.id, ACTOR)).reversed, false, "only once");
      c = await getPatientCourse(ctx, A, id.course);
      assert.deepEqual([c?.status, c?.sessionsUsed], ["active", 5]);
      assert.equal((await courseUsedAppointmentIds(ctx, A, [appt(1)])).size, 0);
      // A visit already on an invoice cannot be used from the course.
      const billed = await createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ kind: "service", serviceId: id.fu, appointmentId: appt(8), serviceOn: "2026-11-06", unitPricePence: 5500 }] }, ACTOR);
      await assert.rejects(use(8), /already invoiced/);
      assert.ok((await cancelDraftInvoice(ctx, A, billed.invoice.id, billed.invoice.rev, ACTOR)).ok);
      await use(8);
      const uses = await listCourseUses(ctx, A, [id.course]);
      assert.equal(uses.length, 7);
      assert.equal(uses.filter((u) => u.reversedAt === null).length, 6);
      // Clinic B: no access to A's course.
      await assert.rejects(recordCourseUse(ctx, B, { patientCourseId: id.course, appointmentId: appt(9), usedOn: "2026-11-05", patientId: id.patient, serviceId: id.fu, caseId: null }, ACTOR_B), /does not exist/);
      assert.equal((await listPatientCourses(ctx, B, [id.patient])).length, 0);
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.equal(audit.filter((e) => e.action === "pms.course.use").length, 7);
      assert.equal(audit.filter((e) => e.action === "pms.course.use_reverse").length, 1);
    });

    it("cancelling: the unused sessions credited pro rata on the sale line (editable), the course closed once", async () => {
      const draft = await sell(id.three);
      assert.ok((await issueInvoice(ctx, A, draft.id, draft.rev, { issuedOn: "2026-11-03" }, ACTOR)).ok);
      const course = (await listPatientCourses(ctx, A, [id.patient])).find((c) => c.saleInvoiceId === draft.id);
      assert.ok(course && course.expiresOn === null, "no expiry");
      await recordCourseUse(ctx, A, { patientCourseId: course.id, appointmentId: appt(20), usedOn: "2026-11-04", patientId: id.patient, serviceId: id.fu, caseId: null }, ACTOR);
      assert.deepEqual(await courseCancelQuote(ctx, A, course.id), { defaultPence: 10000, maxPence: 15000 });
      await assert.rejects(cancelPatientCourse(ctx, A, course.id, { reason: "Moved away", creditPence: 15001 }, ACTOR), /At most 15000/);
      const r = await cancelPatientCourse(ctx, A, course.id, { reason: "Moved away" }, ACTOR);
      assert.equal(r.course.status, "cancelled");
      assert.equal(r.creditNote?.totalPence, 10000);
      assert.equal(r.course.cancelCreditNoteId, r.creditNote?.id);
      const inv = await getInvoice(ctx, A, draft.id);
      assert.equal(inv?.creditedPence, 10000);
      await assert.rejects(cancelPatientCourse(ctx, A, course.id, { reason: "Again" }, ACTOR), /already cancelled/);
      await assert.rejects(recordCourseUse(ctx, A, { patientCourseId: course.id, appointmentId: appt(21), usedOn: "2026-11-04", patientId: id.patient, serviceId: id.fu, caseId: null }, ACTOR), /cancelled/);
      const audit = (await listAudit(ctx, A, { limit: 300 })).filter((e) => e.action === "pms.course.cancel");
      assert.equal(audit.length, 1);
      assert.equal((audit[0].detail as { creditPence: number }).creditPence, 10000);
    });

    it("voiding the invoice that sold a course closes the course; a case course covers only its case", async () => {
      const draft = await sell(id.three, id.patient, id.case);
      const issued = await issueInvoice(ctx, A, draft.id, draft.rev, { issuedOn: "2026-11-04" }, ACTOR);
      assert.ok(issued.ok);
      const course = (await listPatientCourses(ctx, A, [id.patient])).find((c) => c.saleInvoiceId === draft.id);
      assert.ok(course && course.caseId === id.case);
      await assert.rejects(recordCourseUse(ctx, A, { patientCourseId: course.id, appointmentId: appt(30), usedOn: "2026-11-05", patientId: id.patient, serviceId: id.fu, caseId: null }, ACTOR), /another case/);
      await voidInvoice(ctx, A, draft.id, { reason: "Sold by mistake" }, ACTOR);
      assert.equal((await getPatientCourse(ctx, A, course.id))?.status, "cancelled");
    });

    it("expiry: moved by hand (audited with the old and new date), never before the sale", async () => {
      const c = (await getPatientCourse(ctx, A, id.course))!;
      await assert.rejects(setCourseExpiry(ctx, A, c.id, c.rev, "2026-01-01", ACTOR), /before the sale/);
      assert.deepEqual(await setCourseExpiry(ctx, A, c.id, c.rev, "2027-08-31", ACTOR), { ok: true, rev: c.rev + 1 });
      assert.equal((await setCourseExpiry(ctx, A, c.id, c.rev, null, ACTOR)).ok, false, "stale");
      assert.equal((await getPatientCourse(ctx, A, c.id))?.expiresOn, "2027-08-31");
      const row = (await listAudit(ctx, A, { limit: 300 })).find((e) => e.action === "pms.course.expiry");
      assert.deepEqual(row?.detail, { from: "2027-04-30", to: "2027-08-31" });
    });

    it("offboarding: courses, uses and line references go with their parents – none is named, none is left", async () => {
      const before = await countPmsRows(suite.db, A);
      for (const t of COURSE_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows to begin with`);
      const queries = deletePmsQueries(suite.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of COURSE_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
      await runBatch(suite.db, queries);
      assert.deepEqual(await countPmsRows(suite.db, A), {}, "nothing of clinic A is left");
      assert.ok(Object.keys(await countPmsRows(suite.db, B)).length > 0, "clinic B untouched");
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
