/**
 * Regression tests for the review of courses and gift cards (PK02/PK04, docs/clinic-system/courses-giftcards-products.md
 * §6–§7 "Review fixes"), on node:sqlite and PGlite with the tenant-scope guard. Every test starts from a fresh database.
 * Fictional clinics, patients and services only. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sql, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult, type RootOperationNode, type UnknownRow } from "kysely";
import { courseSaleLine } from "../../../modules/pms/billing/courses";
import { testCipher } from "../../db/testing/databases";
import type { RepoContext } from "../../repos/context";
import { cancelPatientCourse, courseCancelQuote } from "../../repos/pms/billing/course-cancel";
import { createCourseType, getPatientCourse, listPatientCourses, recordCourseUse, reverseCourseUse, updateCourseType } from "../../repos/pms/billing/courses";
import { createCreditNote, voidInvoice } from "../../repos/pms/billing/credit-notes";
import { getGiftCard, listGiftCardMoves } from "../../repos/pms/billing/gift-cards";
import { billingFigures, createDraftInvoice, getInvoice, issueInvoice, updateDraftInvoice } from "../../repos/pms/billing/invoices";
import { getPayment, recordPayment, removeAllocation, reversePayment } from "../../repos/pms/billing/payments";
import { coursesInstalled } from "../../repos/pms/billing/courses";
import { createService } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { testActor } from "./access";
import { sellGiftCardFor } from "./gift-cards";
import { BILLING_REPORTING_SOURCE } from "./reporting-source";
import { refundFor, takePaymentFor } from "./writes";

const A = "riverside-review";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const appt = (n: number) => `appt_01JREVIEW00000000000000${String(n).padStart(2, "0")}`;

/**
 * Makes every read of pms_course_uses come back empty – the moment between a check and the batch it guards, when a
 * use recorded by someone else is not seen yet. Writes (and the statements inside a batch) are untouched.
 */
