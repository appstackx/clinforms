/**
 * Text credits around real sends and payments (the comms dispatcher with the TEST and OUTBOX providers, the card
 * payment service MOCKED in memory): credits taken per segment before the provider call and returned when a text is
 * not sent; the email fallback and "no text credit"; owner/admin warnings once per crossing; automatic top-up
 * success and failure; the webhook (signature, idempotency by event and payment, tenant checks); the success page's
 * fulfilment; the card payment client's key and price checks. Fictional data only. Run by test:pms / test:db.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { testCipher } from "../../../db/testing/databases";
import type { RepoContext } from "../../../repos/context";
import { listAudit } from "../../../repos/audit";
import {
  adjustSmsCredits,
  getSmsCreditAccount,
  ledgerCheck,
  listSmsCreditEntries,
  saveAutoTopup,
  saveCreditCard,
  setCreditCustomer,
} from "../../../repos/pms/comms/credits";
import { listMessages } from "../../../repos/pms/comms/messages";
import { listSchedule, syncAppointmentMessages } from "../../../repos/pms/comms/schedule";
import { getCommsSettings, updateCommsSettings } from "../../../repos/pms/comms/settings";
import { createSite } from "../../../repos/pms/directory";
import { setEntitlement } from "../../../repos/pms/entitlements";
import { createPatient } from "../../../repos/pms/patients";
import { createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../../repos/pms/testing/guarded-db";
import { retryMessage, runDueMessages, sendAppointmentNotice, sendPatientMessage, type DispatchDeps } from "../dispatch";
import { outboxEmail, outboxSms } from "../providers/outbox";
import { clearTestOutbox, testEmail, testOutbox, testSms } from "../providers/test";
import {
  CARD_API_VERSION,
  cardPaymentsConfig,
  createCardPayments,
  signWebhookPayload,
  verifyWebhookSignature,
  type CardPayments,
  type CardPaymentsConfig,
  type CheckoutSessionInfo,
  type PaymentIntentInfo,
} from "./card-payments";
import { fulfilCheckout, type CreditNotice } from "./service";
import { handleCreditWebhook } from "./webhook";

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_a", sessionId: "sess_a" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const LINK = "link-secret-for-tests-".padEnd(43, "q");
const HOOK = "whsec_test_for_unit_tests_0123456789";
/** Made-up key shapes (built here so no scanner mistakes them for real keys). */
const FAKE_TEST = ["sk", "test", "abcdefghijklmnop"].join("_");
const FAKE_LIVE = ["sk", "live", "abcdefghijklmnop"].join("_");

/** An in-memory stand-in for the card payment service (test mode). */
class FakePayments implements CardPayments {
  readonly live = false;
  readonly mode = "test" as const;
  webhookReady = true;
  sessions = new Map<string, CheckoutSessionInfo>();
  intents = new Map<string, PaymentIntentInfo>();
  cards = new Map<string, { customer: string; last4: string }>();
  charges: { customerRef: string; methodRef: string; pack: string; idempotencyKey: string }[] = [];
  decline: string | null = null;
  async packPrices() {
    return new Map([
      ["sms_500", "price_500"],
      ["sms_1000", "price_1000"],
      ["sms_5000", "price_5000"],
    ] as const);
  }
  async createCustomer() {
    return "cus_new";
  }
  async createPackCheckout(): Promise<CheckoutSessionInfo> {
    throw new Error("not used");
  }
  async createCardCheckout(): Promise<CheckoutSessionInfo> {
    throw new Error("not used");
  }
  async getCheckoutSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }
  async getPaymentIntent(id: string) {
    const p = this.intents.get(id);
    if (!p) throw new Error("no such payment");
    return p;
  }
  async getCard(methodRef: string) {
    const c = this.cards.get(methodRef);
    if (!c) throw new Error("no such card");
    return { methodRef, customerRef: c.customer, brand: "visa", last4: c.last4, expMonth: 12, expYear: 2030 };
  }
  async chargeSavedCard(input: { tenantId: string; customerRef: string; methodRef: string; pack: { key: string; pricePence: number }; idempotencyKey: string }) {
    this.charges.push({ customerRef: input.customerRef, methodRef: input.methodRef, pack: input.pack.key, idempotencyKey: input.idempotencyKey });
    if (this.decline) return { ok: false as const, code: this.decline };
    const id = `pi_test_auto_${this.charges.length}`;
    const pi: PaymentIntentInfo = { id, status: "succeeded", amount: input.pack.pricePence, amountReceived: input.pack.pricePence, currency: "gbp", customer: input.customerRef, paymentMethod: input.methodRef, livemode: false, metadata: { tenant_id: input.tenantId, kind: "sms_auto_topup", pack: input.pack.key } };
    this.intents.set(id, pi);
    return { ok: true as const, payment: pi };
  }
}

