/**
 * TESTS: subscription billing on a real database (SQLite and PGlite – ../billing.test.ts) with the payment service
 * MOCKED in memory (FakeSubscriptions). Fictional clinics only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";
import { listAudit } from "../../repos/audit";
import { getClinicPackage } from "../../repos/clinic-package";
import { getClinicPlan, setClinicTrial } from "../../repos/clinic-plan";
import { getClinicSubscription, listBillingExtras } from "../../repos/clinic-subscription";
import { setCreditCustomer } from "../../repos/pms/comms/credits";
import { getEntitlement } from "../../repos/pms/entitlements";
import { setClinicEntitlement } from "../../pms/admin";
import { setBillingOverride } from "../../admin/billing";
import { loadClinicProfile } from "../../auth/medreport-actor";
import { signWebhookPayload, type CardPayments } from "../../pms/comms/credits/card-payments";
import { accountHold, holdOf } from "../access";
import { billExtraReports } from "../extras";
import { goLiveSubscriptions } from "../go-live";
import type { InvoiceInfo, SubscriptionCheckoutInfo, SubscriptionInfo, SubscriptionPayments } from "../payments";
import { applySubscription, syncSubscription, type BillingNoticeKind, type SyncDeps } from "../sync";
import { billingViewFor, changePlan, checkoutDoneView, completeCheckoutFor, startPlanCheckout } from "../views";
import { handleBillingWebhook } from "../webhook";
import { catalogueItem, choiceItems, planOfItems } from "../../../lib/billing/plans";
import { HOLD_MESSAGE, holdRefusal, pausedByHold } from "../access";
import { billExtrasFromCron } from "../extras";

const DAY = 86_400_000;
const HOOK = "whsec_test_for_billing_tests_0123456789";
const FAKE_TEST = ["sk", "test", "billingtestkey0001"].join("_");

/** The payment service, in memory (test mode). */
export class FakeSubscriptions implements SubscriptionPayments {
  readonly live = false;
  readonly mode = "test" as const;
  subs = new Map<string, SubscriptionInfo>();
  checkouts = new Map<string, SubscriptionCheckoutInfo>();
  invoices = new Map<string, InvoiceInfo>();
  items: { customerRef: string; quantity: number; period: string; invoiceId: string | null; key: string }[] = [];
  created: { tenantId: string; items: string[] }[] = [];
  n = 0;
  async prices(keys: readonly string[]) {
    return new Map(keys.map((k) => [k, `price_${k}`]));
  }
  async createSubscriptionCheckout(input: { tenantId: string; customerRef: string; items: { priceId: string }[] }) {
    const id = `cs_test_billing_${++this.n}`;
    this.created.push({ tenantId: input.tenantId, items: input.items.map((i) => i.priceId) });
    const s: SubscriptionCheckoutInfo = { id, mode: "subscription", status: "open", paymentStatus: "unpaid", livemode: false, customer: input.customerRef, clientReferenceId: input.tenantId, metadata: { tenant_id: input.tenantId, kind: "subscription" }, subscription: null, url: `https://pay.example.com/${id}` };
    this.checkouts.set(id, s);
    return s;
  }
  async getCheckout(id: string) {
    const s = this.checkouts.get(id);
    if (!s) throw new Error("no checkout");
    return s;
  }
  async getSubscription(id: string) {
    const s = this.subs.get(id);
    if (!s) throw new Error("no subscription");
    return s;
  }
  async listSubscriptions() {
    return Array.from(this.subs.values());
  }
  changes: { subscriptionId: string; removeItemIds: string[]; addPriceIds: string[] }[] = [];
  async changeSubscription(input: { subscriptionId: string; removeItemIds: string[]; addPriceIds: string[] }) {
    const s = await this.getSubscription(input.subscriptionId);
    this.changes.push({ subscriptionId: input.subscriptionId, removeItemIds: [...input.removeItemIds], addPriceIds: [...input.addPriceIds] });
    const kept = s.items.filter((i) => !input.removeItemIds.includes(i.itemId));
    const next = { ...s, items: [...kept, ...input.addPriceIds.map((p, i) => item(p.replace(/^price_/, ""), `si_new_${this.changes.length}_${i}`))] };
    this.subs.set(s.id, next);
    return next;
  }
  async portalSession() {
    return "https://billing.example.com/portal";
  }
  async getInvoice(id: string) {
    const i = this.invoices.get(id);
    if (!i) throw new Error("no invoice");
    return i;
  }
  invoiced: { subscriptionId: string; key: string }[] = [];
  async invoicePendingItems(input: { customerRef: string; subscriptionId: string; idempotencyKey: string }) {
    if (!this.invoiced.some((i) => i.key === input.idempotencyKey)) this.invoiced.push({ subscriptionId: input.subscriptionId, key: input.idempotencyKey });
    return `in_extra_${this.invoiced.length}`;
  }
  async addExtraReports(input: { customerRef: string; invoiceId: string | null; quantity: number; period: string; idempotencyKey: string }) {
    const prior = this.items.find((x) => x.key === input.idempotencyKey);
    if (!prior) this.items.push({ customerRef: input.customerRef, quantity: input.quantity, period: input.period, invoiceId: input.invoiceId, key: input.idempotencyKey });
    return { itemId: `ii_${input.idempotencyKey}`, invoiceId: input.invoiceId };
  }
}

