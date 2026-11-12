/**
 * TESTS ONLY (run by ../pk06-expiry.test.ts on node:sqlite and PGlite and by workers/data-gateway/test/pk06-stack.test.ts on D1).
 * PK06 – expiry of courses and gift cards on node:sqlite and PGlite with the tenant-scope guard: the expiry day itself
 * still counts (UK date, also across the BST midnight); past it a course is used for nothing and a card spends nothing
 * even before the sweep; the nightly sweep marks them expired (a card's balance to 0 with an "expire" move, audited),
 * running it twice changes nothing, another clinic is untouched, moving a course's expiry brings it back, a spend put
 * back on an expired card is swept the next night. Fictional data only. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { courseSaleLine } from "../../../../modules/pms/billing/courses";
import { runBatch } from "../../../db/batch";
import { testCipher } from "../../../db/testing/databases";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { createCourseType, getCourseType, getPatientCourse, listPatientCourses, recordCourseUse, setCourseExpiry } from "../../../repos/pms/billing/courses";
import { clinicsWithExpiredItems, runExpirySweep, sweepExpiredForTenant } from "../../../repos/pms/billing/expiry";
import { getGiftCard, giftCardRedeemQueries, listGiftCardMoves } from "../../../repos/pms/billing/gift-cards";
import { createDraftInvoice, issueInvoice } from "../../../repos/pms/billing/invoices";
import { reversePayment } from "../../../repos/pms/billing/payments";
import { createService } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { unscopedStatements, type QueryLog } from "../../../repos/pms/testing/guarded-db";
import { testActor } from "../access";
import { courseOffersFor } from "../courses";
import { sellGiftCardFor } from "../gift-cards";
import { takePaymentFor } from "../writes";

export interface Pk06SuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-expiry";
const B = "harbour-expiry";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const appt = (n: number) => `appt_01JPK06EXPIRY0000000000${String(n).padStart(2, "0")}`;

export function definePk06ExpirySuite(label: string, factory: () => Promise<Pk06SuiteDb>): void {
  describe(`PK06 expiry and the sweep on ${label}`, () => {
    let db: Pk06SuiteDb;
    let ctx: RepoContext;
    let clock = "2026-11-02T10:00:00.000Z";
    const id: Record<string, string> = {};
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };
    const use = (courseId: string, n: number, usedOn: string, tenant = A, patient = id.patient, service = id.fu) =>
      recordCourseUse(ctx, tenant, { patientCourseId: courseId, appointmentId: appt(n), usedOn, patientId: patient, serviceId: service, caseId: null }, SEED);
    const visit = (n: number, date: string) => ({ visit: { appointmentId: appt(n), patientId: id.patient, serviceId: id.fu, caseId: null, date, startTime: null, status: "attended" }, billTo: "patient" as const, chargePence: 5500 });

    async function sellCourse(tenant: string, patient: string, typeId: string, issuedOn: string) {
      const type = (await getCourseType(ctx, tenant, typeId))!;
      const { invoice } = await createDraftInvoice(ctx, tenant, { patientId: patient, lines: [courseSaleLine(type)] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "course", refId: type.id }] });
      assert.ok((await issueInvoice(ctx, tenant, invoice.id, invoice.rev, { issuedOn }, SEED)).ok);
      return (await listPatientCourses(ctx, tenant, [patient])).find((c) => c.saleInvoiceId === invoice.id)!;
    }
    async function owing(pence: number) {
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ kind: "item", description: "Exercise class (fictional)", unitPricePence: pence }] }, SEED);
      assert.ok((await issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED)).ok);
      return invoice.id;
    }
    const spend = async (code: string, pence: number) => takePaymentFor(owner(), { patientId: id.patient, method: "gift_card", amountPence: pence, giftCardCode: code, allocations: [{ invoiceId: await owing(pence), amountPence: pence }] });
    const audits = async (tenant: string, action: string) => (await listAudit(ctx, tenant, { limit: 500 })).filter((e) => e.action === action).length;

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date(clock) };
      id.patient = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1990-04-02" }, SEED)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.type = (await createCourseType(ctx, A, { name: "3 follow-ups", serviceIds: [id.fu], sessions: 3, pricePence: 15000, validDays: 5 }, SEED)).id;
      id.course = (await sellCourse(A, id.patient, id.type, "2026-11-02")).id; // valid 02/11 – 06/11/2026
      const card = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 5000, issue: true }));
      id.card = card.giftCardId;
      id.code = card.code;
      // TEST ONLY: a short validity so the expiry falls inside the test's days (cards are sold for 24 months).
      await db.db.updateTable("pms_gift_cards").set({ expires_on: "2026-11-06" }).where("tenant_id", "=", A).where("id", "=", card.giftCardId).execute();
      // Clinic B: a course that expired on 06/11 too.
      id.patientB = (await createPatient(ctx, B, { firstName: "Ada", lastName: "Stone", dateOfBirth: "1985-03-04" }, SEED)).id;
      id.fuB = (await createService(ctx, B, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5000 }, SEED)).id;
      const typeB = (await createCourseType(ctx, B, { name: "B course", serviceIds: [id.fuB], sessions: 3, pricePence: 9000, validDays: 5 }, SEED)).id;
      id.courseB = (await sellCourse(B, id.patientB, typeB, "2026-11-02")).id;
    });
    after(async () => {
      await db?.close();
    });

    it("the expiry day itself counts: a visit is used from the course and the card spends on 06/11 (late evening, UK)", async () => {
      clock = "2026-11-06T23:30:00.000Z"; // 23:30 GMT on 06/11
      assert.equal((await courseOffersFor(ctx, A, [visit(1, "2026-11-06")])).size, 1, "offered");
      await use(id.course, 1, "2026-11-06");
      assert.equal((await getPatientCourse(ctx, A, id.course))?.sessionsUsed, 1);
      ok(await spend(id.code, 1000));
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 4000);
      assert.deepEqual(await sweepExpiredForTenant(ctx, A), { courses: 0, giftCards: 0, giftCardPence: 0 }, "nothing is swept on the expiry day");
    });

    it("the day after (UK): no use and no spend, before the sweep has run – the database refuses a stale spend too", async () => {
      clock = "2026-11-07T00:30:00.000Z";
      assert.equal((await getPatientCourse(ctx, A, id.course))?.status, "active", "not swept yet");
      assert.equal((await courseOffersFor(ctx, A, [visit(2, "2026-11-06")])).size, 0, "no offer past the expiry");
      await assert.rejects(use(id.course, 2, "2026-11-06"), /expired/, "even a visit dated on the last day");
      const r = await spend(id.code, 500);
      assert.ok(!r.ok && /expired/.test(r.error));
      // A spend prepared from a read before midnight (the card still "active" with £40): its balance change matches no row.
      const stale = (await getGiftCard(ctx, A, id.card))!;
      const results = await runBatch(ctx.db, [giftCardRedeemQueries(ctx, A, stale, 500, "pay_01JPK06STALE00000000000000", SEED, "2026-11-07T00:30:00.000Z")[0]]);
      assert.equal(Number(results[0]?.numAffectedRows ?? 0), 0);
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 4000);
    });

    it("the sweep: the course becomes expired, the card expires with its £40 taken off (an expire move, audited); twice changes nothing; clinic B untouched", async () => {
      const r = await sweepExpiredForTenant(ctx, A);
      assert.deepEqual(r, { courses: 1, giftCards: 1, giftCardPence: 4000 });
      const course = await getPatientCourse(ctx, A, id.course);
      assert.equal(course?.status, "expired");
      const card = await getGiftCard(ctx, A, id.card);
      assert.deepEqual([card?.status, card?.balancePence], ["expired", 0]);
      const moves = await listGiftCardMoves(ctx, A, id.card);
      assert.deepEqual(moves.map((m) => [m.kind, m.amountPence, m.balanceAfter]).slice(-1), [["expire", -4000, 0]]);
      assert.equal(await audits(A, "pms.course.expire"), 1);
      assert.equal(await audits(A, "pms.gift_card.expire"), 1);
      // Twice: nothing more.
      assert.deepEqual(await sweepExpiredForTenant(ctx, A), { courses: 0, giftCards: 0, giftCardPence: 0 });
      assert.equal((await getPatientCourse(ctx, A, id.course))?.rev, course?.rev);
      assert.equal((await listGiftCardMoves(ctx, A, id.card)).length, moves.length);
      assert.equal(await audits(A, "pms.course.expire"), 1);
      assert.equal(await audits(A, "pms.gift_card.expire"), 1);
      // Clinic B was not touched by clinic A's sweep.
      assert.equal((await getPatientCourse(ctx, B, id.courseB))?.status, "active");
      assert.equal(await audits(B, "pms.course.expire"), 0);
    });

    it("a spend put back after the expiry is swept the next night; moving a course's expiry brings it back into use", async () => {
      clock = "2026-11-08T10:00:00.000Z";
      const pay = (await listGiftCardMoves(ctx, A, id.card)).find((m) => m.kind === "redeem")!;
      assert.ok(await reversePayment(ctx, A, pay.paymentId!, { reason: "Taken by mistake" }, SEED));
      assert.deepEqual([(await getGiftCard(ctx, A, id.card))?.status, (await getGiftCard(ctx, A, id.card))?.balancePence], ["expired", 1000]);
      assert.deepEqual(await sweepExpiredForTenant(ctx, A), { courses: 0, giftCards: 1, giftCardPence: 1000 });
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 0);
      const c = (await getPatientCourse(ctx, A, id.course))!;
      assert.deepEqual(await setCourseExpiry(ctx, A, id.course, c.rev, "2026-12-31", SEED), { ok: true, rev: c.rev + 1 });
      assert.equal((await getPatientCourse(ctx, A, id.course))?.status, "active");
      await use(id.course, 3, "2026-11-08");
      assert.equal((await getPatientCourse(ctx, A, id.course))?.sessionsUsed, 2);
    });

    it("UK date across BST: an expiry of 01/07 is swept at 00:30 BST on 02/07 (23:30 UTC on 01/07), not an hour before", async () => {
      clock = "2026-06-20T10:00:00.000Z";
      const t = (await createCourseType(ctx, A, { name: "Summer block", serviceIds: [id.fu], sessions: 2, pricePence: 8000, validDays: 12 }, SEED)).id;
      const summer = await sellCourse(A, id.patient, t, "2026-06-20"); // valid to 01/07/2026
      assert.equal(summer.expiresOn, "2026-07-01");
      clock = "2026-07-01T22:30:00.000Z"; // 23:30 BST on 01/07
      assert.equal((await sweepExpiredForTenant(ctx, A)).courses, 0);
      clock = "2026-07-01T23:30:00.000Z"; // 00:30 BST on 02/07
      assert.equal((await sweepExpiredForTenant(ctx, A)).courses, 1);
      assert.equal((await getPatientCourse(ctx, A, summer.id))?.status, "expired");
      clock = "2026-11-08T10:00:00.000Z";
    });

    it("the nightly run finds every clinic with something to sweep (a cross-clinic read of ids) and sweeps each on its own", async () => {
      db.log?.pause(); // the one allowed cross-clinic read: which clinics have something past its expiry
      try {
        assert.deepEqual(await clinicsWithExpiredItems(ctx), [B]);
        const run = await runExpirySweep(ctx);
        assert.deepEqual([run.clinics, run.courses, run.giftCards, run.errors], [1, 1, 0, 0]);
        assert.deepEqual(await clinicsWithExpiredItems(ctx), []);
        assert.deepEqual([(await runExpirySweep(ctx)).clinics], [0], "a second run finds nothing");
      } finally {
        db.log?.resume();
      }
      assert.equal((await getPatientCourse(ctx, B, id.courseB))?.status, "expired");
      assert.equal(await audits(B, "pms.course.expire"), 1);
    });

    it("many at once: 30 expired cards go in batches inside the gateway's limit (100 statements), each once", async () => {
      // TEST ONLY: cards written directly (fictional, no codes anyone holds) to have more than one batch to sweep.
      for (let i = 0; i < 30; i++) {
        await db.db
          .insertInto("pms_gift_cards")
          .values({ tenant_id: A, id: `gcd_01JPK06BULK0000000000000${String(i).padStart(2, "0")}`, rev: 1, code_sha256: `bulk-${i}`, code_last4: "BULK", initial_pence: 100, balance_pence: 100, sold_on: "2026-01-01", expires_on: "2026-11-01", status: "active", created_at: clock, updated_at: clock } as never)
          .execute();
      }
      const r = await sweepExpiredForTenant(ctx, A);
      assert.deepEqual(r, { courses: 0, giftCards: 30, giftCardPence: 3000 });
      assert.deepEqual(await sweepExpiredForTenant(ctx, A), { courses: 0, giftCards: 0, giftCardPence: 0 });
      assert.equal(await audits(A, "pms.gift_card.expire"), 2 + 30);
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      if (db.log) assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}