function session(over: Partial<CheckoutSessionInfo> & { id: string }): CheckoutSessionInfo {
  return {
    mode: "payment",
    status: "complete",
    paymentStatus: "paid",
    livemode: false,
    clientReferenceId: A,
    customer: "cus_test_A",
    amountTotal: 7500,
    currency: "gbp",
    metadata: { tenant_id: A, kind: "sms_pack", pack: "sms_1000", save_card: "0" },
    paymentIntent: `pi_${over.id}`,
    paymentMethod: null,
    setupIntent: null,
    setupPaymentMethod: null,
    url: null,
    ...over,
  };
}

describe("text credits around sends and payments", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  let clock = Date.parse("2026-10-31T10:00:00.000Z");
  const ids: Record<string, string> = {};
  const notices: { tenantId: string; notice: CreditNotice }[] = [];
  const payments = new FakePayments();
  const credits = { payments: () => payments, notify: async (_c: unknown, tenantId: string, notice: CreditNotice) => void notices.push({ tenantId, notice }) };
  const test: DispatchDeps = { providers: { sms: testSms, email: testEmail }, linkSecret: LINK, linkOrigin: "https://clinic.example.com", credits };
  const outbox: DispatchDeps = { providers: { sms: outboxSms, email: outboxEmail }, linkSecret: LINK, linkOrigin: "https://clinic.example.com", credits };
  const balance = async (t = A) => (await getSmsCreditAccount(ctx, t)).balance;
  let apptN = 0;
  const book = async (patientId: string, notify: "confirmation" = "confirmation") => {
    const id = `appt_${++apptN}`;
    await syncAppointmentMessages(ctx, A, { id, patientId, startsAt: "2026-11-04T10:00:00.000Z", siteId: ids.site, active: true }, OWNER, { notify });
    return id;
  };

  before(async () => {
    g = createGuardedSqliteDb();
    ctx = { db: g.db, cipher: testCipher(), now: () => new Date((clock += 1)) };
    for (const [t, who] of [
      [A, OWNER],
      [B, OWNER_B],
    ] as const) {
      await setEntitlement(ctx, t, "clinic", { status: "trial" }, who);
    }
    const site = await createSite(ctx, A, { name: "Bletchley (fictional)", phone: "01632 960101" }, OWNER);
    const megan = await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", phoneMobile: "07700 900123", email: "megan.hart@example.com" }, OWNER);
    const noEmail = await createPatient(ctx, A, { firstName: "Nia", lastName: "Textonly (fictional)", phoneMobile: "07700 900124" }, OWNER);
    const noEmailOk = await createPatient(ctx, A, { firstName: "Ola", lastName: "Noemails (fictional)", phoneMobile: "07700 900125", email: "ola@example.com", reminderEmail: false }, OWNER);
    const failing = await createPatient(ctx, A, { firstName: "Fay", lastName: "Failing (fictional)", phoneMobile: "07700 900999" }, OWNER);
    Object.assign(ids, { site: site.id, megan: megan.id, noEmail: noEmail.id, noEmailOk: noEmailOk.id, failing: failing.id });
    // Booking confirmations by text only (so a text that cannot be paid for is the only message).
    const s = await getCommsSettings(ctx, A);
    await updateCommsSettings(ctx, A, s.rev, { confirmationsSms: true, confirmationsEmail: false }, OWNER);
  });
  after(async () => {
    await g?.close();
  });
  beforeEach(() => {
    clearTestOutbox();
  });

  it("a manual text with no credit is refused – nothing written, nothing sent", async () => {
    const r = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Your exercises are ready." }, OWNER, test);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "no_sms_credit");
    assert.match(!r.ok ? r.message : "", /Not enough text credit/);
    assert.equal((await listMessages(ctx, A)).length, 0);
    assert.equal(testOutbox.sms.length, 0);
    // An email is not affected.
    assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "email", subject: "Exercises", body: "Your exercises are ready." }, OWNER, test)).ok, true);
  });

  it("1 credit per segment of what is sent: 1 for a short text, 2 for 161–306 characters, 3 for unicode over 134", async () => {
    await adjustSmsCredits(ctx, A, { credits: 20, reason: "Test credits (fictional)" }, OWNER);
    assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "See you soon." }, OWNER, test)).ok, true);
    assert.equal(await balance(), 19);
    assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "x".repeat(200) }, OWNER, test)).ok, true);
    assert.equal(await balance(), 17);
    assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "ł".repeat(120) }, OWNER, test)).ok, true);
    assert.equal(await balance(), 15, "the clinic's short name prefix makes it 2 unicode parts or more");
    const debits = (await listSmsCreditEntries(ctx, A, { kind: "debit" })).map((e) => -e.credits);
    assert.equal(debits.reduce((a, b) => a + b, 0), 5);
    assert.equal(testOutbox.sms.length, 3);
    assert.equal((await ledgerCheck(ctx, A)).ok, true);
  });

  it("a text the provider does not accept gets its credits back (once); Retry takes them again", async () => {
    const before = await balance();
    const r = await sendPatientMessage(ctx, A, { patientId: ids.failing, channel: "sms", body: "Hello." }, OWNER, test);
    assert.equal(r.ok && r.status, "failed");
    assert.equal(await balance(), before);
    const entries = await listSmsCreditEntries(ctx, A, { limit: 2 });
    assert.deepEqual(entries.map((e) => e.kind), ["reversal", "debit"]);
    const retry = await retryMessage(ctx, A, (r as { messageId: string }).messageId, OWNER, test);
    assert.equal(retry.ok && retry.status, "failed");
    assert.equal(await balance(), before, "returned again after the retry failed");
  });

  it("the outbox keeps texts without taking credits – but only while the balance covers them", async () => {
    const before = await balance();
    const r = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Kept in the outbox." }, OWNER, outbox);
    assert.equal(r.ok && r.status, "outbox");
    assert.equal(await balance(), before);
    await adjustSmsCredits(ctx, A, { credits: -before, reason: "Empty it (fictional)" }, OWNER);
    const refused = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Kept in the outbox." }, OWNER, outbox);
    assert.equal(!refused.ok && refused.reason, "no_sms_credit");
  });

  it("the run: planned texts use credits until the balance is 0, then go by email (or are not sent) – never negative", async () => {
    notices.length = 0;
    await adjustSmsCredits(ctx, A, { credits: 3, reason: "Three texts (fictional)" }, OWNER);
    // Five confirmations by text: Megan ×3 (has email), Nia (no email), Ola (email but no emails allowed).
    const appts = [await book(ids.megan), await book(ids.megan), await book(ids.megan), await book(ids.noEmail), await book(ids.noEmailOk)];
    const r = await runDueMessages(ctx, A, test);
    assert.equal(r.claimed, 5);
    assert.equal(await balance(), 0);
    assert.equal(testOutbox.sms.length, 3, "three texts – the three credits");
    // The rest by email where the patient has an address that allows it (marked on the planned row); Nia (no email) not sent.
    const rows = (await listSchedule(ctx, A, { limit: 50 })).filter((x) => appts.includes(x.appointmentId));
    // Ola stopped REMINDER emails – a booking confirmation still goes by email (consent per kind, PECR).
    const megans = new Set([...appts.slice(0, 3), appts[4]]);
    for (const x of rows) {
      if (x.status === "skipped") {
        assert.equal(x.skipReason, "no_sms_credit");
        assert.equal(x.appointmentId, appts[3], "only Nia (no email address) is skipped");
      } else {
        assert.equal(x.status, "sent");
        if (x.skipReason === "no_sms_credit") assert.ok(megans.has(x.appointmentId), "only patients with an email address go by email instead");
      }
    }
    const byEmail = rows.filter((x) => x.status === "sent" && x.skipReason === "no_sms_credit").length;
    assert.equal(r.emailInstead ?? 0, byEmail);
    assert.equal(testOutbox.email.length, byEmail);
    assert.equal(rows.filter((x) => x.status === "sent" && !x.skipReason).length, 3);
    // Nothing negative, ledger consistent, warnings once each.
    assert.equal((await ledgerCheck(ctx, A)).ok, true);
    assert.ok((await listSmsCreditEntries(ctx, A, { limit: 200 })).every((e) => e.balanceAfter >= 0));
    // "low" went out earlier (the balance has not been above the 100 line since): only "zero" now.
    assert.deepEqual(notices.map((n) => n.notice.kind), ["zero"]);
    clearTestOutbox();
    // More bookings with no credit at all: Megan's confirmation goes by email (marked on its planned row).
    const more = await book(ids.megan);
    const r2 = await runDueMessages(ctx, A, test);
    assert.equal(r2.emailInstead, 1);
    const row = (await listSchedule(ctx, A, { limit: 50 })).find((x) => x.appointmentId === more);
    assert.deepEqual([row?.status, row?.skipReason], ["sent", "no_sms_credit"]);
    assert.equal(testOutbox.email.filter((e) => e.to === "megan.hart@example.com").length, 1);
    assert.equal(testOutbox.sms.length, 0);
    assert.deepEqual(notices.map((n) => n.notice.kind), ["zero"], "the zero warning is not repeated");
  });

  it("a waiting-list offer with no credit goes by email; without email it is not sent", async () => {
    const appointment = { startsAt: "2026-11-05T10:00:00.000Z", endsAt: "2026-11-05T10:30:00.000Z", siteId: ids.site, practitionerId: null, serviceId: null };
    const r = await sendAppointmentNotice(ctx, A, { patientId: ids.megan, kind: "offer", appointment, appointmentRef: null }, OWNER, test);
    assert.equal(r.ok, true);
    const m = (await listMessages(ctx, A, { limit: 1 }))[0];
    assert.equal(m.channel, "email");
    const none = await sendAppointmentNotice(ctx, A, { patientId: ids.noEmail, kind: "offer", appointment, appointmentRef: null }, OWNER, test);
    assert.equal(!none.ok && none.reason, "no_sms_credit");
  });

  it("buying credit again re-arms the warnings (once per crossing)", async () => {
    notices.length = 0;
    await adjustSmsCredits(ctx, A, { credits: 150, reason: "Refill (fictional)" }, OWNER);
    await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "One." }, OWNER, test);
    assert.equal(notices.length, 0, "149 is above the 100 line");
    for (let i = 0; i < 50; i++) await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: `Text ${i}.` }, OWNER, test);
    assert.equal(await balance(), 99);
    assert.deepEqual(notices.map((n) => [n.tenantId, n.notice.kind]), [[A, "low"]]);
  });

  it("automatic top-up: charges the saved card for the chosen pack BEFORE the text, once; the pack is credited once", async () => {
    await setCreditCustomer(ctx, A, "cus_test_A", OWNER);
    payments.cards.set("pm_test_A", { customer: "cus_test_A", last4: "4242" });
    await saveCreditCard(ctx, A, { customerRef: "cus_test_A", methodRef: "pm_test_A", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, OWNER);
    await saveAutoTopup(ctx, A, { enabled: true, threshold: 100, pack: "sms_500" }, OWNER);
    const r = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Top-up first." }, OWNER, test);
    assert.equal(r.ok, true);
    assert.equal(payments.charges.length, 1);
    assert.deepEqual([payments.charges[0].pack, payments.charges[0].customerRef, payments.charges[0].methodRef], ["sms_500", "cus_test_A", "pm_test_A"]);
    assert.equal(await balance(), 99 + 500 - 1);
    const [debit, topup] = await listSmsCreditEntries(ctx, A, { limit: 2 });
    assert.deepEqual([topup.kind, topup.credits, topup.paymentRef, debit.kind], ["auto_topup", 500, "pi_test_auto_1", "debit"]);
    // The provider's payment_intent.succeeded for the same payment later changes nothing.
    const hook = await webhook({ id: "evt_auto_1", type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_test_auto_1" } } });
    assert.equal(hook.status, 200);
    assert.equal(((await hook.json()) as { result: string }).result, "already");
    assert.equal(await balance(), 598);
    assert.equal(payments.charges.length, 1, "above the threshold now – no second charge");
  });

  it("automatic top-up failure: nothing credited, top-up paused, the owner told, the text goes by email or not at all", async () => {
    notices.length = 0;
    clock += 11 * 60_000; // at most one automatic top-up per 10 minutes (review fix 31/10/2026)
    await adjustSmsCredits(ctx, A, { credits: -598, reason: "Empty it (fictional)" }, OWNER);
    payments.decline = "card_declined";
    const charges = payments.charges.length;
    const appt = await book(ids.megan);
    const r = await runDueMessages(ctx, A, test);
    assert.equal(r.emailInstead, 1);
    assert.equal(payments.charges.length, charges + 1);
    const acct = await getSmsCreditAccount(ctx, A);
    assert.ok(acct.autoTopupPausedAt);
    assert.equal(acct.autoTopupFailure, "card_declined");
    assert.equal(acct.balance, 0);
    assert.ok(notices.some((n) => n.notice.kind === "topup_failed"));
    const row = (await listSchedule(ctx, A, { limit: 50 })).find((x) => x.appointmentId === appt);
    assert.deepEqual([row?.status, row?.skipReason], ["sent", "no_sms_credit"]);
    // Paused: the next text does not try the card again.
    await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "No." }, OWNER, test);
    assert.equal(payments.charges.length, charges + 1);
    payments.decline = null;
    assert.ok((await listAudit(ctx, A, { limit: 50 })).some((e) => e.action === "pms.sms_credit.topup_failed"));
  });

  const webhook = async (event: Record<string, unknown>, opts: { secret?: string; ts?: number; config?: Partial<CardPaymentsConfig> | null } = {}) => {
    const payload = JSON.stringify(event);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const req = new Request("http://localhost/api/clinic-messages/credit-payments", { method: "POST", body: payload, headers: { "stripe-signature": signWebhookPayload(payload, opts.secret ?? HOOK, ts), "content-type": "application/json" } });
    return handleCreditWebhook(req, {
      config: () => (opts.config === null ? { ok: false, reason: "off" } : { ok: true, config: { secretKey: "sk_test_x", webhookSecret: HOOK, apiBase: "http://127.0.0.1:1/v1", live: false, ...(opts.config ?? {}) } }),
      payments: () => payments,
      ctx: () => ctx,
      log: () => undefined,
    });
  };
  const completed = (id: string, evt: string) => ({ id: evt, type: "checkout.session.completed", livemode: false, data: { object: { id, object: "checkout.session" } } });

  it("webhook: closed without set-up; refuses a bad or old signature", async () => {
    assert.equal((await webhook(completed("cs_test_1", "evt_1"), { config: null })).status, 503);
    assert.equal((await webhook(completed("cs_test_1", "evt_1"), { config: { webhookSecret: null } })).status, 503);
    assert.equal((await webhook(completed("cs_test_1", "evt_1"), { secret: "whsec_someone_else_0123456789" })).status, 400);
    assert.equal((await webhook(completed("cs_test_1", "evt_1"), { ts: Math.floor(Date.now() / 1000) - 600 })).status, 400, "older than 5 minutes");
    assert.equal(await balance(), 0);
  });

  it("webhook: a paid checkout credits its pack once – a replayed event and the payment's own event change nothing", async () => {
    payments.sessions.set("cs_test_1", session({ id: "cs_test_1" }));
    payments.intents.set("pi_cs_test_1", { id: "pi_cs_test_1", status: "succeeded", amount: 7500, amountReceived: 7500, currency: "gbp", customer: "cus_test_A", paymentMethod: "pm_test_A", livemode: false, metadata: { tenant_id: A, kind: "sms_pack", pack: "sms_1000" } });
    const first = await webhook(completed("cs_test_1", "evt_1"));
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { result: string }).result, "credited");
    assert.equal(await balance(), 1000);
    for (const res of [await webhook(completed("cs_test_1", "evt_1")), await webhook(completed("cs_test_1", "evt_1b")), await webhook({ id: "evt_2", type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_cs_test_1" } } })]) {
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { result: string }).result, "already");
    }
    assert.equal(await balance(), 1000);
    const purchase = (await listSmsCreditEntries(ctx, A, { kind: "purchase" }))[0];
    assert.deepEqual([purchase.credits, purchase.pack, purchase.amountPence, purchase.paymentRef], [1000, "sms_1000", 7500, "pi_cs_test_1"]);
    assert.equal((await g.db.selectFrom("pms_sms_credit_entries").select("event_ref").where("tenant_id", "=", A).where("id", "=", purchase.id).executeTakeFirst())?.event_ref, "evt_1", "the event id is on the entry");
    const acct = await getSmsCreditAccount(ctx, A);
    assert.equal(acct.lowThreshold, 200, "20 % of the 1,000 pack");
    // The success page arriving after the webhook: "already", nothing more.
    assert.equal((await fulfilCheckout(ctx, payments, payments.sessions.get("cs_test_1")!, { expectTenantId: A })).status, "already");
  });

  it("webhook: tenant-safe – metadata and client reference must agree; the clinic's own customer; the pack's price; paid; test mode", async () => {
    const cases: [string, Partial<CheckoutSessionInfo>, string][] = [
      ["cs_test_x1", { clientReferenceId: B }, "refused"],
      ["cs_test_x2", { metadata: { tenant_id: B, kind: "sms_pack", pack: "sms_1000" }, clientReferenceId: B }, "refused"], // B has no customer / not A's
      ["cs_test_x3", { customer: "cus_someone_else" }, "refused"],
      ["cs_test_x4", { amountTotal: 100 }, "refused"],
      ["cs_test_x5", { currency: "usd" }, "refused"],
      ["cs_test_x6", { paymentStatus: "unpaid" }, "not_paid"],
      ["cs_test_x7", { metadata: { tenant_id: A, kind: "sms_pack", pack: "sms_999" } }, "refused"],
      ["cs_test_x8", { metadata: { kind: "something_else" } }, "ignored"],
      ["cs_test_x9", { livemode: true }, "refused"],
    ];
    for (const [id, over, expected] of cases) {
      payments.sessions.set(id, session({ id, ...over }));
      const res = await webhook(completed(id, `evt_${id}`));
      assert.equal(res.status, 200, id);
      assert.equal(((await res.json()) as { result: string }).result, expected, id);
    }
    assert.equal(await balance(), 1000);
    assert.equal(await balance(B), 0);
    // A live event to a test endpoint is ignored before anything is read.
    const live = await webhook({ ...completed("cs_test_1", "evt_live"), livemode: true });
    assert.equal(((await live.json()) as { result: string }).result, "ignored");
    // The success page of clinic B cannot claim clinic A's checkout.
    payments.sessions.set("cs_test_y1", session({ id: "cs_test_y1" }));
    assert.equal((await fulfilCheckout(ctx, payments, payments.sessions.get("cs_test_y1")!, { expectTenantId: B })).status, "refused");
    assert.equal(await balance(), 1000);
  });

  it("webhook: a completed card set-up saves the clinic's own card (and only its own)", async () => {
    payments.cards.set("pm_test_new", { customer: "cus_test_A", last4: "1881" });
    payments.cards.set("pm_test_foreign", { customer: "cus_other", last4: "0005" });
    payments.sessions.set("cs_test_s1", session({ id: "cs_test_s1", mode: "setup", paymentStatus: "no_payment_required", amountTotal: null, paymentIntent: null, metadata: { tenant_id: A, kind: "sms_card" }, setupIntent: "seti_1", setupPaymentMethod: "pm_test_foreign" }));
    assert.equal(((await (await webhook(completed("cs_test_s1", "evt_s1"))).json()) as { result: string }).result, "refused");
    payments.sessions.set("cs_test_s2", session({ id: "cs_test_s2", mode: "setup", paymentStatus: "no_payment_required", amountTotal: null, paymentIntent: null, metadata: { tenant_id: A, kind: "sms_card" }, setupIntent: "seti_2", setupPaymentMethod: "pm_test_new" }));
    assert.equal(((await (await webhook(completed("cs_test_s2", "evt_s2"))).json()) as { result: string }).result, "card_saved");
    assert.equal((await getSmsCreditAccount(ctx, A)).card?.last4, "1881");
  });

  it("every statement named its clinic", () => {
    assert.deepEqual(unscopedStatements(g.log.statements), []);
  });
});

