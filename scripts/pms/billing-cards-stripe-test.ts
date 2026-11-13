/**
 * Card payments – END TO END against the payment provider's REAL TEST API (never live): two fictional clinics, each
 * with its own NEW test connected account (Accounts v2), run through the clinic system's own services on a fresh
 * in-memory database:
 *
 *   connect (account + onboarding link) → enable → simulated reader per site → desk payment on the reader (tap a test
 *   card) → recorded once (screen + signed webhook + duplicate) → declined test card → saved card with consent (the
 *   provider's card form's set-up confirmed with a test card) → saved-card charge → no-show rules → refund (partial,
 *   over-refund refused) → refund webhook → membership run (charged once, second run charges nothing) → portal
 *   checkout opened → payouts / balance lines matched to invoices → tenant isolation (clinic B cannot read A's
 *   payment) → BOTH test accounts CLOSED at the end (also when a step fails).
 *
 *   STRIPE_CLINDESK_TEST_SECRET_KEY=… npx tsx scripts/pms/billing-cards-stripe-test.ts
 *   (or: npm run -s admin:with-env … – read the key from the secrets file by NAME; never print it)
 *
 * Refuses anything but a TEST key. Webhooks are signed locally with a throwaway secret (the objects they name are the
 * real test objects; the handler re-reads them from the provider). Fictional data only. Exit 1 on any failure.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { testCipher } from "../../src/server/db/testing/databases";
import { createSite, createService } from "../../src/server/repos/pms/directory";
import { createPatient } from "../../src/server/repos/pms/patients";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../src/server/repos/pms/billing/invoices";
import { getCardSettings, getIntent, listMandates } from "../../src/server/repos/pms/billing/card-payments";
import { createGuardedSqliteDb } from "../../src/server/repos/pms/testing/guarded-db";
import type { RepoContext } from "../../src/server/repos/context";
import { testActor } from "../../src/server/pms/billing/access";
import { connectConfig } from "../../src/server/pms/billing/connect/client";
import { runMembershipCharges } from "../../src/server/pms/billing/connect/memberships-run";
import {
  addReaderFor,
  chargeSavedCardFor,
  checkCardPaymentFor,
  checkSavedCardFor,
  connectAccountFor,
  createPlanFor,
  payoutsFor,
  refundCardPaymentFor,
  setCardPaymentsEnabledFor,
  setNoShowPolicyFor,
  simulateReaderTapFor,
  startMembershipFor,
  startPortalPayment,
  startReaderPaymentFor,
  startSaveCardFor,
  type CardDeps,
} from "../../src/server/pms/billing/connect/service";
import { handleConnectWebhook } from "../../src/server/pms/billing/connect/webhook";
import { CARD_API_VERSION, signWebhookPayload } from "../../src/server/pms/comms/credits/card-payments";

const KEY = (process.env.STRIPE_CLINDESK_TEST_SECRET_KEY ?? "").trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(KEY)) {
  console.error("Refused: STRIPE_CLINDESK_TEST_SECRET_KEY must be a TEST key (sk_test_… / rk_test_…).");
  process.exit(1);
}
const HOOK = `whsec_local_${randomBytes(16).toString("hex")}`;
const cfg = connectConfig({ STRIPE_CLINDESK_SECRET_KEY: KEY, STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET: HOOK });
if (!cfg.ok || cfg.config.mode !== "test") {
  console.error("Refused: the configuration is not test mode.");
  process.exit(1);
}
const deps: CardDeps = { switchOn: true, config: cfg };
const api = cfg.config.api;

const RUN = randomBytes(3).toString("hex");
const A = `e2e-cards-a-${RUN}`;
const B = `e2e-cards-b-${RUN}`;
const SEED = { userId: "user_seed", sessionId: "sess_seed" };
const URLS = { successUrl: "http://localhost:3999/back", cancelUrl: "http://localhost:3999/cancel" };
const steps: { name: string; ok: boolean; note?: string }[] = [];

async function step(name: string, work: () => Promise<string | void>) {
  try {
    const note = await work();
    steps.push({ name, ok: true, note: note ?? undefined });
    console.log(`  ok   ${name}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    steps.push({ name, ok: false, note: err instanceof Error ? err.message : String(err) });
    console.log(`  FAIL ${name} – ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
const okv = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/**
 * The patient's side of the card form, TEST MODE ONLY: the hosted form cannot be filled from a script, so the card is
 * set up the way the form would (a set-up intent on the clinic's account for the patient's customer, our metadata,
 * the provider's test card pm_card_visa) and the provider's setup_intent.succeeded event is delivered.
 */
