/**
 * TESTS ONLY: the billing server layer (src/server/pms/billing/{views,writes}.ts – what the billing screens call)
 * with the diary's visit adapter, run unchanged on node:sqlite and PGlite (../billing-service.test.ts) and on D1
 * through the gateway (workers/data-gateway/test/pms-billing-stack.test.ts). With a query log it ends with the
 * tenant-scope guard.
 *
 * Covers (M5): the visit source lists completed visits and fee-flagged DNA / late cancellations only (never arrived
 * or in treatment, never another clinic's); invoicing visits makes per-payer drafts with the excess split; the
 * authorisation's sessions are counted once (by the diary) and its value by billing; issue / part payment by cash /
 * card on file / payment link (test-mode provider stand-in); remittance with a short payment written off and one
 * moved to the patient; void refused with payments, allowed without; a credit note gives the balance back; refund
 * to the card; statement and aged debt; roles (reception, clinician read-only, owner); site scope; audit rows in
 * the same batch; clinic isolation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { listCreditNotesForInvoice } from "../../../repos/pms/billing/credit-notes";
import { getInvoice, listInvoicesPage } from "../../../repos/pms/billing/invoices";
import { updateBillingSettings } from "../../../repos/pms/billing/settings";
import { createAuthorisation, createCase, getAuthorisation } from "../../../repos/pms/cases";
import { bulkCreateDiaryItems, setAppointmentStatus } from "../../../repos/pms/diary/appointments";
import { createPractitioner, createService, createSite } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { createPriceList, setPriceListItem } from "../../../repos/pms/price-lists";
import { createReferrer } from "../../../repos/pms/referrers";
import type { QueryLog } from "../../../repos/pms/testing/guarded-db";
import { unscopedStatements } from "../../../repos/pms/testing/guarded-db";
import { testActor } from "../access";
import type { PaymentLinkProvider } from "../payments";
import { DIARY_VISIT_SOURCE } from "../../diary/billing-visits";
import { agedDebtFor, billingHomeFor, invoiceDetailFor, patientAccountFor, printInvoiceFor, statementFor, takePaymentViewFor, uninvoicedVisitsFor } from "../views";
import {
  checkPaymentLinksFor,
  creditNoteFor,
  invoiceVisitsFor,
  issueInvoiceFor,
  refundFor,
  remittanceFor,
  saveTestCardFor,
  takePaymentFor,
  voidInvoiceFor,
  waiveFeeFor,
} from "../writes";

export interface BillingServiceSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-bill";
const B = "harbour-bill";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const DAY = "2026-10-27";
const utc = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

/** A stand-in for the test-mode payment provider (no network): cards, charges, links, paid sessions, refunds. */
export function fakeProvider(): PaymentLinkProvider & { pay(linkId: string, amountPence: number): void; calls: string[] } {
  const calls: string[] = [];
  const paid = new Map<string, { sessionId: string; amountPence: number; paidOn: string }[]>();
  let n = 0;
  return {
    id: "stripe",
    mode: "test",
    configured: true,
    unavailableReason: null,
    calls,
    pay(linkId, amountPence) {
      paid.set(linkId, [...(paid.get(linkId) ?? []), { sessionId: `cs_test_${++n}`, amountPence, paidOn: DAY }]);
    },
    async createLink(input) {
      calls.push(`link:${input.amountPence}`);
      return { providerLinkId: `plink_test_${++n}`, url: `https://pay.example.com/test_${n}` };
    },
    async listPaidSessions(linkId) {
      return paid.get(linkId) ?? [];
    },
    async deactivate() {
      calls.push("deactivate");
    },
    async saveTestCard() {
      calls.push("save");
      return { customerRef: `cus_test_${++n}`, methodRef: `pm_test_${++n}`, brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 };
    },
    async chargeSavedCard(input) {
      calls.push(`charge:${input.amountPence}`);
      return { chargeRef: `pi_test_${++n}`, amountPence: input.amountPence };
    },
    async refund(input) {
      calls.push(`refund:${input.chargeRef}:${input.amountPence}`);
      return { refundRef: `re_test_${++n}` };
    },
  };
}