describe("card payment client (no network)", () => {
  it("keys: test keys only, unless live is switched on; the address must be the provider's or this machine's", () => {
    assert.equal(cardPaymentsConfig({}).ok, false);
    assert.equal(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: "nonsense" }).ok, false);
    const t = cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST, STRIPE_CLINDESK_WEBHOOK_SECRET: HOOK });
    assert.ok(t.ok && !t.config.live && t.config.webhookSecret === HOOK && t.config.apiBase === "https://api.stripe.com/v1");
    assert.equal(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_LIVE }).ok, false, "live refused by default");
    const live = cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_LIVE, STRIPE_CLINDESK_ALLOW_LIVE: "1" });
    assert.ok(live.ok && live.config.live);
    assert.equal(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_LIVE, STRIPE_CLINDESK_ALLOW_LIVE: "1", STRIPE_CLINDESK_API_BASE: "http://127.0.0.1:9/v1" }).ok, false, "live never to a stand-in");
    assert.equal(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST, STRIPE_CLINDESK_API_BASE: "https://evil.example.com/v1" }).ok, false);
    assert.ok(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST, STRIPE_CLINDESK_API_BASE: "http://127.0.0.1:9/v1" }).ok);
  });

  it("every request is pinned to the API version and refuses an answer in the wrong mode; prices must match the packs", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    let prices: Record<string, unknown>[] = [
      { id: "price_1", lookup_key: "sms_500", unit_amount: 4000, currency: "gbp", type: "one_time", active: true, metadata: { sms_credits: "500" }, livemode: false },
      { id: "price_2", lookup_key: "sms_1000", unit_amount: 7500, currency: "gbp", type: "one_time", active: true, metadata: { sms_credits: "1000" }, livemode: false },
    ];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ object: "list", data: prices, livemode: false }), { status: 200 });
    };
    const client = createCardPayments({ secretKey: FAKE_TEST, webhookSecret: null, apiBase: "http://127.0.0.1:9/v1", live: false }, fetchImpl);
    const map = await client.packPrices();
    assert.deepEqual(Array.from(map.entries()), [
      ["sms_500", "price_1"],
      ["sms_1000", "price_2"],
    ]);
    assert.equal(seen[0].headers["stripe-version"], CARD_API_VERSION);
    assert.match(seen[0].url, /lookup_keys%5B%5D|lookup_keys\[\]/);
    prices = [{ ...prices[0], unit_amount: 2999 }];
    const fresh = createCardPayments({ secretKey: FAKE_TEST, webhookSecret: null, apiBase: "http://127.0.0.1:9/v1", live: false }, fetchImpl);
    await assert.rejects(fresh.packPrices(), /does not match/);
    const liveAnswer = createCardPayments({ secretKey: FAKE_TEST, webhookSecret: null, apiBase: "http://127.0.0.1:9/v1", live: false }, async () => new Response(JSON.stringify({ id: "cus_1", livemode: true }), { status: 200 }));
    await assert.rejects(liveAnswer.createCustomer({ tenantId: A, clinicName: "Riverside (fictional)" }), /wrong mode/);
  });

  it("an off-session decline is an answer (code), not an error", async () => {
    const client = createCardPayments(
      { secretKey: FAKE_TEST, webhookSecret: null, apiBase: "http://127.0.0.1:9/v1", live: false },
      async () => new Response(JSON.stringify({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds" } }), { status: 402 }),
    );
    const r = await client.chargeSavedCard({ tenantId: A, customerRef: "cus_1", methodRef: "pm_1", pack: { key: "sms_500", credits: 500, pricePence: 3000 }, idempotencyKey: "topup_1" });
    assert.deepEqual(r, { ok: false, code: "insufficient_funds" });
  });

  it("webhook signatures: right secret and fresh only; any of several v1 signatures may match", () => {
    const now = 1_800_000_000;
    const payload = '{"id":"evt_1"}';
    const header = signWebhookPayload(payload, HOOK, now);
    assert.equal(verifyWebhookSignature(payload, header, HOOK, now), true);
    assert.equal(verifyWebhookSignature(payload, header, HOOK, now + 301), false);
    assert.equal(verifyWebhookSignature(`${payload} `, header, HOOK, now), false, "the body changed");
    assert.equal(verifyWebhookSignature(payload, header, "whsec_other_secret_value", now), false);
    assert.equal(verifyWebhookSignature(payload, `${header},v1=${"0".repeat(64)}`, HOOK, now), true);
    assert.equal(verifyWebhookSignature(payload, null, HOOK, now), false);
    assert.equal(verifyWebhookSignature(payload, "t=abc,v1=zz", HOOK, now), false);
  });
});
