/**
 * The 31/10/2026 review of prepaid text credits (dabc2b5) – one test per finding, on a fresh SQLite database with the
 * card payment service MOCKED in memory. Fictional data only. Run by test:pms / test:db.
 *
 *   1  test mode never leaks into live: a test key is refused once live billing is required; customers, cards and
 *      paid entries carry their mode; a test customer is replaced (card cleared) in live mode; the go-live clean-up
 *      reverses test-mode packs once, with a reason;
 *   2  automatic top-up: the trigger level never exceeds the pack, at most one attempt per 10 minutes;
 *   3  a paid payment that is refused raises an alert; no automatic top-up without the webhook; a charge that could
 *      not be recorded is not charged again and is credited by the webhook;
 *   4/5 credits are settled even when recording the provider's answer fails (single send and the message run);
 *   6  a provider call without an answer keeps its credits (the text may have gone);
 *   +  a platform adjustment submitted twice is applied once.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import { goLiveTextCredits, GO_LIVE_REASON } from "../../../admin/billing-go-live";
import { testCipher } from "../../../db/testing/databases";
import type { Database } from "../../../db/schema";
import type { RepoContext } from "../../../repos/context";
import {
  adjustSmsCredits,
  creditSmsPack,
  getSmsCreditAccount,
  ledgerCheck,
  listSmsCreditEntries,
  saveAutoTopup,
  saveCreditCard,
  setCreditCustomer,
} from "../../../repos/pms/comms/credits";
import { listMessages } from "../../../repos/pms/comms/messages";
import { syncAppointmentMessages } from "../../../repos/pms/comms/schedule";
import { getCommsSettings, updateCommsSettings } from "../../../repos/pms/comms/settings";
import { createSite } from "../../../repos/pms/directory";
import { setEntitlement } from "../../../repos/pms/entitlements";
import { createPatient } from "../../../repos/pms/patients";
import { createGuardedSqliteDb, type GuardedDb } from "../../../repos/pms/testing/guarded-db";
import { effectiveTopUpThreshold, topUpDue, AutoTopupInputSchema } from "../../../../modules/pms/comms/credits";
import { PROVIDER_UNKNOWN, runDueMessages, sendPatientMessage, type DispatchDeps } from "../dispatch";
import type { SmsProvider } from "../providers";
import { testEmail } from "../providers/test";
import { billingLiveRequired, cardPaymentsConfig, signWebhookPayload, type CardPayments, type CheckoutSessionInfo, type PaymentIntentInfo } from "./card-payments";
import { clinicCustomerRef } from "./customer";
import { autoTopUpIfDue } from "./service";
import { saveAutoTopupFor, TOPUP_NEEDS_WEBHOOK } from "./views";
import { handleCreditWebhook } from "./webhook";

const A = "review-a";
const OWNER = { userId: "user_owner_ra", sessionId: "sess_ra" };
const HOOK = "whsec_test_for_unit_tests_0123456789";
const FAKE_TEST = ["sk", "test", "abcdefghijklmnop"].join("_");
const FAKE_LIVE = ["sk", "live", "abcdefghijklmnop"].join("_");

class Fake implements CardPayments {
  static payments = 0;
  constructor(
    readonly live = false,
    public webhookReady = true,
  ) {}
  get mode() {
    return this.live ? ("live" as const) : ("test" as const);
  }
  charges = 0;
  customers = 0;
  onCharge: (() => void) | null = null;
  intents = new Map<string, PaymentIntentInfo>();
  sessions = new Map<string, CheckoutSessionInfo>();
  async packPrices() {
    return new Map();
  }
  async createCustomer() {
    this.customers++;
    return this.live ? `cus_live_${this.customers}` : `cus_test_${this.customers}`;
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
    return { methodRef, customerRef: "cus_test_A", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 };
  }
  async chargeSavedCard(input: { tenantId: string; customerRef: string; methodRef: string; pack: { key: string; pricePence: number }; idempotencyKey: string }) {
    this.charges++;
    this.onCharge?.();
    const id = `pi_test_review_${++Fake.payments}`;
    const pi: PaymentIntentInfo = { id, status: "succeeded", amount: input.pack.pricePence, amountReceived: input.pack.pricePence, currency: "gbp", customer: input.customerRef, paymentMethod: input.methodRef, livemode: this.live, metadata: { tenant_id: input.tenantId, kind: "sms_auto_topup", pack: input.pack.key } };
    this.intents.set(id, pi);
    return { ok: true as const, payment: pi };
  }
}

describe("text credits – review fixes (31/10/2026)", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  let clock = Date.parse("2026-10-31T10:00:00.000Z");
  /** The next runBatch through ctx.db fails once (recording a provider's answer). */
  let failNextBatch = false;
  const ids: Record<string, string> = {};
  const balance = async () => (await getSmsCreditAccount(ctx, A)).balance;
  const provider = (send: SmsProvider["send"]): SmsProvider => ({ id: "test", mode: "test", send });
  const deps = (sms: SmsProvider, payments?: CardPayments): DispatchDeps => ({ providers: { sms, email: testEmail }, linkSecret: null, linkOrigin: "https://clinic.example.com", credits: payments ? { payments: () => payments } : {} });

  before(async () => {
    g = createGuardedSqliteDb();
    const failing = new Proxy(g.db, {
      get(target, key) {
        if (key === "transaction" && failNextBatch) {
          failNextBatch = false;
          return () => ({ execute: async () => Promise.reject(new Error("database went away (simulated)")) });
        }
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Kysely<Database>;
    ctx = { db: failing, cipher: testCipher(), now: () => new Date((clock += 1)) };
    await setEntitlement(ctx, A, "clinic", { status: "trial" }, OWNER);
    const site = await createSite(ctx, A, { name: "Review site (fictional)", phone: "01632 960102" }, OWNER);
    const p = await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", phoneMobile: "07700 900123", email: "megan.hart@example.com" }, OWNER);
    Object.assign(ids, { site: site.id, megan: p.id });
    const s = await getCommsSettings(ctx, A);
    await updateCommsSettings(ctx, A, s.rev, { confirmationsSms: true, confirmationsEmail: false }, OWNER);
  });
  after(async () => {
    await g?.close();
  });

  it("1: a test key is refused once live billing is required (the flag, or a live text provider)", () => {
    assert.equal(cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST }).ok, true);
    assert.equal(billingLiveRequired({ CLINDESK_BILLING_LIVE: "1" }), true);
    assert.equal(billingLiveRequired({ CLINIC_SMS_PROVIDER: "outbox" }), false);
    assert.equal(billingLiveRequired({ CLINIC_SMS_PROVIDER: "test" }), false);
    assert.equal(billingLiveRequired({ CLINIC_SMS_PROVIDER: "realtexts" }), true, "a provider that really sends");
    const off = cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST, CLINDESK_BILLING_LIVE: "1" });
    assert.equal(off.ok, false);
    assert.match(!off.ok ? off.reason : "", /live payments only/);
    const live = cardPaymentsConfig({ STRIPE_CLINDESK_SECRET_KEY: FAKE_LIVE, STRIPE_CLINDESK_ALLOW_LIVE: "1", CLINDESK_BILLING_LIVE: "1" });
    assert.equal(live.ok && live.config.mode, "live");
  });

  it("1: paid entries carry their mode; a purchase without one is refused", async () => {
    const r = await creditSmsPack(ctx, A, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_mode_1" }, OWNER);
    assert.equal(r.ok, true);
    assert.equal((await listSmsCreditEntries(ctx, A, { kind: "purchase" }))[0].mode, "test");
    await assert.rejects(creditSmsPack(ctx, A, { kind: "purchase", mode: "x" as never, pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_mode_2" }, OWNER), /payment mode/);
  });

  it("1: a test customer and its card are never reused in live mode", async () => {
    await setCreditCustomer(ctx, A, "cus_test_A", OWNER, "test");
    await saveCreditCard(ctx, A, { customerRef: "cus_test_A", methodRef: "pm_test_A", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, OWNER);
    const testFake = new Fake(false);
    assert.equal(await clinicCustomerRef(ctx, { tenantId: A, clinicName: "Review (fictional)" }, testFake, OWNER), "cus_test_A", "test mode reuses its own");
    assert.equal(testFake.customers, 0);
    const liveFake = new Fake(true);
    const ref = await clinicCustomerRef(ctx, { tenantId: A, clinicName: "Review (fictional)" }, liveFake, OWNER);
    assert.equal(ref, "cus_live_1");
    const acct = await getSmsCreditAccount(ctx, A);
    assert.deepEqual([acct.customerRef, acct.customerMode, acct.card, acct.autoTopup], ["cus_live_1", "live", null, false]);
    // And back to test for the rest of this suite (a sandbox clinic).
    await clinicCustomerRef(ctx, { tenantId: A, clinicName: "Review (fictional)" }, new Fake(false), OWNER);
    assert.equal((await getSmsCreditAccount(ctx, A)).customerMode, "test");
  });

  it("2: the trigger level may not exceed the pack; a stored one is capped", async () => {
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: 600, pack: "sms_500" }).success, false);
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: 500, pack: "sms_500" }).success, true);
    assert.equal(effectiveTopUpThreshold(6000, "sms_500"), 500);
    assert.equal(topUpDue({ autoTopup: true, paused: false, hasCard: true, pack: "sms_500", balance: 900, threshold: 6000 }, 1), false, "a balance above the pack never triggers");
    await assert.rejects(saveAutoTopup(ctx, A, { enabled: false, threshold: 1001, pack: "sms_1000" }, OWNER), /at most 1,000/);
  });

  it("2/3: at most one automatic top-up per 10 minutes, never without the webhook", async () => {
    const acct = await getSmsCreditAccount(ctx, A);
    const customer = acct.customerRef as string;
    await saveCreditCard(ctx, A, { customerRef: customer, methodRef: "pm_test_B", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, OWNER);
    await saveAutoTopup(ctx, A, { enabled: true, threshold: 500, pack: "sms_500" }, OWNER);
    await adjustSmsCredits(ctx, A, { credits: -(await balance()), reason: "Empty it (fictional)" }, OWNER);
    const noHook = new Fake(false, false);
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => noHook }), "unavailable");
    assert.equal(noHook.charges, 0);
    const fake = new Fake(false, true);
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => fake }), "topped_up");
    // Take it all again: due at once, but within 10 minutes no second charge.
    await adjustSmsCredits(ctx, A, { credits: -(await balance()), reason: "Empty it again (fictional)" }, OWNER);
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => fake }), "busy");
    assert.equal(fake.charges, 1);
    clock += 11 * 60_000;
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => fake }), "topped_up");
    assert.equal(fake.charges, 2);
    assert.equal((await ledgerCheck(ctx, A)).ok, true);
    // The page refuses switching it on without the signing secret.
    const actor = { tenantId: A, clinicName: "Review (fictional)", role: "owner", can: () => true, actor: OWNER, repo: () => ctx };
    const r = await saveAutoTopupFor(actor, { enabled: true, threshold: 100, pack: "sms_500" }, { STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST });
    assert.deepEqual(r, { ok: false, error: TOPUP_NEEDS_WEBHOOK });
  });

  it("3: a charge that could not be recorded is not charged again – the webhook credits it once", async () => {
    clock += 11 * 60_000;
    await adjustSmsCredits(ctx, A, { credits: -(await balance()), reason: "Empty it (fictional)" }, OWNER);
    const fake = new Fake(false, true);
    fake.onCharge = () => void (failNextBatch = true); // the credit's batch fails right after the charge
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => fake }), "pending");
    assert.equal(fake.charges, 1);
    assert.equal(await balance(), 0);
    fake.onCharge = null;
    assert.equal(await autoTopUpIfDue(ctx, A, 1, { payments: () => fake }), "busy", "no second charge for the same need");
    const payload = JSON.stringify({ id: "evt_review_pending", type: "payment_intent.succeeded", livemode: false, data: { object: { id: `pi_test_review_${Fake.payments}` } } });
    const res = await handleCreditWebhook(new Request("http://localhost/x", { method: "POST", body: payload, headers: { "stripe-signature": signWebhookPayload(payload, HOOK, Math.floor(Date.now() / 1000)) } }), {
      config: () => ({ ok: true, config: { secretKey: FAKE_TEST, webhookSecret: HOOK, apiBase: "http://127.0.0.1:1/v1", live: false } }),
      payments: () => fake,
      ctx: () => ctx,
      log: () => undefined,
    });
    assert.equal(((await res.json()) as { result: string }).result, "credited");
    assert.equal(await balance(), 500);
  });

  it("3: a paid payment that is refused raises an alert (and is still answered 200)", async () => {
    const fake = new Fake(false, true);
    fake.intents.set("pi_test_other", { id: "pi_test_other", status: "succeeded", amount: 4000, amountReceived: 4000, currency: "gbp", customer: "cus_someone_else", paymentMethod: null, livemode: false, metadata: { tenant_id: A, kind: "sms_pack", pack: "sms_500" } });
    const alerts: { why: string; tenantId: string | null }[] = [];
    const payload = JSON.stringify({ id: "evt_review_refused", type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_test_other", metadata: { tenant_id: A } } } });
    const res = await handleCreditWebhook(new Request("http://localhost/x", { method: "POST", body: payload, headers: { "stripe-signature": signWebhookPayload(payload, HOOK, Math.floor(Date.now() / 1000)) } }), {
      config: () => ({ ok: true, config: { secretKey: FAKE_TEST, webhookSecret: HOOK, apiBase: "http://127.0.0.1:1/v1", live: false } }),
      payments: () => fake,
      ctx: () => ctx,
      log: () => undefined,
      alert: async (a) => void alerts.push({ why: a.why, tenantId: a.tenantId }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(alerts, [{ why: "customer_mismatch", tenantId: A }]);
  });

  it("4/5: credits are settled when recording the provider's answer fails (single send)", async () => {
    await saveAutoTopup(ctx, A, { enabled: false, threshold: 100, pack: "sms_500" }, OWNER);
    const before = await balance();
    const failingAnswer = provider(async () => {
      failNextBatch = true; // recordSendOutcomes is the next batch
      return { status: "failed", errorCode: "rejected_by_network" };
    });
    await assert.rejects(sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Hello." }, OWNER, deps(failingAnswer)));
    assert.equal(await balance(), before, "the credit came back although the answer was not recorded");
  });

  it("4/5: … and in the message run", async () => {
    const before = await balance();
    await syncAppointmentMessages(ctx, A, { id: "appt_review_1", patientId: ids.megan, startsAt: "2026-11-04T10:00:00.000Z", siteId: ids.site, active: true }, OWNER, { notify: "confirmation" });
    const failingAnswer = provider(async () => {
      failNextBatch = true;
      return { status: "failed", errorCode: "rejected_by_network" };
    });
    await assert.rejects(runDueMessages(ctx, A, deps(failingAnswer)));
    assert.equal(await balance(), before);
    assert.equal((await ledgerCheck(ctx, A)).ok, true);
  });

  it("6: a provider call without an answer keeps its credits and is marked unknown", async () => {
    const before = await balance();
    const silent = provider(async () => {
      throw new Error("timed out (simulated)");
    });
    const r = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "Did it go?" }, OWNER, deps(silent));
    assert.equal(r.ok && r.status, "failed");
    assert.equal(await balance(), before - 1, "no refund: the text may have gone");
    const m = (await listMessages(ctx, A, { limit: 1 }))[0];
    assert.equal(m.errorCode, PROVIDER_UNKNOWN);
  });

  it("+: a platform adjustment submitted twice is applied once", async () => {
    const before = await balance();
    const first = await adjustSmsCredits(ctx, A, { credits: 10, reason: "Goodwill (fictional)" }, OWNER, {}, { requestId: "form_review_0001" });
    const second = await adjustSmsCredits(ctx, A, { credits: 10, reason: "Goodwill (fictional)" }, OWNER, {}, { requestId: "form_review_0001" });
    assert.equal(first.ok, true);
    assert.deepEqual(second, { ok: false, reason: "duplicate" });
    assert.equal(await balance(), before + 10);
  });

  it("1: go-live – preview changes nothing; confirm clears the test customer and reverses test packs once, with a reason", async () => {
    const preview = await goLiveTextCredits(g.db);
    assert.equal(preview.dryRun, true);
    const row = preview.clinics.find((c) => c.tenantId === A);
    assert.ok(row && row.hadTestCustomer && row.testPurchases >= 1);
    assert.ok((await getSmsCreditAccount(ctx, A)).customerRef, "preview wrote nothing");
    const before = await balance();
    const done = await goLiveTextCredits(g.db, { confirm: true });
    const taken = done.clinics.find((c) => c.tenantId === A)?.creditsTakenOff ?? 0;
    assert.ok(taken > 0);
    assert.equal(await balance(), before - taken);
    const acct = await getSmsCreditAccount(ctx, A);
    assert.deepEqual([acct.customerRef, acct.card, acct.autoTopup], [null, null, false]);
    const reversals = (await listSmsCreditEntries(ctx, A, { kind: "adjustment", limit: 50 })).filter((e) => e.reason === GO_LIVE_REASON);
    assert.ok(reversals.length >= 1 && reversals.every((e) => e.reversesId && e.credits < 0));
    const again = await goLiveTextCredits(g.db, { confirm: true });
    assert.equal(again.clinics.find((c) => c.tenantId === A)?.creditsTakenOff ?? 0, 0, "a second run reverses nothing twice");
    assert.equal((await ledgerCheck(ctx, A)).ok, true);
  });
});