function item(lookupKey: string, itemId = `si_${lookupKey}`) {
  const c = catalogueItem(lookupKey);
  return { itemId, priceId: `price_${lookupKey}`, lookupKey, reportsIncluded: c?.reportsIncluded ?? null, unitAmount: c?.pence ?? null, interval: c?.interval ?? "month" };
}

export function subscription(over: Partial<SubscriptionInfo> & { id: string; tenantId: string; customer: string; keys: string[] }): SubscriptionInfo {
  const { tenantId, keys, ...rest } = over;
  return {
    status: "active",
    livemode: false,
    metadata: { tenant_id: tenantId, kind: "clinic_plan" },
    items: keys.map((k) => item(k)),
    currentPeriodStart: "2026-11-01T10:00:00.000Z",
    currentPeriodEnd: "2026-12-01T10:00:00.000Z",
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    endedAt: null,
    latestInvoice: { id: `in_${over.id}`, status: "paid", amountDue: 1000, paid: true },
    defaultPaymentMethodType: "card",
    ...rest,
  };
}

export interface BillingSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

async function clinic(db: Kysely<Database>, slug: string, at: string): Promise<void> {
  const orgId = `org-${slug}`;
  await db.insertInto("organization").values({ id: orgId, name: `${slug} (fictional)`, slug, logo: null, createdAt: at, metadata: null }).execute();
  const userId = `u-owner-${slug}`;
  await db.insertInto("user").values({ id: userId, name: "Olive Owner (fictional)", email: `${userId}@clinic.example`, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
  await db.insertInto("member").values({ id: `m-${userId}`, organizationId: orgId, userId, role: "owner", createdAt: at }).execute();
}

export function defineBillingSuite(label: string, factory: () => Promise<BillingSuiteDb>): void {
  describe(`subscription billing – ${label}`, () => {
    let t: BillingSuiteDb;
    let clock = Date.parse("2026-11-01T10:00:00.000Z");
    const now = () => new Date(clock);
    const fake = new FakeSubscriptions();
    const notices: { tenantId: string; kind: BillingNoticeKind }[] = [];
    const alerts: { why: string; tenantId: string | null }[] = [];
    const deps = (): SyncDeps => ({
      db: t.db,
      now,
      env: {},
      notify: async (tenantId, n) => void notices.push({ tenantId, kind: n.kind }),
      alert: async (a) => void alerts.push({ why: a.why, tenantId: a.tenantId }),
    });
    const A = "billing-clinic-a";
    const B = "billing-clinic-b";
    const C = "billing-clinic-c";
    const OWNER = (tenantId: string) => ({ tenantId, clinicName: `${tenantId} (fictional)`, role: "owner", userId: `u-owner-${tenantId}`, sessionId: "s1" });

    before(async () => {
      t = await factory();
      const at = new Date(clock).toISOString();
      for (const s of [A, B, C]) {
        await clinic(t.db, s, at);
        await setCreditCustomer({ db: t.db, now }, s, `cus_test_${s.replace(/-/g, "_")}`, { userId: null, sessionId: null }, "test");
      }
      await setClinicTrial({ db: t.db, now }, A, { days: 3, startOnFirstSignIn: false });
    });
    after(async () => {
      await t?.close();
    });

    it("plans: the Reports add-on follows the plan's interval (yearly = 10 × monthly); items read back into the plan", () => {
      assert.deepEqual(
        choiceItems({ product: "clindesk", band: "practice", interval: "year", reports: "100" }).map((i) => [i.lookupKey, i.pence, i.interval, i.reportsIncluded]),
        [
          ["clindesk_practice_yearly", 85000, "year", null],
          ["clindesk_reports_100_yearly", 159000, "year", 100],
        ],
      );
      const yearly = planOfItems(["clindesk_group_yearly", "clindesk_reports_500_yearly"]);
      assert.deepEqual(yearly.ok && yearly.choice, { product: "clindesk", band: "group", interval: "year", reports: "500" });
      assert.deepEqual(planOfItems(["clindesk_group_yearly", "clindesk_reports_500_monthly"]), { ok: false, why: "mixed_intervals" });
      assert.deepEqual(
        choiceItems({ product: "clindesk", band: "practice", interval: "month", reports: "100" }).map((i) => [i.lookupKey, i.pence]),
        [
          ["clindesk_practice_monthly", 8500],
          ["clindesk_reports_100_monthly", 15900],
        ],
      );
      assert.equal(choiceItems({ product: "clindesk", band: "group", interval: "year", reports: null })[0].pence, 149000);
      assert.equal(choiceItems({ product: "clinforms", tier: "group_plus" })[0].reportsIncluded, 500);
    });

    it("card: a paid subscription switches the clinic system and Reports on, sets the allowance, converts the trial", async () => {
      const sub = subscription({ id: "sub_test_a1", tenantId: A, customer: "cus_test_billing_clinic_a", keys: ["clindesk_practice_monthly", "clindesk_reports_100_monthly"] });
      fake.subs.set(sub.id, sub);
      const r = await syncSubscription(deps(), fake, sub.id, { eventId: "evt_test_a1" });
      assert.equal(r.status, "synced");
      assert.equal(r.status === "synced" && r.subscription.state, "active");
      const clinicPkg = await getEntitlement({ db: t.db }, A, "clinic");
      assert.deepEqual([clinicPkg?.status, clinicPkg?.planCode, clinicPkg?.limits?.practitioners_max], ["active", "clindesk-practice", 10]);
      assert.equal((await getEntitlement({ db: t.db }, A, "reports"))?.status, "active");
      const pkg = await getClinicPackage({ db: t.db }, A);
      assert.deepEqual([pkg?.package, pkg?.reportsIncluded, pkg?.monthlyPricePence, pkg?.extraReportPence], ["practice", 100, 15900, 150]);
      assert.equal((await getClinicPlan({ db: t.db }, A))?.status, "paid", "the trial is converted");
      const actions = (await listAudit({ db: t.db }, A, { limit: 50 })).map((e) => e.action);
      for (const a of ["clinic.subscription_active", "clinic.package_change", "clinic.package_set", "clinic.trial_converted"]) assert.ok(actions.includes(a), a);
      // Replayed: nothing more is written.
      const auditBefore = (await listAudit({ db: t.db }, A, { limit: 200 })).length;
      const again = await syncSubscription(deps(), fake, sub.id, { eventId: "evt_test_a1" });
      assert.equal(again.status === "synced" && again.changed, false);
      assert.equal((await listAudit({ db: t.db }, A, { limit: 200 })).length, auditBefore);
    });

    it("Direct Debit: not activated until the payment has cleared", async () => {
      const sub = subscription({ id: "sub_test_b1", tenantId: B, customer: "cus_test_billing_clinic_b", keys: ["clinforms_starter_monthly"], latestInvoice: { id: "in_b1", status: "open", amountDue: 9900, paid: false }, defaultPaymentMethodType: "bacs_debit" });
      fake.subs.set(sub.id, sub);
      const r = await syncSubscription(deps(), fake, sub.id);
      assert.equal(r.status === "synced" && r.subscription.state, "pending_payment");
      assert.equal(await getEntitlement({ db: t.db }, B, "reports"), null, "nothing switched on");
      assert.equal(await getClinicPackage({ db: t.db }, B), null);
      fake.subs.set(sub.id, { ...sub, latestInvoice: { id: "in_b1", status: "paid", amountDue: 9900, paid: true } });
      const paid = await syncSubscription(deps(), fake, sub.id, { eventId: "evt_test_b_paid" });
      assert.equal(paid.status === "synced" && paid.subscription.state, "active");
      assert.equal((await getEntitlement({ db: t.db }, B, "reports"))?.status, "active");
      assert.equal(await getEntitlement({ db: t.db }, B, "clinic"), null, "ClinForms on its own leaves the clinic system alone");
      assert.equal((await getClinicPackage({ db: t.db }, B))?.reportsIncluded, 25);
    });

    it("past due: grace for 7 days (owner told once), then read-only; paying lifts it", async () => {
      notices.length = 0;
      const sub = { ...(await fake.getSubscription("sub_test_a1")), status: "past_due" };
      fake.subs.set(sub.id, sub);
      await syncSubscription(deps(), fake, sub.id);
      await syncSubscription(deps(), fake, sub.id);
      assert.deepEqual(notices.map((n) => n.kind), ["payment_failed"]);
      const s = await getClinicSubscription({ db: t.db }, A);
      assert.equal(s?.state, "past_due");
      assert.equal(holdOf(s, now(), {}).held, false, "within the grace period");
      assert.equal((await getEntitlement({ db: t.db }, A, "clinic"))?.status, "active", "everything keeps working");
      clock += 8 * DAY;
      assert.equal((await accountHold(t.db, A, now())).held, true);
      const profile = await loadClinicProfile(t.db, A, now());
      assert.equal(profile?.paymentOverdue, true, "ClinForms report drafting is paused (PAYMENT_OVERDUE)");
      // Never clinical work (Khuram 01/11/2026): only admin set-up, member access, imports and templates are paused.
      for (const p of ["clinical.write", "clinical.amend", "patients.edit", "diary.book", "diary.rota", "messages.send", "messages.letters", "billing.pay", "billing.edit"]) assert.equal(pausedByHold(p), false, p);
      for (const p of ["settings.setup", "settings.import", "settings.members", "messages.templates"]) assert.equal(pausedByHold(p), true, p);
      assert.equal(await holdRefusal(t.db, A, now()), HOLD_MESSAGE);
      assert.match(HOLD_MESSAGE, /Clinical work[\s\S]*carries on as normal/);
      await syncSubscription(deps(), fake, sub.id);
      assert.deepEqual(notices.map((n) => n.kind), ["payment_failed", "read_only"]);
      fake.subs.set(sub.id, { ...sub, status: "active" });
      await syncSubscription(deps(), fake, sub.id);
      assert.equal((await accountHold(t.db, A, now())).held, false);
      assert.equal(notices.at(-1)?.kind, "payment_received");
    });

    it("cancel at the period end: the packages end then; deleted: cancelled (data kept)", async () => {
      const sub = await fake.getSubscription("sub_test_a1");
      fake.subs.set(sub.id, { ...sub, cancelAtPeriodEnd: true });
      await syncSubscription(deps(), fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, A, "clinic"))?.endsAt, "2026-12-01T10:00:00.000Z");
      assert.equal(notices.at(-1)?.kind, "cancelled");
      fake.subs.set(sub.id, { ...sub, status: "canceled", cancelAtPeriodEnd: false, endedAt: "2026-12-01T10:00:00.000Z" });
      await syncSubscription(deps(), fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, A, "clinic"))?.status, "cancelled");
      assert.equal((await getEntitlement({ db: t.db }, A, "reports"))?.status, "cancelled");
      assert.equal((await getClinicSubscription({ db: t.db }, A))?.state, "canceled");
    });

    it("refused: another clinic's customer, prices we do not sell, test mode while live, no clinic – each raises an alert", async () => {
      alerts.length = 0;
      const bad = [
        subscription({ id: "sub_test_x1", tenantId: C, customer: "cus_someone_else", keys: ["clinforms_starter_monthly"] }),
        subscription({ id: "sub_test_x2", tenantId: C, customer: "cus_test_billing_clinic_c", keys: ["some_other_price"] }),
        subscription({ id: "sub_test_x3", tenantId: "", customer: "cus_test_billing_clinic_c", keys: ["clinforms_starter_monthly"] }),
      ];
      for (const s of bad) assert.equal((await applySubscription(deps(), fake, s)).status, "refused");
      const live = await applySubscription({ ...deps(), env: { CLINDESK_BILLING_LIVE: "1" } }, fake, subscription({ id: "sub_test_x4", tenantId: C, customer: "cus_test_billing_clinic_c", keys: ["clinforms_starter_monthly"] }));
      assert.equal(live.status === "refused" && live.why, "test_mode_while_live");
      assert.deepEqual(alerts.map((a) => a.why), ["customer_mismatch", "unknown_price", "no_clinic", "test_mode_while_live"]);
      assert.equal(await getClinicSubscription({ db: t.db }, C), null);
    });

    it("platform overrides win: a manual package change switches the override on; off re-applies the subscription", async () => {
      const sub = subscription({ id: "sub_test_c1", tenantId: C, customer: "cus_test_billing_clinic_c", keys: ["clindesk_solo_monthly"] });
      fake.subs.set(sub.id, sub);
      await syncSubscription(deps(), fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, C, "clinic"))?.status, "active");
      const plan = await setClinicEntitlement(t.db, { slug: C, package: "clinic", on: false, status: "paused", confirm: true });
      assert.equal(plan.billingOverride, true);
      fake.subs.set(sub.id, { ...sub, items: [item("clindesk_small_monthly")] });
      await syncSubscription(deps(), fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, C, "clinic"))?.status, "paused", "the manual change stays");
      assert.equal((await getClinicSubscription({ db: t.db }, C))?.planKey, "small", "the subscription is still recorded");
      await setBillingOverride(t.db, { kind: "script" }, C, false, null);
      await syncSubscription(deps(), fake, sub.id, { forceApply: true });
      const e = await getEntitlement({ db: t.db }, C, "clinic");
      assert.deepEqual([e?.status, e?.planCode], ["active", "clindesk-small"]);
    });

    it("extra reports: completed months billed once on the renewal invoice; months without extras skipped", async () => {
      const sub = (await getClinicSubscription({ db: t.db }, B))!;
      const at = new Date(clock).toISOString();
      const month = (period: string, billable: number) =>
        t.db
          .insertInto("clinic_usage")
          .values({ tenant_id: B, period, package: "starter", plan_price_pence: 9900, plan_reports_included: 25, plan_extra_report_pence: 150, billable_reports: billable, created_at: at, updated_at: at })
          .onConflict((oc) => oc.columns(["tenant_id", "period"]).doUpdateSet({ billable_reports: billable }))
          .execute();
      await month("2026-11", 31);
      clock = Date.parse("2027-01-02T10:00:00.000Z");
      await month("2026-12", 20);
      const invoice = { id: "in_test_renewal_1", status: "draft", billingReason: "subscription_cycle" };
      const r = await billExtraReports({ db: t.db, now }, fake, sub, invoice);
      assert.deepEqual(r.billed.map((b) => [b.period, b.extra]), [["2026-11", 6]]);
      assert.deepEqual(r.skipped, ["2026-12"]);
      assert.deepEqual(fake.items.map((i) => [i.period, i.quantity, i.invoiceId]), [["2026-11", 6, "in_test_renewal_1"]]);
      const again = await billExtraReports({ db: t.db, now }, fake, sub, invoice);
      assert.equal(again.billed.length, 0, "once per month");
      assert.equal(fake.items.length, 1);
      assert.deepEqual((await listBillingExtras({ db: t.db }, B)).map((e) => [e.period, e.status]), [["2026-12", "skipped"], ["2026-11", "billed"]]);
      assert.equal((await billExtraReports({ db: t.db, now }, fake, sub, { ...invoice, billingReason: "subscription_update" })).billed.length, 0, "only renewals");
    });

    it("yearly plans: the daily run invoices extra reports at once (monthly plans wait for the renewal); once per month", async () => {
      const E = "billing-clinic-e";
      await clinic(t.db, E, new Date(clock).toISOString());
      await setCreditCustomer({ db: t.db, now }, E, "cus_test_billing_clinic_e", { userId: null, sessionId: null }, "test");
      const activated = Date.parse("2027-01-03T10:00:00.000Z");
      clock = activated;
      const sub = subscription({ id: "sub_test_e1", tenantId: E, customer: "cus_test_billing_clinic_e", keys: ["clindesk_solo_yearly", "clindesk_reports_25_yearly"], currentPeriodEnd: "2028-01-03T10:00:00.000Z" });
      fake.subs.set(sub.id, sub);
      await syncSubscription(deps(), fake, sub.id);
      const at = new Date(clock).toISOString();
      await t.db.insertInto("clinic_usage").values({ tenant_id: E, period: "2027-01", package: "starter", plan_price_pence: 79000, plan_reports_included: 25, plan_extra_report_pence: 150, billable_reports: 29, created_at: at, updated_at: at }).execute();
      clock = Date.parse("2027-02-01T04:00:00.000Z");
      const items = fake.items.length;
      const r = await billExtrasFromCron({ db: t.db, now }, fake);
      assert.ok(r.billed >= 1 && r.invoices >= 1);
      assert.deepEqual(fake.items.slice(items).filter((i) => i.customerRef === "cus_test_billing_clinic_e").map((i) => [i.period, i.quantity, i.invoiceId]), [["2027-01", 4, null]]);
      assert.ok(fake.invoiced.some((i) => i.subscriptionId === "sub_test_e1"));
      const again = await billExtrasFromCron({ db: t.db, now }, fake);
      assert.equal(fake.items.filter((i) => i.customerRef === "cus_test_billing_clinic_e").length, 1, "once per month");
      assert.equal(again.errors, 0);
    });

    it("the page: owners choose a plan; the payment page opens once; a running plan is changed, not bought again", async () => {
      const db = t.db;
      const clients = { credits: { createCustomer: async () => "cus_never", mode: "test" as const, live: false } as Pick<CardPayments, "createCustomer" | "mode" | "live">, subs: fake };
      const D = "billing-clinic-d";
      await clinic(db, D, new Date(clock).toISOString());
      await setCreditCustomer({ db, now }, D, "cus_test_billing_clinic_d", { userId: null, sessionId: null }, "test");
      const staff = { ...OWNER(D), role: "staff" };
      assert.equal((await startPlanCheckout(db, staff, { choice: { product: "clinforms", tier: "starter" }, origin: "https://app.example.com", idempotencyKey: "k1" }, clients)).ok, false);
      const badChoice = await startPlanCheckout(db, OWNER(D), { choice: { product: "clindesk", band: "huge" as never, interval: "month", reports: null }, origin: "https://app.example.com", idempotencyKey: "k2" }, clients);
      assert.match(!badChoice.ok ? badChoice.error : "", /Choose a plan/);
      const ok = await startPlanCheckout(db, OWNER(D), { choice: { product: "clindesk", band: "solo", interval: "month", reports: "25" }, origin: "https://app.example.com", idempotencyKey: "k3" }, clients);
      assert.equal(ok.ok, true);
      assert.deepEqual(fake.created.at(-1), { tenantId: D, items: ["price_clindesk_solo_monthly", "price_clindesk_reports_25_monthly"] });
      // Back from the payment page: re-read and applied at once.
      const cs = Array.from(fake.checkouts.values()).at(-1)!;
      const sub = subscription({ id: "sub_test_d1", tenantId: D, customer: "cus_test_billing_clinic_d", keys: ["clindesk_solo_monthly", "clindesk_reports_25_monthly"] });
      fake.subs.set(sub.id, sub);
      fake.checkouts.set(cs.id, { ...cs, status: "complete", paymentStatus: "paid", subscription: sub.id });
      const done = await completeCheckoutFor(db, OWNER(D), cs.id, clients, { env: {} });
      assert.equal(done.status === "synced" && done.subscription.state, "active");
      assert.equal((await completeCheckoutFor(db, OWNER(A), cs.id, clients, { env: {} })).status, "refused", "another clinic's checkout");
      const view = await billingViewFor(db, OWNER(D), { product: "clinforms" }, { STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST }, now());
      assert.deepEqual([view.product, view.current.state, view.changesRunning, view.current.nextPayment], ["clindesk", "active", true, "01/12/2026"]);
      assert.match((await startPlanCheckout(db, OWNER(D), { choice: { product: "clinforms", tier: "starter" }, origin: "https://app.example.com", idempotencyKey: "k4" }, clients)).ok ? "" : "already", /already/);
      const changed = await changePlan(db, OWNER(D), { choice: { product: "clindesk", band: "small", interval: "month", reports: null }, idempotencyKey: "k5" }, clients, { env: {} });
      assert.equal(changed.ok, true);
      assert.equal((await getEntitlement({ db }, D, "reports"))?.status, "paused", "a plan without the add-on pauses Reports");
      // Seat check: 7 active practitioners on Small (2–5) – a warning, never a block.
      for (let i = 0; i < 7; i++) {
        await db.insertInto("pms_practitioners").values({ tenant_id: D, id: `prac_${i}`, display_name: `Sam Physio ${i} (fictional)`, profession: "physiotherapist", created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString() }).execute();
      }
      const seat = (await billingViewFor(db, OWNER(D), { product: "clindesk" }, { STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST }, now())).seat;
      assert.deepEqual([seat?.active, seat?.max, seat?.over], [7, 5, true]);
      assert.match(seat?.suggested ?? "", /Practice/);
    });

    it("add the Reports add-on to a running plan: only the add-on is added (monthly and yearly), Reports switched on in place", async () => {
      const db = t.db;
      const clients = { credits: { createCustomer: async () => "cus_never", mode: "test" as const, live: false } as Pick<CardPayments, "createCustomer" | "mode" | "live">, subs: fake };
      const env = { STRIPE_CLINDESK_SECRET_KEY: FAKE_TEST };
      for (const [slug, interval, suffix] of [["billing-clinic-f", "month", "monthly"], ["billing-clinic-g", "year", "yearly"]] as const) {
        await clinic(db, slug, new Date(clock).toISOString());
        const customer = `cus_test_${slug.replace(/-/g, "_")}`;
        await setCreditCustomer({ db, now }, slug, customer, { userId: null, sessionId: null }, "test");
        const sub = subscription({ id: `sub_test_${slug.replace(/-/g, "_")}`, tenantId: slug, customer, keys: [`clindesk_solo_${suffix}`], currentPeriodEnd: interval === "year" ? "2027-11-01T10:00:00.000Z" : "2026-12-01T10:00:00.000Z" });
        fake.subs.set(sub.id, sub);
        const synced = await applySubscription({ ...deps(), db }, fake, sub, { expectTenantId: slug });
        assert.equal(synced.status === "synced" && synced.subscription.state, "active");
        assert.equal((await getEntitlement({ db }, slug, "reports"))?.status, "paused", "ClinDesk without the add-on: Reports paused");
        // The page offers the add-on as its own action: a running ClinDesk plan without Reports.
        const before = await billingViewFor(db, OWNER(slug), { product: "clindesk" }, env, now());
        assert.deepEqual([before.changesRunning, before.canChoose, before.current.choice], [true, true, { product: "clindesk", band: "solo", interval, reports: null }]);
        // Reception may not.
        assert.equal((await changePlan(db, { ...OWNER(slug), role: "staff" }, { choice: { product: "clindesk", band: "solo", interval, reports: "25" }, idempotencyKey: `${slug}-x` }, clients, { env: {} })).ok, false);
        const r = await changePlan(db, OWNER(slug), { choice: { product: "clindesk", band: "solo", interval, reports: "25" }, idempotencyKey: `${slug}-add` }, clients, { env: {} });
        assert.equal(r.ok, true, !r.ok ? r.error : "");
        assert.match(r.ok ? r.value.message : "", /with Reports \(25 a month\)/);
        assert.deepEqual(fake.changes.at(-1), { subscriptionId: sub.id, removeItemIds: [], addPriceIds: [`price_clindesk_reports_25_${suffix}`] }, "the plan item is kept, only the add-on added");
        const reports = await getEntitlement({ db }, slug, "reports");
        assert.equal(reports?.status, "active");
        assert.equal((await getEntitlement({ db }, slug, "clinic"))?.status, "active");
        const after = await billingViewFor(db, OWNER(slug), { product: "clindesk" }, env, now());
        assert.deepEqual(after.current.choice, { product: "clindesk", band: "solo", interval, reports: "25" });
        // A bigger allowance swaps only the add-on item; the same plan again is refused.
        const up = await changePlan(db, OWNER(slug), { choice: { product: "clindesk", band: "solo", interval, reports: "100" }, idempotencyKey: `${slug}-up` }, clients, { env: {} });
        assert.equal(up.ok, true);
        const last = fake.changes.at(-1)!;
        assert.deepEqual([last.removeItemIds.length, last.addPriceIds], [1, [`price_clindesk_reports_100_${suffix}`]]);
        assert.deepEqual(fake.subs.get(sub.id)!.items.map((i) => i.lookupKey).sort(), [`clindesk_reports_100_${suffix}`, `clindesk_solo_${suffix}`]);
        assert.match((await changePlan(db, OWNER(slug), { choice: { product: "clindesk", band: "solo", interval, reports: "100" }, idempotencyKey: `${slug}-same` }, clients, { env: {} })).ok ? "" : "already", /already/);
      }
      // Monthly → yearly replaces both items (the payment service cannot mix intervals).
      const F = "billing-clinic-f";
      const yearly = await changePlan(db, OWNER(F), { choice: { product: "clindesk", band: "solo", interval: "year", reports: "100" }, idempotencyKey: "f-yearly" }, clients, { env: {} });
      assert.equal(yearly.ok, true);
      assert.deepEqual([fake.changes.at(-1)!.removeItemIds.length, fake.changes.at(-1)!.addPriceIds], [2, ["price_clindesk_solo_yearly", "price_clindesk_reports_100_yearly"]]);
    });

    it("the success page: the plan bought and Open ClinDesk when active with the clinic system on; Direct Debit clearing: no way in yet", async () => {
      const synced = (state: "active" | "pending_payment") => ({ status: "synced" as const, changed: true, subscription: { product: "clindesk", planKey: "solo", reportsKey: "25", interval: "month", state } as never });
      const on = checkoutDoneView(synced("active"), true);
      assert.deepEqual([on.state, on.tone, on.openClinicSystem], ["active", "success", true]);
      assert.match(on.planLabel ?? "", /Solo with Reports \(25 a month\)/);
      assert.match(on.detail, /You are now on .*Solo/);
      assert.equal(checkoutDoneView(synced("active"), false).openClinicSystem, false, "a plan without the clinic system (ClinForms only)");
      const bacs = checkoutDoneView(synced("pending_payment"), true);
      assert.deepEqual([bacs.state, bacs.openClinicSystem], ["pending_payment", false]);
      assert.match(bacs.title, /Direct Debit is being set up/);
      assert.match(bacs.detail, /as soon as the first payment clears/);
      for (const r of [{ status: "unavailable" as const }, { status: "refused" as const, why: "other_clinic", tenantId: null }]) {
        const v = checkoutDoneView(r, true);
        assert.deepEqual([v.state, v.openClinicSystem], ["unknown", false]);
      }
    });

    it("the one webhook: signed subscription events sync; invoice.created bills extras; text credit events still route", async () => {
      const send = async (event: Record<string, unknown>) => {
        const payload = JSON.stringify(event);
        return handleBillingWebhook(new Request("http://localhost/api/billing/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": signWebhookPayload(payload, HOOK, Math.floor(Date.now() / 1000)) } }), {
          config: () => ({ ok: true, config: { secretKey: FAKE_TEST, webhookSecret: HOOK, apiBase: "http://127.0.0.1:1/v1", live: false } }),
          credits: () => ({ live: false, mode: "test", getPaymentIntent: async () => ({ id: "pi_x", status: "succeeded", amount: 1, amountReceived: 1, currency: "gbp", customer: null, paymentMethod: null, livemode: false, metadata: {} }) }) as unknown as CardPayments,
          subscriptions: () => fake,
          ctx: () => ({ db: t.db, now }),
          db: () => t.db,
          log: () => undefined,
        });
      };
      const bad = await handleBillingWebhook(new Request("http://localhost/x", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=00" } }), {
        config: () => ({ ok: true, config: { secretKey: FAKE_TEST, webhookSecret: HOOK, apiBase: "http://127.0.0.1:1/v1", live: false } }),
        credits: () => ({}) as CardPayments,
        subscriptions: () => fake,
        ctx: () => ({ db: t.db }),
        db: () => t.db,
        log: () => undefined,
      });
      assert.equal(bad.status, 400);
      const r1 = await send({ id: "evt_test_w1", type: "customer.subscription.updated", livemode: false, data: { object: { id: "sub_test_b1" } } });
      assert.equal(((await r1.json()) as { result: string }).result, "synced_active");
      fake.invoices.set("in_test_w2", { id: "in_test_w2", status: "draft", livemode: false, customer: "cus_test_billing_clinic_b", subscription: "sub_test_b1", billingReason: "subscription_cycle", paid: false });
      const r2 = await send({ id: "evt_test_w2", type: "invoice.created", livemode: false, data: { object: { id: "in_test_w2" } } });
      assert.equal(r2.status, 200);
      const r3 = await send({ id: "evt_test_w3", type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_x" } } });
      assert.equal(((await r3.json()) as { result: string }).result, "ignored", "a subscription's payment is not a text credit");
      const r4 = await send({ id: "evt_test_w4", type: "customer.subscription.updated", livemode: true, data: { object: { id: "sub_test_b1" } } });
      assert.equal(((await r4.json()) as { result: string }).result, "ignored", "the other mode");
    });

    it("go-live: test-mode subscriptions end and the packages they switched on are cancelled (overrides left alone)", async () => {
      const preview = await goLiveSubscriptions(t.db);
      assert.ok(preview.clinics.some((c) => c.tenantId === B && c.managed));
      assert.equal((await getEntitlement({ db: t.db }, B, "reports"))?.status, "active", "preview changes nothing");
      await setBillingOverride(t.db, { kind: "script" }, C, true, "design partner (fictional)");
      await goLiveSubscriptions(t.db, { confirm: true });
      assert.equal((await getEntitlement({ db: t.db }, B, "reports"))?.status, "cancelled");
      assert.equal((await getClinicSubscription({ db: t.db }, B))?.state, "canceled");
      assert.equal((await getEntitlement({ db: t.db }, C, "clinic"))?.status, "active", "an overridden clinic keeps its packages");
      assert.equal((await goLiveSubscriptions(t.db)).clinics.length, 0, "nothing left");
    });
  });
}