async function setUpTestCard(account: string, customer: string, metadata: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({ customer, payment_method: "pm_card_visa", confirm: "true", usage: "off_session", "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never" });
  for (const [k, v] of Object.entries(metadata)) body.set(`metadata[${k}]`, v);
  const res = await fetch("https://api.stripe.com/v1/setup_intents", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "stripe-version": CARD_API_VERSION, "stripe-account": account, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as { id?: string; status?: string; livemode?: boolean };
  if (json.livemode !== false || json.status !== "succeeded" || !json.id) throw new Error(`test card not set up (${res.status} ${json.status ?? ""})`);
  return json.id;
}

async function main() {
  const db = createGuardedSqliteDb();
  let now = new Date();
  const ctx: RepoContext = { db: db.db, cipher: testCipher(), now: () => now };
  const owner = (t: string) => ({ ...testActor(ctx, t, "owner", { userId: `user_owner_${t}`, name: "Owner (fictional)" }), clinicName: t === A ? "E2E Riverside Physio (fictional)" : "E2E Harbour Physio (fictional)", email: "owner@example.test" });
  const desk = (t: string) => ({ ...testActor(ctx, t, "staff", { userId: `user_desk_${t}`, name: "Desk (fictional)" }), clinicName: "E2E (fictional)" });
  const admin = (t: string) => ({ ...testActor(ctx, t, "admin", { userId: `user_admin_${t}`, name: "Admin (fictional)" }), clinicName: "E2E (fictional)" });
  const id: Record<string, string> = {};
  const accounts: string[] = [];
  const hook = async (type: string, objectId: string, account: string, eventId = `evt_e2e_${randomBytes(6).toString("hex")}`) => {
    const payload = JSON.stringify({ id: eventId, type, livemode: false, account, data: { object: { id: objectId } } });
    const sig = signWebhookPayload(payload, HOOK, Math.floor(Date.now() / 1000));
    const res = await handleConnectWebhook(new Request("http://localhost/api/billing/connect-webhook", { method: "POST", body: payload, headers: { "stripe-signature": sig } }), { switchOn: true, config: cfg, ctx: () => ctx, log: () => undefined });
    return { status: res.status, result: String(((await res.json()) as { result?: string }).result ?? "") };
  };
  const invoice = async (t: string, patient: string, pence: number, visitStatus: "attended" | "did_not_attend" = "attended") => {
    const { invoice: inv } = await createDraftInvoice(ctx, t, { patientId: patient, siteId: id[`site_${t}`], lines: [{ kind: "service", serviceId: id[`svc_${t}`], serviceOn: "2026-11-12", unitPricePence: pence, visitStatus }] }, SEED);
    const r = await issueInvoice(ctx, t, inv.id, inv.rev, {}, SEED);
    if (!r.ok) throw new Error("issue failed");
    return inv.id;
  };
  const paymentsByRef = async (t: string, ref: string) => db.db.selectFrom("pms_payments").select(["id", "amount_pence", "kind"]).where("tenant_id", "=", t).where("provider", "=", "stripe_connect").where("provider_ref", "=", ref).execute();

  console.log("Card payments – real TEST API run");
  try {
    for (const t of [A, B]) {
      id[`site_${t}`] = (await createSite(ctx, t, { name: "Main site (fictional)" }, SEED)).id;
      id[`svc_${t}`] = (await createService(ctx, t, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id[`pat_${t}`] = (await createPatient(ctx, t, { firstName: "Test", lastName: t === A ? "Patient-A" : "Patient-B", dateOfBirth: "1990-04-02" }, SEED)).id;
    }

    await step("connect: a new test connected account per clinic + onboarding link", async () => {
      for (const t of [A, B]) {
        const r = okv(await connectAccountFor(owner(t), { refreshUrl: "http://localhost:3999/refresh", returnUrl: "http://localhost:3999/return" }, deps));
        assert.match(r.url, /^https:\/\/connect\.stripe\.com\//);
        const s = await getCardSettings(ctx, t);
        assert.match(s.accountRef ?? "", /^acct_/);
        accounts.push(s.accountRef as string);
        id[`acct_${t}`] = s.accountRef as string;
      }
      okv(await connectAccountFor(owner(A), { refreshUrl: "http://localhost:3999/refresh", returnUrl: "http://localhost:3999/return" }, deps));
      assert.equal((await getCardSettings(ctx, A)).accountRef, id[`acct_${A}`], "resume keeps the account");
      return `${accounts.length} accounts, status ${(await getCardSettings(ctx, A)).status}`;
    });

    await step("enable (test mode allows an unverified test account)", async () => {
      okv(await setCardPaymentsEnabledFor(owner(A), true, deps));
      okv(await setCardPaymentsEnabledFor(owner(B), true, deps));
    });

    await step("simulated reader registered at the site (location made on the clinic's account)", async () => {
      id.reader = okv(await addReaderFor(owner(A), { siteId: id[`site_${A}`], label: "Front desk (test)", registrationCode: "", line1: "1 Test Street", city: "London", postcode: "SW1A 1AA" }, deps)).id;
    });

    await step("desk payment on the reader: tap a test card → recorded once", async () => {
      id.inv1 = await invoice(A, id[`pat_${A}`], 5500);
      const s = okv(await startReaderPaymentFor(desk(A), { invoiceId: id.inv1, readerId: id.reader }, deps));
      id.intent1 = s.intentId;
      const r = okv(await simulateReaderTapFor(desk(A), s.intentId, undefined, deps));
      assert.equal(r.status, "succeeded", r.message);
      id.pi1 = (await getIntent(ctx, A, s.intentId))!.intentRef as string;
      okv(await checkCardPaymentFor(desk(A), s.intentId, deps));
      const evt = `evt_e2e_dup_${randomBytes(4).toString("hex")}`;
      assert.equal((await hook("payment_intent.succeeded", id.pi1, id[`acct_${A}`], evt)).result, "already");
      assert.equal((await hook("payment_intent.succeeded", id.pi1, id[`acct_${A}`], evt)).result, "duplicate");
      assert.equal((await paymentsByRef(A, id.pi1)).length, 1);
      assert.equal((await getInvoice(ctx, A, id.inv1))!.balancePence, 0);
      const pi = await api.getPaymentIntent(id[`acct_${A}`], id.pi1);
      assert.equal(pi.applicationFee, 0, "no platform fee by default");
      return `${id.pi1}, card ${pi.card?.brand} ${pi.card?.last4}`;
    });

    await step("declined test card on the reader takes nothing", async () => {
      const inv = await invoice(A, id[`pat_${A}`], 2000);
      const s = okv(await startReaderPaymentFor(desk(A), { invoiceId: inv, readerId: id.reader }, deps));
      const r = okv(await simulateReaderTapFor(desk(A), s.intentId, "4000000000009995", deps));
      assert.notEqual(r.status, "succeeded");
      assert.equal((await getInvoice(ctx, A, inv))!.paidPence, 0);
      return r.status;
    });

    await step("saved card: consent recorded, provider's card form confirmed with a test card", async () => {
      okv(await setNoShowPolicyFor(owner(A), { enabled: true, policy: "Missed appointments without 24 hours' notice are charged in full (fictional policy)." }, deps));
      okv(await startSaveCardFor(desk(A), { patientId: id[`pat_${A}`], allowsNoShow: true, consentConfirmed: true, ...URLS }, deps));
      const m = (await listMandates(ctx, A, id[`pat_${A}`]))[0];
      assert.equal(m.status, "pending");
      assert.match(m.consentWording, /Stripe/);
      const cs = await api.getCheckout(id[`acct_${A}`], m.setupRef as string);
      assert.match(cs.url ?? "", /^https:\/\/checkout\.stripe\.com\//, "the hosted card form opens");
      assert.equal(okv(await checkSavedCardFor(desk(A), m.id, deps)).status, "pending", "nothing saved until the card is set up");
      const seti = await setUpTestCard(id[`acct_${A}`], m.customerRef, { tenant_id: A, mandate_id: m.id });
      assert.equal((await hook("setup_intent.succeeded", seti, id[`acct_${A}`])).result, "card_active");
      assert.equal((await hook("setup_intent.succeeded", seti, id[`acct_${A}`])).result, "card_active", "a repeat changes nothing");
      id.mandate = m.id;
      return "Visa 4242 saved with consent";
    });

    await step("saved-card charge (off-session) and the missed-appointment fee", async () => {
      const inv = await invoice(A, id[`pat_${A}`], 3000);
      okv(await chargeSavedCardFor(desk(A), { invoiceId: inv, mandateId: id.mandate }, deps));
      const dna = await invoice(A, id[`pat_${A}`], 2500, "did_not_attend");
      okv(await chargeSavedCardFor(desk(A), { invoiceId: dna, mandateId: id.mandate }, deps));
      assert.equal((await getInvoice(ctx, A, dna))!.balancePence, 0);
    });

    await step("refunds: partial, then over-refund refused; webhook adds nothing", async () => {
      const pay = (await paymentsByRef(A, id.pi1))[0];
      okv(await refundCardPaymentFor(admin(A), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 1500, reason: "Test refund (fictional)" }, deps));
      const r2 = await refundCardPaymentFor(admin(A), { invoiceId: id.inv1, paymentId: pay.id, amountPence: 5000, reason: "Too much" }, deps);
      assert.equal(r2.ok, false);
      const refunds = await db.db.selectFrom("pms_card_intents").select(["intent_ref"]).where("tenant_id", "=", A).where("kind", "=", "refund").where("status", "=", "succeeded").execute();
      assert.equal(refunds.length, 1);
      assert.equal((await hook("refund.created", refunds[0].intent_ref as string, id[`acct_${A}`])).result, "already");
      return refunds[0].intent_ref as string;
    });

    await step("membership: charged once; a second run the same day charges nothing", async () => {
      const plan = okv(await createPlanFor(owner(A), { name: "E2E monthly (fictional)", pricePence: 3000 }, deps)).id;
      okv(await startMembershipFor(desk(A), { patientId: id[`pat_${A}`], planId: plan, mandateId: id.mandate, chargeDay: 5, consentConfirmed: true }, deps));
      const r1 = await runMembershipCharges(ctx, deps);
      assert.equal(r1.charged, 1, JSON.stringify(r1));
      const r2 = await runMembershipCharges(ctx, deps);
      assert.equal(r2.charged, 0);
    });

    await step("portal: the provider's hosted payment page opens on the clinic's account", async () => {
      const inv = await invoice(A, id[`pat_${A}`], 4200);
      const r = okv(await startPortalPayment(ctx, A, { patientId: id[`pat_${A}`], invoiceId: inv, ...URLS }, { userId: null, sessionId: null }, deps));
      assert.match(r.url, /^https:\/\/checkout\.stripe\.com\//);
    });

    await step("payouts and fees: balance lines matched to invoices", async () => {
      now = new Date();
      const v = okv(await payoutsFor(admin(A), { payout: null }, deps))!;
      const matched = v.lines.filter((l) => l.invoiceId);
      assert.ok(matched.length >= 1, "at least one card movement matched to an invoice");
      for (const l of v.lines) assert.equal(l.grossPence - l.providerFeePence - l.platformFeePence, l.netPence);
      return `${v.lines.length} lines, ${matched.length} matched, pending ${v.balance.pendingPence}p`;
    });

    await step("tenant isolation: clinic B's account cannot read clinic A's payment", async () => {
      const r = await hook("payment_intent.succeeded", id.pi1, id[`acct_${B}`]);
      assert.equal(r.status, 502, "not found on B's account – the event is retried, nothing recorded");
      assert.equal((await db.db.selectFrom("pms_payments").select("id").where("tenant_id", "=", B).execute()).length, 0);
    });
  } finally {
    for (const a of accounts) {
      try {
        await api.closeAccount(a);
        const after = await api.getAccount(a).catch(() => ({ closed: true }));
        console.log(`  closed test account ${a}: ${(after as { closed?: boolean }).closed === true ? "yes" : "CHECK"}`);
      } catch (err) {
        console.log(`  could not close ${a}: ${err instanceof Error ? err.message : String(err)} – close it in the Dashboard (test mode)`);
      }
    }
    await db.close();
  }
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
