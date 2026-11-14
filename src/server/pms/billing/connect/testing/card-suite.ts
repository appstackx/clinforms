/**
 * TESTS ONLY: card payments through the clinic's own connected account, on a real migrated database with an
 * in-memory payment provider (./fake-connect.ts). Covers: the switches; owner-only account, readers and policy;
 * desk reader payments (simulated tap, decline, cancel); saved cards with recorded consent; no-show rules;
 * refunds (partial, over-refund refused in the database, failed refund reversed, refund from the provider's
 * dashboard); the portal's pay button; memberships (one charge per month, retries, payment failed, concurrent
 * runs); the webhook (signature, mode, unknown account, duplicates, out-of-order, another clinic's metadata);
 * EXACTLY-ONCE recording under every path; tenant isolation; offboarding by cascade; the tenant-scope guard.
 * Run on node:sqlite and PGlite (../card-payments.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-billing-cards-stack.test.ts). Fictional data only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { runBatch } from "../../../../db/batch";
import { CARD_CASCADE_DELETED_TABLES } from "../../../../db/pms-schema/billing";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../../repos/audit";
import type { RepoContext } from "../../../../repos/context";
import { createService, createSite } from "../../../../repos/pms/directory";
import { createPatient } from "../../../../repos/pms/patients";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../../../repos/pms/billing/invoices";
import { createRefundIntent, getCardSettings, getIntent, getMandate, getMembership, listMandates } from "../../../../repos/pms/billing/card-payments";
import { recordPayment } from "../../../../repos/pms/billing/payments";
import { unscopedStatements, type QueryLog } from "../../../../repos/pms/testing/guarded-db";
import { signWebhookPayload } from "../../../comms/credits/card-payments";
import { countPmsRows, deletePmsQueries } from "../../../offboard";
import { testActor } from "../../access";
import type { ConnectConfig } from "../client";
import { runMembershipCharges } from "../memberships-run";
import {
  addReaderFor,
  cancelReaderPaymentFor,
  chargeSavedCardFor,
  checkCardPaymentFor,
  checkSavedCardFor,
  completePortalPayment,
  connectAccountFor,
  createPlanFor,
  invoiceCardViewFor,
  patientCardsFor,
  payoutsFor,
  portalInvoices,
  recordIntentPayment,
  refreshAccountFor,
  refundCardPaymentFor,
  removeSavedCardFor,
  setCardPaymentsEnabledFor,
  setNoShowPolicyFor,
  simulateReaderTapFor,
  startMembershipFor,
  startPortalPayment,
  startReaderPaymentFor,
  startSaveCardFor,
  type CardDeps,
} from "../service";
import { handleConnectWebhook } from "../webhook";
import { createFakeConnect, type FakeConnect } from "./fake-connect";

export interface CardSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-cards";
const B = "harbour-cards";
const SEED = { userId: "user_seed", sessionId: "sess_seed" };
const SECRET = "whsec_test_connect_secret_0123456789";
const URLS = { successUrl: "https://clinic.example.test/back", cancelUrl: "https://clinic.example.test/cancel" };

type R<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };
const okv = <T>(r: R<T>): T => {
  if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
  return r.value;
};
const refused = <T>(r: R<T>, re?: RegExp): string => {
  if (r.ok) assert.fail("expected a refusal");
  if (re) assert.match(r.error, re);
  return r.error;
};

export function defineCardPaymentsSuite(label: string, factory: () => Promise<CardSuiteDb>): void {
  describe(`card payments (connected accounts) on ${label}`, () => {
    let suite: CardSuiteDb;
    let ctx: RepoContext;
    let fake: FakeConnect;
    let deps: CardDeps;
    let now = new Date("2026-11-10T10:00:00.000Z");
    const id: Record<string, string> = {};
    const owner = () => ({ ...testActor(ctx, A, "owner", { userId: "user_owner_a", name: "Helen Ward (fictional)" }), clinicName: "Riverside Physio (fictional)", email: "owner@example.test" });
    const admin = () => ({ ...testActor(ctx, A, "admin", { userId: "user_admin_a", name: "Ola Admin (fictional)" }), clinicName: "Riverside Physio (fictional)" });
    const reception = () => ({ ...testActor(ctx, A, "staff", { userId: "user_desk_a", name: "Desk Person (fictional)" }), clinicName: "Riverside Physio (fictional)" });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_a", name: "Priya Shah (fictional)" });
    const ownerB = () => ({ ...testActor(ctx, B, "owner", { userId: "user_owner_b", name: "Other Owner (fictional)" }), clinicName: "Harbour (fictional)" });
    const paymentsOn = async (t: string, ref: string) =>
      (await ctx.db.selectFrom("pms_payments").select(["id", "kind", "amount_pence", "allocated_pence", "status"]).where("tenant_id", "=", t).where("provider", "=", "stripe_connect").where("provider_ref", "=", ref).execute()).map((p) => ({ ...p, amount_pence: Number(p.amount_pence) }));
    const allConnectPayments = async (t: string) => ctx.db.selectFrom("pms_payments").select(["id", "kind", "amount_pence", "provider_ref", "status"]).where("tenant_id", "=", t).where("provider", "=", "stripe_connect").execute();
    const newInvoice = async (t: string, patientId: string, pence: number, visitStatus: "attended" | "did_not_attend" = "attended") => {
      const { invoice } = await createDraftInvoice(ctx, t, { patientId, siteId: id[`site_${t}`], lines: [{ kind: "service", serviceId: id[`svc_${t}`], serviceOn: "2026-11-09", unitPricePence: pence, visitStatus }] }, SEED);
      const issued = await issueInvoice(ctx, t, invoice.id, invoice.rev, {}, SEED);
      assert.ok(issued.ok);
      return invoice.id;
    };
    const post = async (event: Record<string, unknown>, opts: { secret?: string } = {}) => {
      const payload = JSON.stringify(event);
      const nowS = Math.floor(Date.now() / 1000);
      const req = new Request("https://clinic.example.test/api/billing/connect-webhook", { method: "POST", body: payload, headers: { "stripe-signature": signWebhookPayload(payload, opts.secret ?? SECRET, nowS), "content-type": "application/json" } });
      const res = await handleConnectWebhook(req, { switchOn: true, config: deps.config, ctx: () => ctx, log: () => undefined });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    let evt = 0;
    const event = (type: string, objectId: string, account: string, extra: Record<string, unknown> = {}) => ({ id: `evt_test_${++evt}`, type, livemode: false, account, data: { object: { id: objectId } }, ...extra });

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => now };
      fake = createFakeConnect("test");
      const config: ConnectConfig = { api: fake, mode: "test", webhookSecrets: [SECRET] };
      deps = { switchOn: true, config: { ok: true, config } };
      for (const t of [A, B]) {
        id[`site_${t}`] = (await createSite(ctx, t, { name: `Main site ${t}` }, SEED)).id;
        id[`svc_${t}`] = (await createService(ctx, t, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      }
      id.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1990-04-02" }, SEED)).id;
      id.owen = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1985-01-12" }, SEED)).id;
      id.otherB = (await createPatient(ctx, B, { firstName: "Bea", lastName: "Other" }, SEED)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("switch off: every screen and action refuses, the webhook answers 404", async () => {
      const off: CardDeps = { switchOn: false, config: deps.config };
      refused(await connectAccountFor(owner(), { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, off), /not switched on/);
      assert.deepEqual(okv(await invoiceCardViewFor(owner(), "inv_00000000000000000000000000", off)), null);
      const res = await handleConnectWebhook(new Request("https://x.test", { method: "POST", body: "{}" }), { switchOn: false, config: deps.config, ctx: () => ctx });
      assert.equal(res.status, 404);
      const noKey: CardDeps = { switchOn: true, config: { ok: false, reason: "Card payments are not set up yet." } };
      refused(await connectAccountFor(owner(), { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, noKey), /not set up/);
    });

    it("owner only: connect makes ONE account per clinic and mode (idempotent), others are refused", async () => {
      for (const who of [admin(), reception(), clinician()]) assert.equal((await connectAccountFor(who, { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, deps)).ok, false);
      const first = okv(await connectAccountFor(owner(), { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, deps));
      assert.match(first.url, /^https:\/\//);
      const s1 = await getCardSettings(ctx, A);
      assert.match(s1.accountRef ?? "", /^acct_/);
      assert.equal(s1.status, "pending", "a fresh account has not been through onboarding");
      okv(await connectAccountFor(owner(), { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, deps));
      assert.equal((await getCardSettings(ctx, A)).accountRef, s1.accountRef, "resuming onboarding keeps the same account");
      assert.equal(fake.calls.filter((c) => c.method === "createAccount").length, 1);
      id.acctA = s1.accountRef as string;
      okv(await connectAccountFor(ownerB(), { refreshUrl: "https://x.test/r", returnUrl: "https://x.test/b" }, deps));
      id.acctB = (await getCardSettings(ctx, B)).accountRef as string;
      assert.notEqual(id.acctA, id.acctB);
      const audit = await listAudit(ctx, A, { limit: 50 });
      assert.ok(audit.some((e) => e.action === "pms.card_account.connect"));
    });

    it("enable needs a connected account; test mode works before verification; refresh reads the provider", async () => {
      refused(await setCardPaymentsEnabledFor(admin(), true, deps));
      okv(await setCardPaymentsEnabledFor(owner(), true, deps));
      okv(await setCardPaymentsEnabledFor(ownerB(), true, deps));
      fake.setAccountStatus(id.acctA, "active");
      assert.equal(okv(await refreshAccountFor(owner(), deps)).status, "active");
      assert.equal((await getCardSettings(ctx, A)).status, "active");
    });

    it("readers: owner registers a simulated reader per site (location made once); reception cannot", async () => {
      refused(await addReaderFor(reception(), { siteId: id[`site_${A}`], label: "Desk", registrationCode: "", line1: "1 Test St", city: "London", postcode: "SW1A 1AA" }, deps));
      refused(await addReaderFor(owner(), { siteId: id[`site_${A}`], label: "Desk", registrationCode: "", line1: "", city: "", postcode: "" }, deps), /address/);
      id.reader = okv(await addReaderFor(owner(), { siteId: id[`site_${A}`], label: "Front desk", registrationCode: "", line1: "1 Test St", city: "London", postcode: "SW1A 1AA" }, deps)).id;
      id.reader2 = okv(await addReaderFor(owner(), { siteId: id[`site_${A}`], label: "Back desk", registrationCode: "", line1: "", city: "", postcode: "" }, deps)).id;
      refused(await addReaderFor(ownerB(), { siteId: id[`site_${A}`], label: "Steal", registrationCode: "", line1: "1 St", city: "X", postcode: "SW1A 1AA" }, deps), /sites/);
    });

    it("desk reader payment: tap → recorded ONCE, allocated; repeated checks, webhooks and calls never double it", async () => {
      id.inv1 = await newInvoice(A, id.megan, 5500);
      refused(await startReaderPaymentFor(clinician(), { invoiceId: id.inv1, readerId: id.reader }, deps));
      refused(await startReaderPaymentFor(reception(), { invoiceId: id.inv1, readerId: id.reader, amountPence: 9999 }, deps), /owes only/);
      const started = okv(await startReaderPaymentFor(reception(), { invoiceId: id.inv1, readerId: id.reader }, deps));
      refused(await startReaderPaymentFor(reception(), { invoiceId: id.inv1, readerId: id.reader2 }, deps), /already in progress/);
      const view = okv(await invoiceCardViewFor(reception(), id.inv1, deps));
      assert.equal(view?.pendingReader?.intentId, started.intentId);
      assert.equal(okv(await checkCardPaymentFor(reception(), started.intentId, deps)).status, "processing");
      const tapped = okv(await simulateReaderTapFor(reception(), started.intentId, undefined, deps));
      assert.equal(tapped.status, "succeeded");
      const intent = (await getIntent(ctx, A, started.intentId))!;
      id.pi1 = intent.intentRef as string;
      // Again and again: the screen, the webhook (twice, same event and a new one), a direct call in parallel.
      okv(await checkCardPaymentFor(reception(), started.intentId, deps));
      const e = event("payment_intent.succeeded", id.pi1, id.acctA);
      assert.equal((await post(e)).body.result, "already");
      assert.equal((await post(e)).body.result, "duplicate");
      assert.equal((await post(event("payment_intent.succeeded", id.pi1, id.acctA))).body.result, "already");
      const pi = await fake.getPaymentIntent(id.acctA, id.pi1);
      await Promise.all([recordIntentPayment(ctx, A, intent, pi), recordIntentPayment(ctx, A, intent, pi), recordIntentPayment(ctx, A, intent, pi)]);
      const pays = await paymentsOn(A, id.pi1);
      assert.equal(pays.length, 1, "exactly one payment for the card payment");
      assert.equal(pays[0].amount_pence, 5500);
      const inv = (await getInvoice(ctx, A, id.inv1))!;
      assert.equal(inv.balancePence, 0, "the invoice is paid");
      assert.equal(inv.paidPence, 5500, "never double counted");
    });

    it("reader decline and cancel take nothing; a new payment can then be started", async () => {
      id.inv2 = await newInvoice(A, id.owen, 4000);
      const s = okv(await startReaderPaymentFor(reception(), { invoiceId: id.inv2, readerId: id.reader }, deps));
      const declined = okv(await simulateReaderTapFor(reception(), s.intentId, "4000000000009995", deps));
      assert.equal(declined.status, "failed");
      const s2 = okv(await startReaderPaymentFor(reception(), { invoiceId: id.inv2, readerId: id.reader }, deps));
      assert.equal(okv(await cancelReaderPaymentFor(reception(), s2.intentId, deps)).status, "canceled");
      assert.equal((await getInvoice(ctx, A, id.inv2))!.paidPence, 0);
      assert.equal((await allConnectPayments(A)).length, 1);
    });

    it("saved card: consent must be confirmed; recorded with exact wording, version, channel, who and when", async () => {
      refused(await startSaveCardFor(reception(), { patientId: id.owen, allowsNoShow: false, consentConfirmed: false, ...URLS }, deps), /agreed/);
      const r = okv(await startSaveCardFor(reception(), { patientId: id.owen, allowsNoShow: true, consentConfirmed: true, ...URLS }, deps));
      assert.match(r.url, /^https:\/\//);
      const [m] = await listMandates(ctx, A, id.owen);
      assert.equal(m.status, "pending");
      assert.equal(m.consentChannel, "desk");
      assert.equal(m.consentRecordedBy, "user_desk_a");
      assert.equal(m.allowsNoShow, false, "no policy on → no missed-appointment consent is recorded");
      assert.match(m.consentWording, /Riverside Physio \(fictional\).*Stripe/);
      assert.ok(m.consentAt);
      fake.completeCheckout(id.acctA, m.setupRef as string);
      assert.equal(okv(await checkSavedCardFor(reception(), m.id, deps)).status, "active");
      assert.equal((await post(event("checkout.session.completed", m.setupRef as string, id.acctA))).body.result, "card_active", "idempotent");
      id.mandateOwen = m.id;
      const cards = okv(await patientCardsFor(reception(), id.owen, deps));
      assert.equal(cards?.cards[0].label, "Visa ending 4242 · expires 12/34");
    });

    it("no-show fee: refused without the clinic's policy, refused without the patient's consent, allowed with both", async () => {
      id.dna = await newInvoice(A, id.owen, 3000, "did_not_attend");
      refused(await chargeSavedCardFor(reception(), { invoiceId: id.dna, mandateId: id.mandateOwen }, deps), /does not charge missed-appointment/);
      refused(await setNoShowPolicyFor(reception(), { enabled: true, policy: "Missed appointments without 24 hours' notice are charged in full." }, deps));
      refused(await setNoShowPolicyFor(owner(), { enabled: true, policy: "short" }, deps), /policy/);
      okv(await setNoShowPolicyFor(owner(), { enabled: true, policy: "Missed appointments without 24 hours' notice are charged in full." }, deps));
      refused(await chargeSavedCardFor(reception(), { invoiceId: id.dna, mandateId: id.mandateOwen }, deps), /did not agree/);
      const r = okv(await startSaveCardFor(reception(), { patientId: id.owen, allowsNoShow: true, consentConfirmed: true, ...URLS }, deps));
      void r;
      const m = (await listMandates(ctx, A, id.owen)).find((x) => x.status === "pending")!;
      assert.equal(m.allowsNoShow, true);
      assert.match(m.consentWording, /missed appointment.*24 hours/);
      fake.completeCheckout(id.acctA, m.setupRef as string);
      assert.equal((await post(event("setup_intent.succeeded", (await fake.getCheckout(id.acctA, m.setupRef as string)).setupIntent as string, id.acctA))).body.result, "card_active");
      id.mandateNoShow = m.id;
      const charged = okv(await chargeSavedCardFor(reception(), { invoiceId: id.dna, mandateId: m.id }, deps));
      assert.equal(charged.status, "succeeded");
      assert.equal((await getInvoice(ctx, A, id.dna))!.balancePence, 0);
      // A normal invoice: any active card of the patient.
      id.inv3 = await newInvoice(A, id.owen, 2500);
      refused(await chargeSavedCardFor(reception(), { invoiceId: id.inv3, mandateId: "cmdt_00000000000000000000000000" }, deps), /not this patient/);
      okv(await chargeSavedCardFor(reception(), { invoiceId: id.inv3, mandateId: id.mandateOwen }, deps));
    });

    it("a declined saved card takes nothing and records nothing", async () => {
      okv(await startSaveCardFor(reception(), { patientId: id.megan, allowsNoShow: false, consentConfirmed: true, ...URLS }, deps));
      const m = (await listMandates(ctx, A, id.megan))[0];
      fake.completeCheckout(id.acctA, m.setupRef as string, "decline");
      okv(await checkSavedCardFor(reception(), m.id, deps));
      id.mandateMeganDecline = m.id;
      const inv = await newInvoice(A, id.megan, 1200);
      const before = (await allConnectPayments(A)).length;
      refused(await chargeSavedCardFor(reception(), { invoiceId: inv, mandateId: m.id }, deps), /declined/);
      assert.equal((await allConnectPayments(A)).length, before);
      assert.equal((await getInvoice(ctx, A, inv))!.paidPence, 0);
    });

    it("refunds: billing.refund only; partial, then the rest; never more than was paid (checked in the database)", async () => {
      const pay = (await paymentsOn(A, id.pi1))[0];
      refused(await refundCardPaymentFor(reception(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 1000, reason: "Overcharged" }, deps));
      refused(await refundCardPaymentFor(admin(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 1000, reason: "" }, deps), /why/);
      okv(await refundCardPaymentFor(admin(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 1000, reason: "Overcharged (fictional)" }, deps));
      let inv = (await getInvoice(ctx, A, id.inv1))!;
      assert.equal(inv.creditedPence, 1000, "credited first");
      assert.equal(inv.balancePence, 0, "credit note + refund keep the invoice square");
      refused(await refundCardPaymentFor(admin(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 5000, reason: "Too much" }, deps), /more than/);
      // Two at the same moment for the rest: only one can be claimed.
      const both = await Promise.all([
        refundCardPaymentFor(admin(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 4500, reason: "Rest A" }, deps),
        refundCardPaymentFor(owner(), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 4500, reason: "Rest B" }, deps),
      ]);
      assert.equal(both.filter((r) => r.ok).length, 1, "only one of two simultaneous refunds goes through");
      const refunds = (await allConnectPayments(A)).filter((p) => p.kind === "refund");
      assert.equal(refunds.reduce((a, p) => a + Number(p.amount_pence), 0), 5500, "refunded exactly what was paid");
      inv = (await getInvoice(ctx, A, id.inv1))!;
      assert.equal(inv.balancePence, 0);
      // Webhook deliveries of those refunds change nothing.
      for (const r of Array.from(fake.refunds.values()).filter((x) => x.paymentIntent === id.pi1)) {
        assert.equal((await post(event("refund.created", r.id, id.acctA))).body.result, "already");
      }
      assert.equal((await allConnectPayments(A)).filter((p) => p.kind === "refund").length, refunds.length);
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.ok(audit.some((e) => e.action === "pms.refund.record"));
    });

    it("a refund made in the provider's dashboard is recorded once; a failed refund is reversed", async () => {
      const inv = (await invoiceCardViewFor(admin(), id.inv3, deps)).ok ? okv(await invoiceCardViewFor(admin(), id.inv3, deps)) : null;
      const card = inv?.cardPayments[0];
      assert.ok(card);
      const r = fake.dashboardRefund(id.acctA, card.intentRef, 500);
      assert.equal((await post(event("refund.created", r.id, id.acctA))).body.result, "recorded");
      assert.equal((await post(event("refund.updated", r.id, id.acctA))).body.result, "already");
      assert.equal((await paymentsOn(A, r.id)).length, 1);
      fake.refunds.get(r.id)!.status = "failed";
      assert.equal((await post(event("refund.failed", r.id, id.acctA))).body.result, "refund_reversed");
      assert.equal((await paymentsOn(A, r.id))[0].status, "reversed", "takings no longer count it");
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.ok(audit.some((e) => e.action === "pms.card_refund.outside"));
    });

    it("review: a refund whose answer is lost is finished by the same refund, never made twice", async () => {
      const inv = await newInvoice(A, id.owen, 4000);
      okv(await chargeSavedCardFor(reception(), { invoiceId: inv, mandateId: id.mandateOwen }, deps));
      const view = okv(await invoiceCardViewFor(admin(), inv, deps))!;
      const pay = view.cardPayments[0];
      fake.loseRefundAnswers = 1;
      refused(await refundCardPaymentFor(admin(), { invoiceId: inv, paymentId: pay.paymentId, amountPence: 1000, reason: "Lost answer" }, deps), /did not answer/);
      assert.equal(Array.from(fake.refunds.values()).filter((r) => r.paymentIntent === pay.intentRef).length, 1, "the provider made it once");
      assert.equal((await getInvoice(ctx, A, inv))!.creditedPence, 0, "nothing credited before the refund is confirmed");
      refused(await refundCardPaymentFor(admin(), { invoiceId: inv, paymentId: pay.paymentId, amountPence: 1500, reason: "Other amount" }, deps), /still being confirmed/);
      okv(await refundCardPaymentFor(admin(), { invoiceId: inv, paymentId: pay.paymentId, amountPence: 1000, reason: "Lost answer" }, deps));
      assert.equal(Array.from(fake.refunds.values()).filter((r) => r.paymentIntent === pay.intentRef).length, 1, "still once at the provider");
      assert.equal((await allConnectPayments(A)).filter((x) => x.kind === "refund" && fake.refunds.get(x.provider_ref as string)?.paymentIntent === pay.intentRef).length, 1);
      const after = (await getInvoice(ctx, A, inv))!;
      assert.equal(after.creditedPence, 1000);
      assert.equal(after.balancePence, 0);
    });

    it("review: two members charging the same invoice's saved card at once – charged once", async () => {
      const inv = await newInvoice(A, id.owen, 2000);
      const both = await Promise.all([chargeSavedCardFor(reception(), { invoiceId: inv, mandateId: id.mandateOwen }, deps), chargeSavedCardFor(admin(), { invoiceId: inv, mandateId: id.mandateOwen }, deps)]);
      assert.equal(both.filter((r) => r.ok).length, 1);
      assert.equal(Array.from(fake.intents.values()).filter((p) => p.metadata.invoice_id === inv && p.status === "succeeded").length, 1);
      assert.equal((await getInvoice(ctx, A, inv))!.paidPence, 2000);
    });

    it("review: a saved-card charge whose answer is lost blocks a second charge and is found by Check payment", async () => {
      const inv = await newInvoice(A, id.owen, 2500);
      fake.loseAnswers = 1;
      refused(await chargeSavedCardFor(reception(), { invoiceId: inv, mandateId: id.mandateOwen }, deps), /did not answer/);
      refused(await chargeSavedCardFor(reception(), { invoiceId: inv, mandateId: id.mandateOwen }, deps), /in progress/);
      const view = okv(await invoiceCardViewFor(reception(), inv, deps))!;
      assert.ok(view.pendingReader && !view.pendingReader.onReader, "shown as in progress");
      assert.equal(okv(await checkCardPaymentFor(reception(), view.pendingReader.intentId, deps)).status, "succeeded");
      assert.equal(Array.from(fake.intents.values()).filter((p) => p.metadata.invoice_id === inv && p.status === "succeeded").length, 1, "charged once");
      assert.equal((await getInvoice(ctx, A, inv))!.balancePence, 0);
    });

    it("review: refunding the part of a card payment that sits on account does not credit the invoice", async () => {
      const inv = await newInvoice(A, id.megan, 5000);
      const s = okv(await startReaderPaymentFor(reception(), { invoiceId: inv, readerId: id.reader }, deps));
      await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-11-10", method: "cash", amountPence: 2000, allocations: [{ invoiceId: inv, amountPence: 2000 }] }, SEED);
      okv(await simulateReaderTapFor(reception(), s.intentId, undefined, deps));
      const pay = okv(await invoiceCardViewFor(admin(), inv, deps))!.cardPayments[0];
      assert.equal(pay.amountPence, 5000);
      okv(await refundCardPaymentFor(admin(), { invoiceId: inv, paymentId: pay.paymentId, amountPence: 2000, reason: "Overpaid – the cash part" }, deps));
      const after = (await getInvoice(ctx, A, inv))!;
      assert.equal(after.creditedPence, 0, "the invoice keeps its revenue");
      assert.equal(after.balancePence, 0);
    });

    it("review: duplicate deliveries of a dashboard refund record it once (no orphan claim); a failed refund before ours is recorded is retried", async () => {
      const view = okv(await invoiceCardViewFor(admin(), id.inv3, deps))!;
      const card = view.cardPayments[0];
      const r = fake.dashboardRefund(id.acctA, card.intentRef, 300);
      const results = await Promise.all([post(event("refund.created", r.id, id.acctA)), post(event("refund.updated", r.id, id.acctA))]);
      assert.ok(results.every((x) => x.status === 200), JSON.stringify(results));
      assert.equal((await paymentsOn(A, r.id)).length, 1);
      const open = await ctx.db.selectFrom("pms_card_intents").select("id").where("tenant_id", "=", A).where("kind", "=", "refund").where("parent_ref", "=", card.intentRef).where("status", "in", ["open", "processing"]).execute();
      assert.equal(open.length, 0, "no claim left holding back the rest");
      // Our own refund still being finished by the screen, and the provider already says it failed: retried later.
      const own = await createRefundIntent(ctx, A, { parentRef: card.intentRef, paymentId: card.paymentId, paymentAmountPence: card.amountPence, amountPence: 100, invoiceId: id.inv3, patientId: id.owen, feePence: 0 }, SEED);
      const failed = fake.dashboardRefund(id.acctA, card.intentRef, 100);
      failed.metadata = { tenant_id: A, card_intent_id: own.id };
      failed.status = "failed";
      assert.equal((await post(event("refund.failed", failed.id, id.acctA))).status, 409);
    });

    it("portal: pay button lists only the patient's payable invoices; payment recorded once (return page + webhook)", async () => {
      const inv = await newInvoice(A, id.megan, 7000);
      const list = await portalInvoices(ctx, A, id.megan, deps);
      assert.ok(list.payable);
      assert.ok(list.rows.some((x) => x.id === inv && x.balancePence === 7000));
      assert.ok(!(await portalInvoices(ctx, A, id.owen, deps)).rows.some((x) => x.id === inv), "never another patient's invoice");
      refused(await startPortalPayment(ctx, A, { patientId: id.owen, invoiceId: inv, ...URLS }, { userId: null, sessionId: null }, deps));
      const first = okv(await startPortalPayment(ctx, A, { patientId: id.megan, invoiceId: inv, ...URLS }, { userId: null, sessionId: null }, deps));
      const again = okv(await startPortalPayment(ctx, A, { patientId: id.megan, invoiceId: inv, ...URLS }, { userId: null, sessionId: null }, deps));
      assert.equal(again.url, first.url, "the open payment page is reused");
      const intent = (await ctx.db.selectFrom("pms_card_intents").select(["id", "checkout_ref"]).where("tenant_id", "=", A).where("invoice_id", "=", inv).where("purpose", "=", "portal").executeTakeFirstOrThrow());
      fake.completeCheckout(id.acctA, intent.checkout_ref as string);
      assert.equal((await post(event("checkout.session.completed", intent.checkout_ref as string, id.acctA))).body.result, "recorded");
      assert.equal(await completePortalPayment(ctx, A, id.megan, intent.id, deps), "paid");
      assert.equal(await completePortalPayment(ctx, A, id.owen, intent.id, deps), "unknown", "another patient learns nothing");
      const pi = (await getIntent(ctx, A, intent.id))!.intentRef as string;
      assert.equal((await post(event("payment_intent.succeeded", pi, id.acctA))).body.result, "already");
      assert.equal((await paymentsOn(A, pi)).length, 1);
      assert.equal((await getInvoice(ctx, A, inv))!.balancePence, 0);
    });

    it("memberships: consent recorded; one charge per month even with repeated and concurrent runs; declines retried then failed", async () => {
      refused(await createPlanFor(reception(), { name: "Monthly maintenance", pricePence: 4500 }, deps));
      const plan = okv(await createPlanFor(owner(), { name: "Monthly maintenance", pricePence: 4500 }, deps)).id;
      refused(await startMembershipFor(reception(), { patientId: id.owen, planId: plan, mandateId: id.mandateOwen, chargeDay: 10, consentConfirmed: false }, deps), /agreed/);
      refused(await startMembershipFor(reception(), { patientId: id.megan, planId: plan, mandateId: id.mandateOwen, chargeDay: 10, consentConfirmed: true }, deps), /saved cards/);
      const msId = okv(await startMembershipFor(reception(), { patientId: id.owen, planId: plan, mandateId: id.mandateOwen, chargeDay: 10, consentConfirmed: true }, deps)).id;
      const ms = (await getMembership(ctx, A, msId))!;
      assert.match(ms.consentWording, /£45\.00 today and then on day 10 of every month/);
      const r1 = await Promise.all([runMembershipCharges(ctx, deps), runMembershipCharges(ctx, deps)]);
      assert.equal(r1.reduce((a, r) => a + r.charged, 0), 1, "two runs at once charge once");
      assert.equal((await runMembershipCharges(ctx, deps)).charged, 0, "a second run the same day charges nothing");
      const intents = await ctx.db.selectFrom("pms_card_intents").select(["id", "period", "invoice_id", "status", "intent_ref"]).where("tenant_id", "=", A).where("membership_id", "=", msId).execute();
      assert.equal(intents.length, 1);
      assert.equal(intents[0].period, "2026-11");
      assert.equal((await getInvoice(ctx, A, intents[0].invoice_id as string))!.balancePence, 0);
      assert.equal((await getMembership(ctx, A, msId))!.nextChargeOn, "2026-12-10");
      // Next month: the answer of the first charge is lost (timeout) – the next run finds it, never charges twice.
      now = new Date("2026-12-10T10:00:00.000Z");
      fake.loseAnswers = 1;
      const lost = await runMembershipCharges(ctx, deps);
      assert.equal(lost.charged, 0, "an unanswered charge is not counted");
      assert.equal(lost.skipped, 1, "…and is looked up next run, never charged again blindly");
      now = new Date("2026-12-10T10:30:00.000Z");
      await runMembershipCharges(ctx, deps);
      const dec = await ctx.db.selectFrom("pms_card_intents").select(["id", "status", "intent_ref"]).where("tenant_id", "=", A).where("membership_id", "=", msId).where("period", "=", "2026-12").execute();
      assert.equal(dec.length, 1);
      assert.equal(dec[0].status, "succeeded");
      const decPays = await paymentsOn(A, dec[0].intent_ref as string);
      assert.equal(decPays.length, 1, "the lost charge is recorded once and not repeated");
      assert.equal(Array.from(fake.intents.values()).filter((p) => p.metadata.card_intent_id === dec[0].id && p.status === "succeeded").length, 1, "charged once at the provider");
      // A declining card: three tries, then "payment failed".
      const m2 = okv(await startMembershipFor(reception(), { patientId: id.megan, planId: plan, mandateId: id.mandateMeganDecline, chargeDay: 10, consentConfirmed: true }, deps)).id;
      for (const day of ["2026-12-10", "2026-12-11", "2026-12-12"]) {
        now = new Date(`${day}T11:00:00.000Z`);
        await runMembershipCharges(ctx, deps);
      }
      assert.equal((await getMembership(ctx, A, m2))!.status, "payment_failed");
      const m2Intents = await ctx.db.selectFrom("pms_card_intents").select(["id", "invoice_id"]).where("tenant_id", "=", A).where("membership_id", "=", m2).execute();
      assert.equal(m2Intents.length, 1, "one invoice for the month however many tries");
      assert.equal((await getInvoice(ctx, A, m2Intents[0].invoice_id as string))!.balancePence, 4500, "the invoice stays open to pay another way");
      // Removing the card cancels the memberships charged to it.
      const removed = okv(await removeSavedCardFor(reception(), id.mandateOwen, deps));
      assert.equal(removed.membershipsCancelled, 1);
      assert.equal((await getMembership(ctx, A, msId))!.status, "cancelled");
      assert.equal((await getMandate(ctx, A, id.mandateOwen))!.status, "removed");
      now = new Date("2026-11-10T10:00:00.000Z");
    });

    it("tenant isolation: another clinic's ids answer 'not found'; another clinic's metadata is ignored by the webhook", async () => {
      const bInv = await newInvoice(B, id.otherB, 3000);
      refused(await startReaderPaymentFor(reception(), { invoiceId: bInv, readerId: id.reader }, deps));
      assert.equal((await invoiceCardViewFor(owner(), bInv, deps)).ok, false);
      refused(await chargeSavedCardFor(ownerB(), { invoiceId: bInv, mandateId: id.mandateNoShow }, deps), /not this patient/);
      refused(await checkSavedCardFor(ownerB(), id.mandateNoShow, deps));
      refused(await removeSavedCardFor(ownerB(), id.mandateNoShow, deps));
      assert.equal((await patientCardsFor(ownerB(), id.owen, deps)).ok, false);
      // A payment on B's account that names A's intent in its metadata: never recorded for A or B.
      const forged = await fake.createReaderPayment(id.acctB, { amountPence: 100, feePence: 0, description: "x", metadata: { tenant_id: A, card_intent_id: id.inv1 } }, "forged-1");
      fake.intents.get(forged.id)!.status = "succeeded";
      fake.intents.get(forged.id)!.amountReceived = 100;
      assert.equal((await post(event("payment_intent.succeeded", forged.id, id.acctB))).body.result, "ignored");
      assert.equal((await post(event("payment_intent.succeeded", id.pi1, "acct_UNKNOWN0000"))).body.result, "ignored", "unknown account");
      assert.equal((await post(event("payment_intent.succeeded", id.pi1, id.acctB))).status, 502, "A's payment is not readable on B's account");
      assert.equal((await allConnectPayments(B)).length, 0);
    });

    it("webhook: bad signature 400, wrong mode ignored, no secret 503, account events sync the status", async () => {
      assert.equal((await post(event("payment_intent.succeeded", id.pi1, id.acctA), { secret: "whsec_wrong_secret_000000000000" })).status, 400);
      assert.equal((await post({ ...event("payment_intent.succeeded", id.pi1, id.acctA), livemode: true })).body.result, "ignored");
      const res = await handleConnectWebhook(new Request("https://x.test", { method: "POST", body: "{}" }), { switchOn: true, config: { ok: true, config: { ...(deps.config as { ok: true; config: ConnectConfig }).config, webhookSecrets: [] } }, ctx: () => ctx });
      assert.equal(res.status, 503);
      fake.setAccountStatus(id.acctB, "active");
      assert.equal((await post({ id: `evt_thin_${++evt}`, object: "v2.core.event", type: "v2.core.account[requirements].updated", livemode: false, related_object: { id: id.acctB, type: "v2.core.account" } })).body.result, "account_active");
      assert.equal((await getCardSettings(ctx, B)).status, "active");
    });

    it("payouts view: fees split, invoice numbers only for this clinic's own payments; managers only", async () => {
      refused(await payoutsFor(reception(), { payout: null }, deps));
      const v = okv(await payoutsFor(admin(), { payout: null }, deps))!;
      assert.ok(v.lines.length > 0);
      const charge = v.lines.find((l) => l.type === "charge" && l.invoiceId === id.inv1);
      assert.ok(charge && charge.invoiceNumber, "a charge is matched to its invoice");
      assert.equal(charge.grossPence - charge.providerFeePence - charge.platformFeePence, charge.netPence);
      assert.equal(v.totals.netPence, v.lines.reduce((a, l) => a + l.netPence, 0));
    });

    it("takings: every card payment and refund counted exactly once", async () => {
      const rows = await allConnectPayments(A);
      const refs = rows.map((r) => r.provider_ref);
      assert.equal(new Set(refs).size, refs.length, "one row per provider reference");
      const succeededIntents = await ctx.db.selectFrom("pms_card_intents").select(["payment_id"]).where("tenant_id", "=", A).where("status", "=", "succeeded").where("kind", "in", ["payment", "refund"]).execute();
      for (const i of succeededIntents) assert.ok(rows.some((r) => r.id === i.payment_id), "each succeeded intent points at its one payment");
    });

    it("offboarding deletes every card table by cascade (none is named in the batch)", async () => {
      const before = await countPmsRows(suite.db, A);
      for (const t of CARD_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows`);
      const queries = deletePmsQueries(suite.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of CARD_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
      await runBatch(suite.db, queries);
      assert.deepEqual(await countPmsRows(suite.db, A), {});
      assert.ok((await countPmsRows(suite.db, B)).pms_card_settings, "the other clinic keeps its rows");
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      if (!suite.log) return;
      // The two cross-clinic reads by design, of the settings table only: the webhook's account → clinic lookup and
      // the daily membership run's list of clinics with card payments on (each clinic is then read by its own id).
      const crossClinic = (sql: string) => /from "pms_card_settings" where "account_ref" = /.test(sql) || /from "pms_card_settings" where "enabled" = /.test(sql);
      assert.deepEqual(unscopedStatements(suite.log.statements).filter((sql) => !crossClinic(sql)), []);
    });
  });
}