function blindToCourseUses(): KyselyPlugin {
  const blind = new WeakSet<object>();
  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      if (args.node.kind === "SelectQueryNode" && JSON.stringify(args.node.from ?? {}).includes("pms_course_uses")) blind.add(args.queryId);
      return args.node;
    },
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return blind.has(args.queryId) ? { ...args.result, rows: [] } : args.result;
    },
  };
}

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`courses and gift cards – review fixes on ${label}`, () => {
    const statements: string[] = [];

    async function fresh() {
      const g = await factory();
      const ctx: RepoContext = { db: g.db, cipher: testCipher(), now: () => new Date("2026-11-10T09:00:00.000Z") };
      const patient = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1990-04-02" }, SEED)).id;
      const fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
      const done = async () => {
        statements.push(...g.log.statements);
        await g.close();
      };
      return { g, ctx, patient, fu, owner, done };
    }

    async function soldCourse(ctx: RepoContext, patient: string, fu: string, sessions: number, pricePence: number) {
      const t = await createCourseType(ctx, A, { name: `${sessions} sessions`, serviceIds: [fu], sessions, pricePence }, SEED);
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [courseSaleLine(t)] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "course", refId: t.id }] });
      const issued = await issueInvoice(ctx, A, invoice.id, invoice.rev, { issuedOn: "2026-11-02" }, SEED);
      assert.ok(issued.ok);
      const [course] = await listPatientCourses(ctx, A, [patient]);
      return { type: t, invoice: issued.invoice, course };
    }

    const use = (ctx: RepoContext, courseId: string, patient: string, fu: string, n: number) =>
      recordCourseUse(ctx, A, { patientCourseId: courseId, appointmentId: appt(n), usedOn: "2026-11-05", patientId: patient, serviceId: fu, caseId: null }, SEED);
    const visitLine = (fu: string, n: number) => ({ kind: "service" as const, serviceId: fu, appointmentId: appt(n), serviceOn: "2026-11-05", unitPricePence: 5500 });

    it("finding 2: a course sale voided after a visit was used – the use can be reversed and the visit invoiced", async () => {
      const { ctx, patient, fu, done } = await fresh();
      const { invoice, course } = await soldCourse(ctx, patient, fu, 3, 15000);
      const u = await use(ctx, course.id, patient, fu, 1);
      await voidInvoice(ctx, A, invoice.id, { reason: "Sold by mistake" }, SEED);
      assert.equal((await getPatientCourse(ctx, A, course.id))?.status, "cancelled");
      await assert.rejects(createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 1)] }, SEED), /used from a course/, "still used until reversed");
      assert.deepEqual(await reverseCourseUse(ctx, A, u.id, SEED), { reversed: true, patientCourseId: course.id });
      const c = await getPatientCourse(ctx, A, course.id);
      assert.deepEqual([c?.status, c?.sessionsUsed], ["cancelled", 0], "the course stays closed; the use is kept, marked reversed");
      const { invoice: billed } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 1)] }, SEED);
      assert.equal(billed.lines[0].appointmentId, appt(1), "the visit is billable again");
      await done();
    });

    it("finding 2: a course line credited in full after uses – each used visit can be reversed and invoiced", async () => {
      const { ctx, patient, fu, done } = await fresh();
      const { invoice, course } = await soldCourse(ctx, patient, fu, 3, 15000);
      const u1 = await use(ctx, course.id, patient, fu, 1);
      const u2 = await use(ctx, course.id, patient, fu, 2);
      await createCreditNote(ctx, A, { invoiceId: invoice.id, lines: [{ invoiceLineId: invoice.lines[0].id, totalPence: 15000 }], reason: "Course refunded in full" }, SEED);
      assert.equal((await getPatientCourse(ctx, A, course.id))?.status, "cancelled");
      for (const u of [u1, u2]) assert.equal((await reverseCourseUse(ctx, A, u.id, SEED)).reversed, true);
      await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 1), visitLine(fu, 2)] }, SEED);
      await done();
    });

    it("finding 3: pro rata after a part credit – (line total − already credited) × unused ÷ total", async () => {
      const { ctx, patient, fu, done } = await fresh();
      const { invoice, course } = await soldCourse(ctx, patient, fu, 6, 60000);
      // A 50 % discount agreed after the sale: the patient was charged £300 for 6 sessions.
      await createCreditNote(ctx, A, { invoiceId: invoice.id, lines: [{ invoiceLineId: invoice.lines[0].id, totalPence: 30000 }], reason: "Half price agreed" }, SEED);
      for (let n = 1; n <= 3; n++) await use(ctx, course.id, patient, fu, n);
      assert.deepEqual(await courseCancelQuote(ctx, A, course.id), { defaultPence: 15000, maxPence: 30000 });
      const r = await cancelPatientCourse(ctx, A, course.id, { reason: "Moved away" }, SEED);
      assert.equal(r.creditNote?.totalPence, 15000);
      assert.equal((await getInvoice(ctx, A, invoice.id))?.creditedPence, 45000);
      await done();
    });

    it("snapshot: editing the course type between the draft and its issue does not change what was sold", async () => {
      const { ctx, patient, fu, done } = await fresh();
      const other = (await createService(ctx, A, { name: "Sports massage", category: "treatment", durationMinutes: 45, defaultPricePence: 6000 }, SEED)).id;
      const t = await createCourseType(ctx, A, { name: "6 follow-ups", serviceIds: [fu], sessions: 6, pricePence: 27000, validDays: 90 }, SEED);
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [courseSaleLine(t)] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "course", refId: t.id }] });
      assert.deepEqual(await updateCourseType(ctx, A, t.id, t.rev, { name: "10 massages", serviceIds: [other], sessions: 10, pricePence: 27000, validDays: 365 }, SEED), { ok: true, rev: 2 });
      assert.ok((await issueInvoice(ctx, A, invoice.id, invoice.rev, { issuedOn: "2026-11-02" }, SEED)).ok);
      const [c] = await listPatientCourses(ctx, A, [patient]);
      assert.deepEqual([c.sessionsTotal, c.serviceIds, c.expiresOn], [6, [fu], "2027-01-30"], "the sessions, services and validity sold on the draft");
      await use(ctx, c.id, patient, fu, 1);
      await assert.rejects(recordCourseUse(ctx, A, { patientCourseId: c.id, appointmentId: appt(2), usedOn: "2026-11-05", patientId: patient, serviceId: other, caseId: null }, SEED), /does not cover/);
      await done();
    });

    it("finding 7: a visit used from a course just after the invoice's checks is refused inside the invoice's batch", async () => {
      const { ctx, patient, fu, done } = await fresh();
      const { course } = await soldCourse(ctx, patient, fu, 3, 15000);
      await use(ctx, course.id, patient, fu, 1);
      const racing: RepoContext = { ...ctx, db: ctx.db.withPlugin(blindToCourseUses()) };
      await assert.rejects(createDraftInvoice(racing, A, { patientId: patient, lines: [visitLine(fu, 1)] }, SEED), /used from a course/);
      // Replacing a draft's lines with that visit is refused the same way.
      const { invoice: draft } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [{ kind: "item", description: "Exercise band", unitPricePence: 800 }] }, SEED);
      await assert.rejects(updateDraftInvoice(racing, A, draft.id, draft.rev, { lines: [visitLine(fu, 1)] }, SEED), /used from a course/);
      assert.equal((await getInvoice(ctx, A, draft.id))?.lines.length, 1, "the draft is as it was");
      // And the other way round: a visit on an invoice cannot be used from the course (the use reads invoice lines in its batch).
      await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 2)] }, SEED);
      await assert.rejects(use(ctx, course.id, patient, fu, 2), /already invoiced/);
      await done();
    });

    async function giftCardAnd(ctx: RepoContext, owner: () => ReturnType<typeof testActor>, patient: string, fu: string, valuePence = 5000) {
      const sold = await sellGiftCardFor(owner(), patient, { amountPence: valuePence, issue: true });
      assert.ok(sold.ok);
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [{ kind: "service", serviceId: fu, serviceOn: "2026-11-09", unitPricePence: 5500 }] }, SEED);
      assert.ok((await issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED)).ok);
      return { code: sold.value.code, cardId: sold.value.giftCardId, saleInvoiceId: sold.value.invoiceId, treatment: invoice.id };
    }

    it("finding 4: a gift-card payment is allocated in full – nothing of it is kept on account", async () => {
      const { ctx, patient, fu, owner, done } = await fresh();
      const { code, cardId, treatment } = await giftCardAnd(ctx, owner, patient, fu);
      // £55 owed on the treatment, £50 on the card, £20 asked for but only £10 put on the invoice.
      const r = await takePaymentFor(owner(), { patientId: patient, method: "gift_card", amountPence: 2000, giftCardCode: code, allocations: [{ invoiceId: treatment, amountPence: 1000 }] });
      assert.ok(!r.ok && /nothing is kept on account/.test(r.error), r.ok ? "taken" : r.error);
      assert.equal((await getGiftCard(ctx, A, cardId))?.balancePence, 5000, "the card is untouched");
      // The database refuses it too (a caller that skips the check).
      const card = (await getGiftCard(ctx, A, cardId))!;
      const { giftCardRedeemQueries } = await import("../../repos/pms/billing/gift-cards");
      await assert.rejects(
        recordPayment(ctx, A, { payerKind: "patient", patientId: patient, receivedOn: "2026-11-10", method: "other", amountPence: 2000, allocations: [{ invoiceId: treatment, amountPence: 1000 }] }, SEED, {
          extra: (paymentId, at) => giftCardRedeemQueries(ctx, A, card, 2000, paymentId, SEED, at),
          extraRefusal: "refused",
        }),
        /refused/,
      );
      assert.equal((await getGiftCard(ctx, A, cardId))?.balancePence, 5000);
      await done();
    });

    it("finding 4: gift-card money is never refunded as cash; reversing the gift-card payment puts it back on the card", async () => {
      const { ctx, patient, fu, owner, done } = await fresh();
      const { code, cardId, treatment } = await giftCardAnd(ctx, owner, patient, fu);
      const paid = await takePaymentFor(owner(), { patientId: patient, method: "gift_card", amountPence: 5000, giftCardCode: code, allocations: [{ invoiceId: treatment, amountPence: 5000 }] });
      assert.ok(paid.ok);
      const cash = await takePaymentFor(owner(), { patientId: patient, method: "cash", amountPence: 500, allocations: [{ invoiceId: treatment, amountPence: 500 }] });
      assert.ok(cash.ok);
      // The visit is credited: £55 is owed back – £50 of it came from the card.
      await createCreditNote(ctx, A, { invoiceId: treatment, lines: [{ invoiceLineId: (await getInvoice(ctx, A, treatment))!.lines[0].id, totalPence: 5500 }], reason: "Session cancelled by the clinic" }, SEED);
      for (const method of ["cash", "card", "bank_transfer"] as const) {
        const r = await refundFor(owner(), treatment, { amountPence: 5500, method, reason: "Session cancelled" });
        assert.ok(!r.ok && /never paid out as money/.test(r.error) && /reverse that payment/.test(r.error), r.ok ? "refunded" : r.error);
      }
      const part = await refundFor(owner(), treatment, { amountPence: 500, method: "cash", reason: "Session cancelled" });
      assert.ok(part.ok, part.ok ? "" : part.error);
      // Taking the gift-card payment off the invoice (onto the account) is refused as well.
      const allocation = (await getPayment(ctx, A, paid.value.paymentId as string))!.allocations[0];
      await assert.rejects(removeAllocation(ctx, A, allocation.id, SEED), /Reverse the payment instead/);
      assert.ok(await reversePayment(ctx, A, paid.value.paymentId as string, { reason: "Session cancelled" }, SEED));
      assert.equal((await getGiftCard(ctx, A, cardId))?.balancePence, 5000, "back on the card");
      await done();
    });

    it("finding 5: Taken today and money received leave gift-card spends out (told by the card's move, not the method)", async () => {
      const { ctx, patient, fu, owner, done } = await fresh();
      const { code, saleInvoiceId, treatment } = await giftCardAnd(ctx, owner, patient, fu);
      // The card's own sale paid in cash (£50 taken), then £30 of it spent on the treatment and £25 in cash.
      assert.ok((await takePaymentFor(owner(), { patientId: patient, method: "cash", amountPence: 5000, allocations: [{ invoiceId: saleInvoiceId, amountPence: 5000 }] })).ok);
      assert.ok((await takePaymentFor(owner(), { patientId: patient, method: "gift_card", amountPence: 3000, giftCardCode: code, allocations: [{ invoiceId: treatment, amountPence: 3000 }] })).ok);
      assert.ok((await takePaymentFor(owner(), { patientId: patient, method: "cash", amountPence: 2500, allocations: [{ invoiceId: treatment, amountPence: 2500 }] })).ok);
      // A plain "other" payment that is NOT a gift card still counts.
      await recordPayment(ctx, A, { payerKind: "patient", patientId: patient, receivedOn: "2026-11-10", method: "other", amountPence: 100, reference: "Gift card voucher (paper)" }, SEED);
      const f = await billingFigures(ctx, A);
      assert.equal(f.takenTodayPence, 7600);
      assert.deepEqual(f.takenTodayByMethod, { cash: 7500, other: 100 });
      const facts = await BILLING_REPORTING_SOURCE.revenueFacts(ctx, A, { from: "2026-11-01", to: "2026-11-30", siteIds: null } as never);
      assert.equal(
        facts.filter((x) => x.kind === "received").reduce((a, x) => a + x.amountPence, 0),
        7600,
      );
      await done();
    });

    it("finding 6: when issuing fails after the card is made, the one-time code still comes back", async () => {
      const { ctx, patient, owner, done } = await fresh();
      const refused = await sellGiftCardFor(owner(), patient, { amountPence: 2500, issue: true }, { issue: async () => ({ ok: false, reason: "conflict", currentRev: 9 }) });
      assert.ok(refused.ok, refused.ok ? "" : refused.error);
      assert.match(refused.value.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.equal(refused.value.issued, false);
      assert.match(String(refused.value.issueProblem), /could not be issued/);
      assert.equal((await getGiftCard(ctx, A, refused.value.giftCardId))?.status, "pending");
      const threw = await sellGiftCardFor(owner(), patient, { amountPence: 2500, issue: true }, {
        issue: async () => {
          throw new Error("the database went away (simulated)");
        },
      });
      assert.ok(threw.ok && threw.value.code.length === 14 && threw.value.issueProblem !== null);
      await done();
    });

    it("minor: the unspent part of a partly spent gift card's sale can be credited (balance reduced); no more than that", async () => {
      const { ctx, patient, fu, owner, done } = await fresh();
      const { code, cardId, saleInvoiceId, treatment } = await giftCardAnd(ctx, owner, patient, fu);
      assert.ok((await takePaymentFor(owner(), { patientId: patient, method: "gift_card", amountPence: 3000, giftCardCode: code, allocations: [{ invoiceId: treatment, amountPence: 3000 }] })).ok);
      const sale = (await getInvoice(ctx, A, saleInvoiceId))!;
      await assert.rejects(createCreditNote(ctx, A, { invoiceId: sale.id, lines: [{ invoiceLineId: sale.lines[0].id, totalPence: 2500 }], reason: "Too much" }, SEED), /Only £20\.00 of this gift card is unspent/);
      await createCreditNote(ctx, A, { invoiceId: sale.id, lines: [{ invoiceLineId: sale.lines[0].id, totalPence: 500 }], reason: "Part of the card back" }, SEED);
      let card = await getGiftCard(ctx, A, cardId);
      assert.deepEqual([card?.status, card?.balancePence], ["active", 1500]);
      await createCreditNote(ctx, A, { invoiceId: sale.id, lines: [{ invoiceLineId: sale.lines[0].id, totalPence: 1500 }], reason: "The rest of the card back" }, SEED);
      card = await getGiftCard(ctx, A, cardId);
      assert.deepEqual([card?.status, card?.balancePence], ["cancelled", 0]);
      assert.deepEqual(
        (await listGiftCardMoves(ctx, A, cardId)).map((m) => [m.kind, m.amountPence, m.balanceAfter]),
        [
          ["sale", 5000, 5000],
          ["redeem", -3000, 2000],
          ["adjust", -500, 1500],
          ["adjust", -1500, 0],
        ],
      );
      await done();
    });

    it("minor: reversing a gift-card payment on a cancelled card is refused, not silently lost", async () => {
      const { ctx, patient, fu, owner, done } = await fresh();
      const { code, cardId, saleInvoiceId, treatment } = await giftCardAnd(ctx, owner, patient, fu);
      const paid = await takePaymentFor(owner(), { patientId: patient, method: "gift_card", amountPence: 3000, giftCardCode: code, allocations: [{ invoiceId: treatment, amountPence: 3000 }] });
      assert.ok(paid.ok);
      const sale = (await getInvoice(ctx, A, saleInvoiceId))!;
      await createCreditNote(ctx, A, { invoiceId: sale.id, lines: [{ invoiceLineId: sale.lines[0].id, totalPence: 2000 }], reason: "Unspent part back" }, SEED);
      assert.equal((await getGiftCard(ctx, A, cardId))?.status, "cancelled");
      await assert.rejects(reversePayment(ctx, A, paid.value.paymentId as string, { reason: "Wrong card" }, SEED), /cannot be put back on the card/);
      assert.equal((await getPayment(ctx, A, paid.value.paymentId as string))?.status, "recorded", "the payment stays as it was");
      await done();
    });

    it("before migrations 0231–0238: invoices (visits and items), payments, takings, refunds, credits, voids and drafts work as before", async () => {
      const { g, ctx, patient, fu, owner, done } = await fresh();
      for (const t of ["pms_course_uses", "pms_patient_courses", "pms_course_types", "pms_gift_card_moves", "pms_gift_cards", "pms_stock_moves", "pms_products", "pms_invoice_line_refs"]) {
        await sql.raw(`drop table ${t}${label.startsWith("Postgres") ? " cascade" : ""}`).execute(g.db);
      }
      assert.equal(await coursesInstalled(ctx, A), false);
      const { invoice: d1 } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 1), { kind: "item", description: "Exercise band", unitPricePence: 800 }] }, SEED);
      const i1 = await issueInvoice(ctx, A, d1.id, d1.rev, {}, SEED);
      assert.ok(i1.ok);
      const paid = await takePaymentFor(owner(), { patientId: patient, method: "cash", amountPence: 6300, allocations: [{ invoiceId: d1.id, amountPence: 6300 }] });
      assert.ok(paid.ok);
      assert.equal((await billingFigures(ctx, A)).takenTodayPence, 6300);
      await createCreditNote(ctx, A, { invoiceId: d1.id, lines: [{ invoiceLineId: i1.invoice.lines[1].id, totalPence: 800 }], reason: "Band returned" }, SEED);
      assert.ok((await refundFor(owner(), d1.id, { amountPence: 800, method: "cash", reason: "Band returned" })).ok);
      const { invoice: d3 } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 4)] }, SEED);
      assert.ok((await issueInvoice(ctx, A, d3.id, d3.rev, {}, SEED)).ok);
      const second = await takePaymentFor(owner(), { patientId: patient, method: "card_now", amountPence: 5500, allocations: [{ invoiceId: d3.id, amountPence: 5500 }] });
      assert.ok(second.ok);
      const allocation = (await getPayment(ctx, A, second.value.paymentId as string))!.allocations[0];
      assert.equal(await removeAllocation(ctx, A, allocation.id, SEED), true);
      assert.equal(await reversePayment(ctx, A, second.value.paymentId as string, { reason: "Wrong patient" }, SEED), true);
      await voidInvoice(ctx, A, d3.id, { reason: "Mistake" }, SEED);
      const { invoice: d2 } = await createDraftInvoice(ctx, A, { patientId: patient, lines: [visitLine(fu, 2)] }, SEED);
      assert.equal((await updateDraftInvoice(ctx, A, d2.id, d2.rev, { lines: [visitLine(fu, 3)] }, SEED)).ok, true);
      await done();
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