export function defineBillingServiceSuite(label: string, factory: () => Promise<BillingServiceSuiteDb>): void {
  describe(`billing server layer (M5) on ${label}`, () => {
    let suite: BillingServiceSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse(utc(DAY, "08:00"));
    const id: Record<string, string> = {};
    const provider = fakeProvider();
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward" });
    const reception = (siteIds: string[] | null = null) => testActor(ctx, A, "staff", { userId: "user_reception_01", name: "Jess Taylor" }, { siteIds });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Priya Shah" });
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };
    const refused = (r: { ok: boolean; error?: string }, pattern: RegExp) => {
      assert.equal(r.ok, false);
      assert.match(String(r.error), pattern);
    };

    async function visit(tenantId: string, patientId: string, start: string, opts: { caseId?: string; authorisationId?: string; site?: string; service?: string } = {}) {
      const [apptId] = await bulkCreateDiaryItems(
        ctx,
        tenantId,
        [
          {
            kind: "appointment",
            siteId: opts.site ?? id.siteA,
            practitionerId: id.prac,
            patientId,
            caseId: opts.caseId ?? null,
            serviceId: opts.service ?? id.fu,
            authorisationId: opts.authorisationId ?? null,
            startsAt: utc(DAY, start),
            endsAt: utc(DAY, `${String(Number(start.slice(0, 2))).padStart(2, "0")}:30`),
            status: "booked",
            source: "staff",
          },
        ],
        SEED,
      );
      return apptId;
    }
    /** The diary's own status change, on the visit's time. */
    async function status(apptId: string, to: "arrived" | "in_treatment" | "attended" | "dna", rev: number, extra: { feeDue?: boolean } = {}) {
      const saved = clock;
      clock = Date.parse(utc(DAY, "18:00"));
      const r = await setAppointmentStatus(ctx, A, apptId, { expectedRev: rev, status: to, ...extra }, SEED);
      clock = saved;
      assert.ok(r.ok, `status ${to}`);
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      id.siteA = (await createSite(ctx, A, { name: "Harbour Road (fictional)", code: "HAR" }, SEED)).id;
      id.siteB = (await createSite(ctx, A, { name: "Mill Lane (fictional)", code: "MIL" }, SEED)).id;
      id.prac = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-01", defaultSiteId: id.siteA }, SEED)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up 30 min", code: "FU", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Bluewell Health (fictional)", postcode: "MK9 9ZZ" }, SEED)).id;
      const list = await createPriceList(ctx, A, { name: "Bluewell 2026", payerType: "insurer", referrerId: id.insurer }, SEED);
      await setPriceListItem(ctx, A, { priceListId: list.id, serviceId: id.fu, pricePence: 7500, billingCode: "BW-FU" }, SEED);
      id.owen = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1990-12-02", email: "owen.price@example.com" }, SEED)).id;
      id.liam = (await createPatient(ctx, A, { firstName: "Liam", lastName: "O'Connor", dateOfBirth: "1985-06-21" }, SEED)).id;
      id.sarah = (await createPatient(ctx, A, { firstName: "Sarah", lastName: "Quinn" }, SEED)).id;
      id.liamCase = (await createCase(ctx, A, { patientId: id.liam, title: "Right ankle sprain", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, membershipNumber: "BWH-771204", excessPence: 4000, priceListId: list.id, siteId: id.siteA }, SEED)).id;
      id.sarahCase = (await createCase(ctx, A, { patientId: id.sarah, title: "Neck pain", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, priceListId: list.id, siteId: id.siteA }, SEED)).id;
      id.auth = (await createAuthorisation(ctx, A, { caseId: id.liamCase, referrerId: id.insurer, code: "BW-54410", sessionsAuthorised: 6, valueAuthorisedPence: 50000 }, SEED)).id;
      id.patientB = (await createPatient(ctx, B, { firstName: "Other", lastName: "Clinic" }, SEED)).id;
      await updateBillingSettings(ctx, A, 0, { paymentLinksEnabled: true, paymentInstructions: "Bank transfer: Riverside Physio (fictional) · sort code 00-00-00 · account 00000000" }, SEED);
      // The diary: Owen attended and missed one (fee), Liam 2 insured visits under the authorisation (+1 still in
      // treatment), Sarah 1 insured visit, a DNA without a fee, and one at the other site.
      id.owenDone = await visit(A, id.owen, "08:00");
      id.owenDna = await visit(A, id.owen, "11:00");
      id.liam1 = await visit(A, id.liam, "09:00", { caseId: id.liamCase, authorisationId: id.auth });
      id.liam2 = await visit(A, id.liam, "10:00", { caseId: id.liamCase, authorisationId: id.auth });
      id.liamInTreatment = await visit(A, id.liam, "13:00", { caseId: id.liamCase, authorisationId: id.auth });
      id.sarah1 = await visit(A, id.sarah, "14:00", { caseId: id.sarahCase });
      id.noFee = await visit(A, id.sarah, "15:00", { caseId: id.sarahCase });
      id.otherSite = await visit(A, id.owen, "16:00", { site: id.siteB });
      await status(id.owenDone, "attended", 1);
      await status(id.owenDna, "dna", 1, { feeDue: true });
      await status(id.liam1, "attended", 1);
      await status(id.liam2, "attended", 1);
      await status(id.liamInTreatment, "arrived", 1);
      await status(id.liamInTreatment, "in_treatment", 2);
      await status(id.sarah1, "attended", 1);
      await status(id.noFee, "dna", 1, { feeDue: false });
      await status(id.otherSite, "attended", 1);
    });
    after(async () => {
      await suite?.close();
    });

    it("the diary adapter: completed and fee-flagged visits only – never arrived, in treatment, a DNA without a fee, or another clinic's", async () => {
      const visits = await DIARY_VISIT_SOURCE.listClinicVisits(ctx, A, { from: DAY, until: DAY, siteIds: null });
      const ids = visits.map((v) => v.appointmentId).sort();
      assert.deepEqual(ids, [id.owenDone, id.owenDna, id.liam1, id.liam2, id.sarah1, id.otherSite].sort());
      assert.equal(visits.find((v) => v.appointmentId === id.owenDna)?.status, "did_not_attend");
      assert.equal(visits.find((v) => v.appointmentId === id.liam1)?.authorisationId, id.auth);
      assert.deepEqual(await DIARY_VISIT_SOURCE.listClinicVisits(ctx, B, { from: DAY, until: DAY, siteIds: null }), []);
      const scoped = await DIARY_VISIT_SOURCE.listClinicVisits(ctx, A, { from: DAY, until: DAY, siteIds: new Set([id.siteB]) });
      assert.deepEqual(scoped.map((v) => v.appointmentId), [id.otherSite]);
      // The diary counted Liam's two completed visits on the authorisation (one session each).
      assert.equal((await getAuthorisation(ctx, A, id.auth))?.sessionsUsed, 2);
    });

    it("attended, not invoiced: priced per payer with the excess per visit; reception limited to one site sees only it; the clinician cannot", async () => {
      const all = ok(await uninvoicedVisitsFor(reception()));
      const liam = all.visits.filter((v) => v.patientId === id.liam);
      assert.deepEqual(
        liam.map((v) => [v.billTo, v.chargePence, v.patientPence, v.payerPence, v.payerLabel]),
        [
          ["payer", 7500, 4000, 3500, "Bluewell Health (fictional)"],
          ["payer", 7500, 0, 7500, "Bluewell Health (fictional)"],
        ],
      );
      const dna = all.visits.find((v) => v.appointmentId === id.owenDna);
      assert.deepEqual([dna?.billTo, dna?.chargePence, dna?.waivable, dna?.status], ["patient", 5500, true, "did_not_attend"]);
      const siteB = ok(await uninvoicedVisitsFor(reception([id.siteB])));
      assert.deepEqual(siteB.visits.map((v) => v.appointmentId), [id.otherSite]);
      refused(await uninvoicedVisitsFor(clinician()), /permission/);
    });

    it("invoice visits: drafts per payer (the excess on its own patient invoice), issue; sessions counted once, value by billing", async () => {
      refused(await invoiceVisitsFor(clinician(), { appointmentIds: [id.owenDone] }), /permission/);
      const made = ok(await invoiceVisitsFor(reception(), { appointmentIds: [id.owenDone, id.owenDna, id.liam1, id.liam2, id.sarah1, id.liamInTreatment], issue: false }));
      // Owen: one patient invoice (visit + DNA fee). Liam: insurer + excess. Sarah: insurer. The in-treatment visit is skipped.
      assert.equal(made.invoices.length, 4);
      assert.equal(made.skipped, 1, "in treatment is not chargeable");
      const liamInsurer = made.invoices.find((i) => i.billTo === "payer" && i.totalPence === 11000);
      assert.ok(liamInsurer, "15000 less the 4000 excess");
      const owen = made.invoices.find((i) => i.billTo === "patient" && i.totalPence === 11000);
      assert.ok(owen, "5500 + the 100% DNA fee 5500");
      id.owenInv = owen!.id;
      id.liamInv = liamInsurer!.id;
      id.sarahInv = made.invoices.find((i) => i.billTo === "payer" && i.totalPence === 7500)!.id;
      id.liamExcess = made.invoices.find((i) => i.billTo === "patient" && i.totalPence === 4000)!.id;
      // Invoicing the same visits again does nothing (one active line per appointment).
      refused(await invoiceVisitsFor(reception(), { appointmentIds: [id.owenDone] }), /invoiced already/);
      for (const inv of [id.owenInv, id.liamInv, id.sarahInv, id.liamExcess]) {
        const d = ok(await invoiceDetailFor(reception(), inv));
        ok(await issueInvoiceFor(reception(), inv, d.rev));
      }
      const auth = await getAuthorisation(ctx, A, id.auth);
      assert.deepEqual([auth?.sessionsUsed, auth?.valueUsedPence], [2, 11000], "the diary's 2 sessions, not 4; the insurer invoice's value");
      // Exactly one issue audit row per invoice, written in the issue's batch.
      const issues = (await listAudit(ctx, A, { action: "pms.invoice.issue" })).filter((e) => e.targetId === id.liamInv);
      assert.equal(issues.length, 1);
      const detail = ok(await invoiceDetailFor(reception(), id.liamInv));
      assert.deepEqual(detail.lines.map((l) => [l.totalPence, l.excessPence]), [
        [7500, 4000],
        [7500, 0],
      ]);
      assert.equal(detail.partner?.isExcess, true);
      assert.deepEqual(detail.authorisation, { code: "BW-54410", sessionsUsed: 2, sessionsAuthorised: 6 });
      const home = ok(await billingHomeFor(reception()));
      assert.equal(home.figures.uninvoicedVisits, 1, "only the other site's visit is left");
    });

    it("take payment: part by cash with change; the rest by card on file (test provider); payment link for another invoice", async () => {
      const view = ok(await takePaymentViewFor(reception(), id.owen));
      assert.equal(view.balancePence, 11000);
      const cash = ok(await takePaymentFor(reception(), { patientId: id.owen, method: "cash", amountPence: 5000, tenderedPence: 6000 }, provider));
      assert.equal(cash.changePence, 1000);
      assert.equal((await getInvoice(ctx, A, id.owenInv))?.balancePence, 6000);
      refused(await takePaymentFor(clinician(), { patientId: id.owen, method: "cash", amountPence: 100 }, provider), /permission/);
      refused(await takePaymentFor(reception(), { patientId: id.owen, method: "cash", amountPence: 100, allocations: [{ invoiceId: id.owenInv, amountPence: 9999 }] }, provider), /More is allocated|owes only/);
      ok(await saveTestCardFor(reception(), id.owen, provider));
      const card = ok(await takePaymentViewFor(reception(), id.owen, null)).savedCards[0];
      assert.match(card.label, /ending 4242/);
      ok(await takePaymentFor(reception(), { patientId: id.owen, method: "card_on_file", savedCardId: card.id, amountPence: 6000 }, provider));
      assert.equal((await getInvoice(ctx, A, id.owenInv))?.balancePence, 0);
      assert.ok(provider.calls.includes("charge:6000"));
      // Liam's excess invoice: a payment link, paid, checked, recorded once.
      const link = ok(await takePaymentFor(reception(), { patientId: id.liam, method: "payment_link", amountPence: 4000, allocations: [{ invoiceId: id.liamExcess, amountPence: 4000 }] }, provider));
      assert.match(link.links[0].url, /^https:\/\/pay\.example\.com\//);
      const links = ok(await invoiceDetailFor(reception(), id.liamExcess)).paymentLinks;
      provider.pay((await suite.db.selectFrom("pms_payment_links").select("provider_link_id").where("tenant_id", "=", A).where("id", "=", links[0].id).executeTakeFirstOrThrow()).provider_link_id, 4000);
      assert.equal(ok(await checkPaymentLinksFor(reception(), id.liamExcess, provider)).recorded, 1);
      assert.equal(ok(await checkPaymentLinksFor(reception(), id.liamExcess, provider)).recorded, 0, "never twice");
      assert.equal((await getInvoice(ctx, A, id.liamExcess))?.balancePence, 0);
    });

    it("remittance: one insurer payment over two invoices, a short payment written off and one moved to the patient", async () => {
      // Reception (no "Refunds and credit notes") may allocate but not write off.
      refused(
        await remittanceFor(reception(), { payerReferrerId: id.insurer, amountPence: 15000, reference: "BW-RA-7810", receivedOn: DAY, method: "bank_transfer", rows: [{ invoiceId: id.liamInv, paidPence: 10000, shortfall: "write_off", writeOffReason: "above_agreed_rate" }] }),
        /Refunds and credit notes/,
      );
      const r = ok(
        await remittanceFor(owner(), {
          payerReferrerId: id.insurer,
          amountPence: 20000,
          reference: "BW-RA-7810",
          receivedOn: DAY,
          method: "bank_transfer",
          rows: [
            { invoiceId: id.liamInv, paidPence: 10000, shortfall: "write_off", writeOffReason: "above_agreed_rate" },
            { invoiceId: id.sarahInv, paidPence: 6000, shortfall: "patient" },
          ],
        }),
      );
      assert.deepEqual([r.allocatedPence, r.writtenOffPence, r.movedToPatientsPence, r.unallocatedPence], [16000, 1000, 1500, 4000]);
      assert.equal((await getInvoice(ctx, A, id.liamInv))?.balancePence, 0);
      assert.equal((await getInvoice(ctx, A, id.sarahInv))?.balancePence, 0);
      const notes = await listCreditNotesForInvoice(ctx, A, id.liamInv);
      assert.deepEqual(notes.map((n) => [n.kind, n.totalPence]), [["write_off", 1000]]);
      const sarahOwn = await listInvoicesPage(ctx, A, { patientId: id.sarah, billTo: "patient", state: "outstanding" });
      assert.deepEqual(sarahOwn.rows.map((i) => i.balancePence), [1500], "Sarah now owes the 15.00 the insurer did not pay");
      // A write-off keeps the visit billed (it is not offered again).
      assert.equal(ok(await uninvoicedVisitsFor(owner())).visits.some((v) => v.appointmentId === id.liam1), false);
    });

    it("void: refused with payments, allowed without (owner only); a credit note gives the balance back; refund to the card", async () => {
      refused(await voidInvoiceFor(owner(), id.owenInv, "Wrong patient"), /payments on it/);
      refused(await voidInvoiceFor(reception(), id.owenInv, "Wrong patient"), /permission/);
      // The other site's visit: invoice it, issue, void – the visit is offered again.
      const made = ok(await invoiceVisitsFor(owner(), { appointmentIds: [id.otherSite], issue: true }));
      const v = made.invoices[0].id;
      ok(await voidInvoiceFor(owner(), v, "Raised in error"));
      const voided = ok(await invoiceDetailFor(owner(), v));
      assert.deepEqual([voided.state, voided.balancePence], ["void", 0]);
      assert.equal(ok(await uninvoicedVisitsFor(owner())).visits.some((x) => x.appointmentId === id.otherSite), true, "released");
      assert.equal((await listAudit(ctx, A, { action: "pms.invoice.void" })).length, 1);
      // Owen's paid invoice: a 20.00 credit note → refund due → refund 20.00 to the card.
      ok(await creditNoteFor(owner(), id.owenInv, { amountPence: 2000, reason: "Goodwill (fictional)" }));
      assert.equal((await getInvoice(ctx, A, id.owenInv))?.balancePence, -2000, "credited: 20.00 is owed back");
      const refund = ok(await refundFor(owner(), id.owenInv, { amountPence: 2000, method: "card", reason: "Goodwill (fictional)" }, provider));
      assert.equal(refund.toCard, true);
      assert.equal((await getInvoice(ctx, A, id.owenInv))?.balancePence, 0);
      refused(await refundFor(reception(), id.owenInv, { amountPence: 100, method: "cash", reason: "Test" }, provider), /permission/);
    });

    it("waive a DNA fee; statement, aged debt and print; the clinician reads but changes nothing; site scope and clinic isolation", async () => {
      const dna = await visit(A, id.owen, "17:00");
      await status(dna, "dna", 1, { feeDue: true });
      assert.equal(ok(await waiveFeeFor(reception(), dna)).waived, true);
      assert.equal(ok(await uninvoicedVisitsFor(reception())).visits.some((x) => x.appointmentId === dna), false);
      assert.equal((await listAudit(ctx, A, { action: "pms.appointment.fee_waive" })).length, 1);
      const st = ok(await statementFor(reception(), { patientId: id.owen }, "2026-10-01", DAY));
      assert.equal(st.statement.closingPence, 0);
      assert.ok(st.statement.rows.length >= 3);
      const aged = ok(await agedDebtFor(reception()));
      assert.equal(aged.totals.totalPence, 1500, "only Sarah's 15.00 is owed");
      const printed = ok(await printInvoiceFor(reception(), id.liamInv));
      assert.equal(printed.invoice.billToName, "Bluewell Health (fictional)");
      // The clinician: billing.view only.
      ok(await billingHomeFor(clinician()));
      ok(await invoiceDetailFor(clinician(), id.owenInv));
      refused(await issueInvoiceFor(clinician(), id.owenInv, 1), /permission/);
      refused(await takePaymentViewFor(clinician(), id.owen), /permission/);
      // Reception limited to site B never sees site A's invoices (answered as "no such invoice").
      refused(await invoiceDetailFor(reception([id.siteB]), id.owenInv), /no longer exists/);
      assert.equal(ok(await billingHomeFor(reception([id.siteB]))).rows.every((r) => r.id !== id.owenInv), true);
      // Another clinic's member: nothing.
      const other = testActor(ctx, B, "owner", { userId: "user_b", name: "B" });
      refused(await invoiceDetailFor(other, id.owenInv), /no longer exists/);
      assert.equal(ok(await billingHomeFor(other)).rows.length, 0);
      const account = ok(await patientAccountFor(reception(), id.owen));
      assert.equal(account.patientBalancePence, 0);
      assert.match(account.savedCard?.label ?? "", /4242/);
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (suite.log) assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
