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
import { getInvoice, listInvoicesPage, notOnAnInvoice } from "../../../repos/pms/billing/invoices";
import { updateBillingSettings } from "../../../repos/pms/billing/settings";
import { createAuthorisation, createCase, getAuthorisation } from "../../../repos/pms/cases";
import { bulkCreateDiaryItems, setAppointmentStatus } from "../../../repos/pms/diary/appointments";
import { createPractitioner, createService, createSite } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { runBatch } from "../../../db/batch";
import { addDaysIso } from "../../../../modules/pms/billing/status";
import { createPriceList, setPriceListItem } from "../../../repos/pms/price-lists";
import { createReferrer } from "../../../repos/pms/referrers";
import type { QueryLog } from "../../../repos/pms/testing/guarded-db";
import { unscopedStatements } from "../../../repos/pms/testing/guarded-db";
import { testActor } from "../access";
import type { PaymentLinkProvider } from "../payments";
import { DIARY_VISIT_SOURCE } from "../../diary/billing-visits";
import { agedDebtFor, billingHomeFor, caseContributionFor, invoiceDetailFor, patientAccountFor, payerTermsFor, printInvoiceFor, statementFor, takePaymentViewFor, uninvoicedVisitsFor } from "../views";
import {
  checkPaymentLinksFor,
  creditNoteFor,
  invoiceVisitsFor,
  issueInvoiceFor,
  refundFor,
  remittanceFor,
  saveTestCardFor,
  setCaseContributionModeFor,
  setPayerContributionModeFor,
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

    it("the patient's part per payer account: a contribution on every visit; a visit it covers in full goes to the patient only (no £0 insurer invoice)", async () => {
      const kestrel = (await createReferrer(ctx, A, { kind: "insurer", name: "Kestrel Healthcare (fictional)" }, SEED)).id;
      refused(await setPayerContributionModeFor(reception(), kestrel, "per_visit"), /permission/);
      refused(await setPayerContributionModeFor(owner(), kestrel, "sometimes"), /Choose how/);
      ok(await setPayerContributionModeFor(owner(), kestrel, "per_visit"));
      const terms = ok(await payerTermsFor(reception()));
      assert.equal(terms.canEdit, false, "reception sees the accounts but does not change them");
      assert.deepEqual(
        terms.accounts.map((a) => [a.name, a.mode]),
        [
          ["Bluewell Health (fictional)", "per_case"],
          ["Kestrel Healthcare (fictional)", "per_visit"],
        ],
      );
      const other = testActor(ctx, B, "owner", { userId: "user_b", name: "B" });
      refused(await setPayerContributionModeFor(other, kestrel, "per_case"), /no longer exists|not found|does not exist/i);
      const nina = (await createPatient(ctx, A, { firstName: "Nina", lastName: "Ford" }, SEED)).id;
      const ted = (await createPatient(ctx, A, { firstName: "Ted", lastName: "Lowe" }, SEED)).id;
      const ninaCase = (await createCase(ctx, A, { patientId: nina, title: "Elbow", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: kestrel, excessPence: 2000, siteId: id.siteA }, SEED)).id;
      const tedCase = (await createCase(ctx, A, { patientId: ted, title: "Calf", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: kestrel, excessPence: 6000, siteId: id.siteA }, SEED)).id;
      const n1 = await visit(A, nina, "12:00", { caseId: ninaCase });
      const t1 = await visit(A, ted, "07:00", { caseId: tedCase });
      await status(n1, "attended", 1);
      await status(t1, "attended", 1);
      const rows = ok(await uninvoicedVisitsFor(reception())).visits;
      const row = (appt: string) => rows.find((v) => v.appointmentId === appt);
      assert.deepEqual([n1, t1].map((a) => [row(a)?.billTo, row(a)?.chargePence, row(a)?.patientPence, row(a)?.payerPence, row(a)?.contributionMode]), [
        ["payer", 5500, 2000, 3500, "per_visit"],
        ["payer", 5500, 5500, 0, "per_visit"],
      ]);
      const made = ok(await invoiceVisitsFor(reception(), { appointmentIds: [n1, t1], issue: true }));
      assert.deepEqual(
        made.invoices.map((i) => [i.billTo, i.totalPence]).sort(),
        [
          ["patient", 2000],
          ["patient", 5500],
          ["payer", 3500],
        ],
        "Nina: insurer 35.00 + her 20.00; Ted: all 55.00 to him – no £0 insurer invoice",
      );
      const ninaInsurer = made.invoices.find((i) => i.billTo === "payer")!.id;
      const d = ok(await invoiceDetailFor(reception(), ninaInsurer));
      assert.deepEqual(d.contribution, { mode: "per_visit", amountPence: 2000, insurerName: "Kestrel Healthcare (fictional)", fullyPatient: false });
      assert.deepEqual(d.lines.map((l) => [l.totalPence, l.excessPence]), [[5500, 2000]]);
      assert.equal(d.partner?.isExcess, true);
      const tedInv = made.invoices.find((i) => i.totalPence === 5500)!.id;
      const t = ok(await invoiceDetailFor(reception(), tedInv));
      assert.deepEqual([t.billTo, t.partner, t.contribution?.fullyPatient, t.contribution?.insurerName], ["patient", null, true, "Kestrel Healthcare (fictional)"]);
      assert.deepEqual(t.lines.map((l) => [l.kind, l.appointmentId, l.totalPence]), [["excess", t1, 5500]]);
      assert.equal((await listInvoicesPage(ctx, A, { caseId: tedCase })).rows.filter((r) => r.billTo === "payer").length, 0);
      // A case's own choice, saved with the case form (patients.edit); never another patient's case.
      refused(await setCaseContributionModeFor(reception(), id.owen, tedCase, "per_case"), /no longer exists|not found|does not exist/i);
      ok(await setCaseContributionModeFor(reception(), ted, tedCase, "per_case"));
      assert.deepEqual(await caseContributionFor(reception(), tedCase), { payerModes: { [kestrel]: "per_visit" }, caseMode: "per_case" });
      ok(await setCaseContributionModeFor(reception(), ted, tedCase, ""));
      assert.equal((await caseContributionFor(reception(), tedCase)).caseMode, null);
      assert.equal((await listAudit(ctx, A, { action: "pms.case_terms.set" })).length, 2);
      assert.equal((await listAudit(ctx, A, { action: "pms.payer_terms.set" })).length, 1);
    });

    it("M10 scale: 'Attended, not invoiced' lists the NEWEST visits of a busy week and counts them all; invoiced ones are left out in the database", async () => {
      const C = "scale-bill";
      const recC = () => testActor(ctx, C, "staff", { userId: "user_reception_01", name: "Jess Taylor" });
      const site = (await createSite(ctx, C, { name: "Scale Road (fictional)", code: "SCA" }, SEED)).id;
      const fu = (await createService(ctx, C, { name: "Follow-up 20 min", code: "FU", category: "follow_up", durationMinutes: 20, defaultPricePence: 4500 }, SEED)).id;
      const items: Parameters<typeof bulkCreateDiaryItems>[2] = [];
      for (let p = 0; p < 3; p++) {
        const prac = (await createPractitioner(ctx, C, { displayName: `Scale Physio ${p + 1}`, registrationNumber: `PH-DEMO-0${p + 4}`, defaultSiteId: site }, SEED)).id;
        const patient = (await createPatient(ctx, C, { firstName: "Scale", lastName: `Patient ${p + 1}` }, SEED)).id;
        // 200 completed 20-minute visits each, back to back from Wednesday 21/10 (all within the last 7 days).
        for (let i = 0; i < 200; i++) {
          const startsAt = new Date(Date.parse("2026-10-21T00:00:00.000Z") + i * 20 * 60_000 + p * 1000).toISOString();
          items.push({ kind: "appointment", siteId: site, practitionerId: prac, patientId: patient, serviceId: fu, startsAt, endsAt: new Date(Date.parse(startsAt) + 20 * 60_000).toISOString(), status: "attended", source: "staff" });
        }
      }
      const ids = await bulkCreateDiaryItems(ctx, C, items, SEED);
      assert.equal(ids.length, 600);
      const byNewest = items.map((it, i) => ({ id: ids[i], at: it.startsAt })).sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1));
      const first = ok(await uninvoicedVisitsFor(recC()));
      assert.equal(first.total, 600, "every visit still to invoice is counted");
      assert.equal(first.visits.length, 500, "the list shows 500");
      assert.equal(first.visits[first.visits.length - 1].appointmentId, byNewest[0].id, "the newest visit is in the list (shown last: oldest first)");
      assert.equal(first.visits[0].appointmentId, byNewest[499].id, "the 500 newest, not the oldest of the week");
      assert.equal(ok(await billingHomeFor(recC())).figures.uninvoicedVisits, 600);
      // Invoice the two newest: they leave the list and the count.
      ok(await invoiceVisitsFor(recC(), { appointmentIds: [byNewest[0].id, byNewest[1].id], issue: false }));
      const after2 = ok(await uninvoicedVisitsFor(recC()));
      assert.equal(after2.total, 598);
      assert.equal(after2.visits[after2.visits.length - 1].appointmentId, byNewest[2].id);
      assert.ok(!after2.visits.some((v) => v.appointmentId === byNewest[0].id || v.appointmentId === byNewest[1].id));
      // Keyset paging through the source: two pages, newest first, nothing twice, nothing missed.
      const page1 = await DIARY_VISIT_SOURCE.listUninvoicedVisits(ctx, C, { from: "2026-07-29", until: DAY, siteIds: null, notBilled: notOnAnInvoice, limit: 400 });
      const page2 = await DIARY_VISIT_SOURCE.listUninvoicedVisits(ctx, C, { from: "2026-07-29", until: DAY, siteIds: null, notBilled: notOnAnInvoice, limit: 400, before: page1.next });
      assert.deepEqual([page1.visits.length, page2.visits.length, page2.next], [400, 198, null]);
      assert.equal(new Set([...page1.visits, ...page2.visits].map((v) => v.appointmentId)).size, 598);
      assert.equal(page1.visits[0].appointmentId, byNewest[2].id);
    });

    it("M10 scale: aged debt of a member limited to one site adds up ALL that site's open invoices (filtered in the query); names only for the 8 largest", async () => {
      const C = "scale-debt";
      const x = (await createSite(ctx, C, { name: "Xavier Street (fictional)", code: "XAV" }, SEED)).id;
      const y = (await createSite(ctx, C, { name: "Yew Lane (fictional)", code: "YEW" }, SEED)).id;
      const pats: string[] = [];
      for (let i = 0; i < 30; i++) pats.push((await createPatient(ctx, C, { firstName: "Debt", lastName: `Patient ${String(i + 1).padStart(2, "0")}` }, SEED)).id);
      // 230 open invoices at Xavier Street, 20 at Yew Lane and 10 paid ones (history), loaded as an import would.
      const at = utc(DAY, "08:00");
      const rows: { site: string; patient: string; total: number; paid: number; due: string }[] = [];
      for (let i = 0; i < 230; i++) rows.push({ site: x, patient: pats[i % 25], total: 1000 + (i % 25) * 100 + i, paid: i % 3 === 0 ? 500 : 0, due: addDaysIso(DAY, -((i * 7) % 150)) });
      for (let i = 0; i < 20; i++) rows.push({ site: y, patient: pats[25 + (i % 5)], total: 9000 + i, paid: 0, due: addDaysIso(DAY, -40) });
      for (let i = 0; i < 10; i++) rows.push({ site: x, patient: pats[i], total: 2000, paid: 2000, due: addDaysIso(DAY, -100) });
      const inserts = rows.map((r, i) =>
        ctx.db.insertInto("pms_invoices").values({
          tenant_id: C,
          id: `inv_01JSCALE${String(i).padStart(18, "0")}`,
          rev: 1,
          status: "issued",
          number_prefix: "INV",
          number_seq: i + 1,
          patient_id: r.patient,
          bill_to: "patient",
          payer_type: "self_pay",
          site_id: r.site,
          issued_on: addDaysIso(r.due, -30),
          due_on: r.due,
          net_pence: r.total,
          vat_pence: 0,
          total_pence: r.total,
          paid_pence: r.paid,
          credited_pence: 0,
          prices_include_vat: 1,
          created_at: at,
          updated_at: at,
        }),
      );
      for (let i = 0; i < inserts.length; i += 90) await runBatch(ctx.db, inserts.slice(i, i + 90));
      const owed = (site: string | null) => rows.filter((r) => (site === null || r.site === site) && r.total > r.paid).reduce((n, r) => n + r.total - r.paid, 0);
      const limited = ok(await agedDebtFor(testActor(ctx, C, "admin", { userId: "user_admin_x", name: "Xena Admin" }, { siteIds: [x] })));
      assert.equal(limited.totals.totalPence, owed(x), "all 230 open invoices at the member's site, not the first 200");
      assert.equal(limited.rows[0].totalPence, owed(x));
      const all = ok(await agedDebtFor(testActor(ctx, C, "owner", { userId: "user_owner_01", name: "Helen Ward" })));
      assert.equal(all.totals.totalPence, owed(null));
      // The 8 largest debtors with their names (looked up for those 8 only).
      assert.equal(all.largest.length, 8);
      for (let i = 1; i < all.largest.length; i++) assert.ok(all.largest[i - 1].amountPence >= all.largest[i].amountPence, "largest first");
      assert.ok(all.largest.every((l) => /^Debt Patient \d\d$/.test(l.name)), all.largest.map((l) => l.name).join(", "));
      assert.ok(all.largest[0].patientId && pats.slice(25).includes(all.largest[0].patientId), "a Yew Lane patient owes most (4 × ~£90)");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (suite.log) assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
