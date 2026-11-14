/**
 * The clinic's "Plan and billing" page (Settings → Plan and billing, both brands) – server side. OWNERS and ADMINS only
 * (spending the clinic's money is not a grid permission); every id comes from the member's own clinic, nothing from
 * the request but the plan they chose. No vendor names on screen.
 *
 *   billingViewFor      the page: current plan, state, next payment, notices, the plans to choose from, seat warning
 *   startPlanCheckout   no running subscription → the hosted payment page in subscription mode (one subscription,
 *                       its items); the clinic's ONE customer (shared with text credits)
 *   changePlan          a running subscription → its items replaced (prorated on the next invoice)
 *   openBillingPortal   "Manage billing": card / Direct Debit details, invoices, cancelling
 *   completeCheckoutFor back from the payment page: re-read and synced at once (idempotent with the webhook)
 *   checkoutDoneView    what the success page says about that result (plan bought, "Open ClinDesk" or not)
 */
import "server-only";
import type { Kysely } from "kysely";
import {
  CLINDESK_BANDS,
  CLINFORMS_TIERS,
  REPORTS_ADDONS,
  STATE_LABELS,
  YEARLY_MONTHS,
  bandRange,
  choiceItems,
  choiceLabel,
  choiceProblem,
  clinDeskBand,
  clinFormsTier,
  planOfItems,
  pounds,
  seatWarning,
  ukDate,
  type BillingInterval,
  type ClinDeskBandKey,
  type ClinFormsTierKey,
  type PlanChoice,
  type ReportsAddonKey,
  type SubscriptionState,
} from "../../lib/billing/plans";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { readClinicSubscription, type ClinicSubscription } from "../repos/clinic-subscription";
import { pmsNow } from "../../modules/pms/core/clock";
import { cardPaymentsConfig, createCardPayments, CardPaymentsError, type CardPayments } from "../pms/comms/credits/card-payments";
import { clinicCustomerRef } from "../pms/comms/credits/customer";
import { holdOf } from "./access";
import { BILLING_PAGE_PATH } from "./notify";
import { createSubscriptionPayments, type SubscriptionPayments } from "./payments";
import { applySubscription, type SyncDeps, type SyncResult } from "./sync";

type Env = Readonly<Record<string, string | undefined>>;

export interface BillingActor {
  tenantId: string;
  clinicName: string;
  role: string;
  userId: string;
  sessionId: string;
}

export type BillingResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MANAGE_ONLY = "Only the clinic's owner and admins can choose a plan or change billing.";
export const PAYMENTS_OFF = "Online payment for plans is not set up yet. Contact us to choose a plan.";
const UNREACHABLE = "The payment page could not be opened. Try again in a moment.";

export const canManageBilling = (role: string) => role === "owner" || role === "admin";

export interface BillingClients {
  credits: Pick<CardPayments, "createCustomer" | "mode" | "live">;
  subs: SubscriptionPayments;
}

export function billingClientsFromEnv(env: Env = process.env): BillingClients | null {
  const c = cardPaymentsConfig(env);
  if (!c.ok) return null;
  return { credits: createCardPayments(c.config), subs: createSubscriptionPayments(c.config) };
}

/** Active practitioners of the clinic (the clinic system's directory; 0 when it has none or no tables). */
export async function activePractitioners(db: Kysely<Database>, tenantId: string): Promise<number> {
  try {
    const r = await db.selectFrom("pms_practitioners").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tenantId).where("active", "=", 1).executeTakeFirst();
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

/** The plan on record as a choice (null: none, or not one we sell). */
export function choiceOf(sub: ClinicSubscription | null): PlanChoice | null {
  if (!sub || !sub.product || !sub.planKey) return null;
  if (sub.product === "clinforms") return clinFormsTier(sub.planKey) ? { product: "clinforms", tier: sub.planKey as ClinFormsTierKey } : null;
  const band = clinDeskBand(sub.planKey);
  if (!band) return null;
  const reports = sub.reportsKey && REPORTS_ADDONS.some((a) => a.key === sub.reportsKey) ? (sub.reportsKey as ReportsAddonKey) : null;
  return { product: "clindesk", band: band.key, interval: sub.interval === "year" ? "year" : "month", reports };
}

/** Reads the plan the member chose from a form. */
export function parseChoice(form: { product?: unknown; band?: unknown; interval?: unknown; reports?: unknown; tier?: unknown }): PlanChoice | null {
  if (form.product === "clinforms") return { product: "clinforms", tier: String(form.tier ?? "") as ClinFormsTierKey };
  if (form.product === "clindesk") {
    const reports = form.reports === "" || form.reports === "none" || form.reports === undefined || form.reports === null ? null : (String(form.reports) as ReportsAddonKey);
    return { product: "clindesk", band: String(form.band ?? "") as ClinDeskBandKey, interval: form.interval === "year" ? "year" : "month", reports };
  }
  return null;
}

export interface BillingView {
  canManage: boolean;
  paymentsReady: boolean;
  paymentsUnavailable: string | null;
  product: "clindesk" | "clinforms";
  current: {
    state: SubscriptionState;
    stateLabel: string;
    planLabel: string | null;
    choice: PlanChoice | null;
    amount: string | null;
    interval: BillingInterval | null;
    /** DD/MM/YYYY */
    nextPayment: string | null;
    endsOn: string | null;
    graceUntil: string | null;
    readOnly: boolean;
    managedBySupport: boolean;
    testMode: boolean;
  };
  seat: { active: number; max: number; over: boolean; suggested: string | null } | null;
  /** Whether the choose-plan form changes the running subscription (true) or opens the payment page (false). */
  changesRunning: boolean;
  canChoose: boolean;
  chooseBlocked: string | null;
  clindesk: { key: ClinDeskBandKey; label: string; range: string; monthly: string; yearly: string; monthlyPence: number }[];
  addons: { key: ReportsAddonKey; reports: number; monthly: string; yearly: string; monthlyPence: number }[];
  clinforms: { key: ClinFormsTierKey; label: string; reports: number; monthly: string }[];
  extraReport: string;
  /** A running ClinForms plan: the Reports add-on with the same allowance (the default when it moves to ClinDesk). */
  matchingAddon: ReportsAddonKey | null;
}

/**
 * The product whose plans the page offers: a running plan's own product, except that a running ClinForms plan may be
 * moved to ClinDesk (01/11/2026, Khuram's R2: `switchToClinDesk` = the page was opened with ?product=clindesk) – the
 * running subscription is then changed in place (changePlan: the ClinForms item replaced by the band + Reports add-on).
 */
export function offeredProduct(running: PlanChoice | null, asked: "clindesk" | "clinforms", switchToClinDesk = false): "clindesk" | "clinforms" {
  if (!running) return asked;
  if (running.product === "clinforms" && switchToClinDesk) return "clindesk";
  return running.product;
}

/** The Reports add-on that matches a ClinForms tier's allowance (the default when a ClinForms plan moves to ClinDesk). */
export function addonForTier(tier: ClinFormsTierKey): ReportsAddonKey | null {
  const t = clinFormsTier(tier);
  return t ? (REPORTS_ADDONS.find((a) => a.reports === t.reports)?.key ?? null) : null;
}

export async function billingViewFor(db: Kysely<Database>, actor: BillingActor, input: { product: "clindesk" | "clinforms"; switchToClinDesk?: boolean }, env: Env = process.env, now: Date = new Date()): Promise<BillingView> {
  const sub = await readClinicSubscription({ db }, actor.tenantId);
  const config = cardPaymentsConfig(env);
  const choice = choiceOf(sub);
  const state: SubscriptionState = sub ? sub.state : "none";
  const practitioners = await activePractitioners(db, actor.tenantId);
  const running = Boolean(sub && (sub.state === "active" || sub.state === "past_due" || sub.state === "pending_payment"));
  const seat = running ? seatWarning(choice, practitioners) : null;
  const chooseBlocked =
    sub?.override
      ? "Your plan is managed for you by our support team. Contact us to change it."
      : sub?.state === "pending_payment"
        ? "Your first payment is still being processed (a Direct Debit takes a few working days). You can change your plan once it has cleared."
        : sub?.cancelAtPeriodEnd && running
          ? `Your plan ends on ${ukDate(sub.currentPeriodEnd)}. To keep it, use Manage billing.`
          : null;
  return {
    canManage: canManageBilling(actor.role),
    paymentsReady: config.ok,
    paymentsUnavailable: config.ok ? null : PAYMENTS_OFF,
    // A running plan decides which plans are offered (a change); otherwise the page's choice (?product=).
    product: offeredProduct(running ? choice : null, input.product, input.switchToClinDesk === true),
    current: {
      state,
      stateLabel: STATE_LABELS[state],
      planLabel: choice ? choiceLabel(choice) : null,
      choice,
      amount: sub?.amountPence !== null && sub?.amountPence !== undefined ? pounds(sub.amountPence) : null,
      interval: sub?.interval ?? null,
      nextPayment: running && !sub?.cancelAtPeriodEnd ? ukDate(sub?.currentPeriodEnd) || null : null,
      endsOn: sub?.cancelAtPeriodEnd ? ukDate(sub.currentPeriodEnd) || null : sub?.state === "canceled" ? ukDate(sub.endedAt ?? sub.canceledAt) || null : null,
      graceUntil: sub?.state === "past_due" ? ukDate(sub.graceUntil) || null : null,
      readOnly: holdOf(sub, now, env).held,
      managedBySupport: Boolean(sub?.override),
      testMode: sub?.mode === "test",
    },
    seat: seat ? { active: practitioners, max: seat.max, over: seat.over, suggested: seat.suggested ? `${seat.suggested.label} (${bandRange(seat.suggested)})` : null } : null,
    changesRunning: running && sub?.state !== "pending_payment",
    canChoose: canManageBilling(actor.role) && config.ok && !chooseBlocked,
    chooseBlocked,
    clindesk: CLINDESK_BANDS.map((b) => ({ key: b.key, label: b.label, range: bandRange(b), monthly: pounds(b.monthlyPence), yearly: pounds(b.monthlyPence * YEARLY_MONTHS), monthlyPence: b.monthlyPence })),
    addons: REPORTS_ADDONS.map((a) => ({ key: a.key, reports: a.reports, monthly: pounds(a.monthlyPence), yearly: pounds(a.monthlyPence * YEARLY_MONTHS), monthlyPence: a.monthlyPence })),
    clinforms: CLINFORMS_TIERS.map((t) => ({ key: t.key, label: t.label, reports: t.reports, monthly: pounds(t.monthlyPence) })),
    extraReport: pounds(150),
    matchingAddon: choice?.product === "clinforms" ? addonForTier(choice.tier) : null,
  };
}

const returnUrls = (origin: string) => ({ successUrl: `${origin}${BILLING_PAGE_PATH}/done?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${origin}${BILLING_PAGE_PATH}/cancelled` });

async function audit(db: Kysely<Database>, actor: BillingActor, action: string, detail: Record<string, unknown>) {
  await appendAudit({ db }, actor.tenantId, { userId: actor.userId, sessionId: actor.sessionId, action, targetType: "clinic_subscription", targetId: actor.tenantId, detail });
}

/** No running subscription: the payment page for the chosen plan. */
export async function startPlanCheckout(db: Kysely<Database>, actor: BillingActor, input: { choice: PlanChoice | null; origin: string; idempotencyKey: string }, clients: BillingClients | null): Promise<BillingResult<{ url: string }>> {
  if (!canManageBilling(actor.role)) return { ok: false, error: MANAGE_ONLY };
  if (!clients) return { ok: false, error: PAYMENTS_OFF };
  const choice = input.choice;
  const problem = choice ? choiceProblem(choice) : "Choose a plan.";
  if (problem || !choice) return { ok: false, error: problem ?? "Choose a plan." };
  const sub = await readClinicSubscription({ db }, actor.tenantId);
  if (sub?.override) return { ok: false, error: "Your plan is managed for you by our support team. Contact us to change it." };
  if (sub && (sub.state === "active" || sub.state === "past_due" || sub.state === "pending_payment") && sub.mode === clients.subs.mode) {
    return { ok: false, error: "Your clinic already has a plan. Change it below instead." };
  }
  try {
    const items = choiceItems(choice);
    const prices = await clients.subs.prices(items.map((i) => i.lookupKey));
    const priceIds = items.map((i) => prices.get(i.lookupKey));
    if (priceIds.some((p) => !p)) return { ok: false, error: "That plan is not on sale at the moment. Contact us." };
    const repo = { db, now: pmsNow };
    const customerRef = await clinicCustomerRef(repo, { tenantId: actor.tenantId, clinicName: actor.clinicName }, clients.credits, { userId: actor.userId, sessionId: actor.sessionId });
    const s = await clients.subs.createSubscriptionCheckout({ tenantId: actor.tenantId, customerRef, items: priceIds.map((priceId) => ({ priceId: priceId as string })), planLabel: choiceLabel(choice), idempotencyKey: input.idempotencyKey, ...returnUrls(input.origin) });
    if (!s.url || !/^https:\/\//.test(s.url)) return { ok: false, error: UNREACHABLE };
    await audit(db, actor, "clinic.subscription_checkout", { plan: items.map((i) => i.lookupKey), session: s.id });
    return { ok: true, value: { url: s.url } };
  } catch (err) {
    // 13/11/2026: say why in the log (the error's kind and code only – never a key, a card or a customer's details).
    console.warn(JSON.stringify({ event: "billing.checkout_failed", error: err instanceof Error ? err.name : "error", code: err instanceof CardPaymentsError ? err.code : null, message: err instanceof Error ? err.message.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, "[redacted]").slice(0, 160) : null }));
    return { ok: false, error: err instanceof CardPaymentsError && err.code === "price_mismatch" ? "That plan is not on sale at the moment. Contact us." : UNREACHABLE };
  }
}

/** A running subscription: its items replaced by the chosen plan's (prorated on the next invoice). */
export async function changePlan(db: Kysely<Database>, actor: BillingActor, input: { choice: PlanChoice | null; idempotencyKey: string }, clients: BillingClients | null, syncDeps: Omit<SyncDeps, "db">): Promise<BillingResult<{ message: string }>> {
  if (!canManageBilling(actor.role)) return { ok: false, error: MANAGE_ONLY };
  if (!clients) return { ok: false, error: PAYMENTS_OFF };
  const choice = input.choice;
  const problem = choice ? choiceProblem(choice) : "Choose a plan.";
  if (problem || !choice) return { ok: false, error: problem ?? "Choose a plan." };
  const sub = await readClinicSubscription({ db }, actor.tenantId);
  if (!sub || (sub.state !== "active" && sub.state !== "past_due")) return { ok: false, error: "Your clinic has no running plan to change." };
  if (sub.override) return { ok: false, error: "Your plan is managed for you by our support team. Contact us to change it." };
  if (sub.cancelAtPeriodEnd) return { ok: false, error: `Your plan ends on ${ukDate(sub.currentPeriodEnd)}. To keep it, use Manage billing.` };
  try {
    const live = await clients.subs.getSubscription(sub.subscriptionRef);
    const current = planOfItems(live.items.map((i) => i.lookupKey ?? ""));
    if (current.ok && JSON.stringify(current.choice) === JSON.stringify(choice)) return { ok: false, error: "That is your plan already." };
    const items = choiceItems(choice);
    const prices = await clients.subs.prices(items.map((i) => i.lookupKey));
    const target = items.map((i) => prices.get(i.lookupKey));
    if (target.some((p) => !p)) return { ok: false, error: "That plan is not on sale at the moment. Contact us." };
    // Items already on the subscription at today's price stay as they are (01/11/2026: adding the Reports add-on to a
    // running plan adds only the add-on – the plan itself is not removed and re-added, so only the add-on is prorated).
    const keep = new Set<string>();
    for (const priceId of target as string[]) {
      const found = live.items.find((i) => i.priceId === priceId && !keep.has(i.itemId));
      if (found) keep.add(found.itemId);
    }
    const keptPrices = live.items.filter((i) => keep.has(i.itemId)).map((i) => i.priceId);
    const add = (target as string[]).filter((p) => !keptPrices.includes(p));
    const remove = live.items.filter((i) => !keep.has(i.itemId)).map((i) => i.itemId);
    const updated = await clients.subs.changeSubscription({ subscriptionId: sub.subscriptionRef, removeItemIds: remove, addPriceIds: add, tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey });
    await audit(db, actor, "clinic.subscription_change", { to: items.map((i) => i.lookupKey) });
    await applySubscription({ ...syncDeps, db }, clients.subs, updated, { expectTenantId: actor.tenantId });
    return { ok: true, value: { message: `Your plan is now ${choiceLabel(choice)}. Any difference has been charged or credited today.` } };
  } catch (e) {
    if (e instanceof CardPaymentsError && e.code === "payment_failed") return { ok: false, error: "The payment for this change did not go through, so your plan has not changed. Update your card under Manage billing and try again." };
    return { ok: false, error: "The plan could not be changed. Try again in a moment." };
  }
}

/** "Manage billing": the hosted billing page (card / Direct Debit details, invoices, cancelling). */
export async function openBillingPortal(db: Kysely<Database>, actor: BillingActor, input: { origin: string }, clients: BillingClients | null): Promise<BillingResult<{ url: string }>> {
  if (!canManageBilling(actor.role)) return { ok: false, error: MANAGE_ONLY };
  if (!clients) return { ok: false, error: PAYMENTS_OFF };
  const sub = await readClinicSubscription({ db }, actor.tenantId);
  if (!sub || sub.mode !== clients.subs.mode) return { ok: false, error: "Choose a plan first." };
  try {
    const url = await clients.subs.portalSession({ customerRef: sub.customerRef, returnUrl: `${input.origin}${BILLING_PAGE_PATH}` });
    await audit(db, actor, "clinic.billing_portal", {});
    return { ok: true, value: { url } };
  } catch {
    return { ok: false, error: "The billing page could not be opened. Try again in a moment." };
  }
}

/** Back from the payment page: the checkout re-read and its subscription synced (idempotent with the webhook). */
export async function completeCheckoutFor(db: Kysely<Database>, actor: BillingActor, sessionId: string, clients: BillingClients | null, syncDeps: Omit<SyncDeps, "db">): Promise<SyncResult | { status: "unavailable" }> {
  if (!clients || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return { status: "unavailable" };
  try {
    const s = await clients.subs.getCheckout(sessionId);
    if (s.mode !== "subscription" || s.metadata.kind !== "subscription" || !s.subscription) return { status: "unavailable" };
    if (s.clientReferenceId !== actor.tenantId || s.metadata.tenant_id !== actor.tenantId) return { status: "refused", why: "other_clinic", tenantId: null };
    const sub = await clients.subs.getSubscription(s.subscription);
    return await applySubscription({ ...syncDeps, db }, clients.subs, sub, { expectTenantId: actor.tenantId });
  } catch {
    return { status: "unavailable" };
  }
}

export interface CheckoutDoneView {
  state: "active" | "pending_payment" | "unknown";
  tone: "success" | "info";
  title: string;
  detail: string;
  /** The plan bought ("ClinDesk Solo with Reports (25 a month)"), when known. */
  planLabel: string | null;
  /** "Open ClinDesk" – only once the plan is active AND the clinic system is switched on for the clinic. */
  openClinicSystem: boolean;
}

/**
 * The success page (/app/settings/billing/done) for a completeCheckoutFor result. Active: the plan bought, and "Open
 * ClinDesk" when the clinic package is on. A Direct Debit still clearing: said so, no "Open ClinDesk" yet (nothing is
 * switched on until it clears). Anything else: not confirmed yet.
 */
export function checkoutDoneView(result: SyncResult | { status: "unavailable" }, clinicSystemOn: boolean): CheckoutDoneView {
  const sub = result.status === "synced" ? result.subscription : null;
  const choice = choiceOf(sub);
  const planLabel = choice ? choiceLabel(choice) : null;
  if (sub?.state === "active") {
    return {
      state: "active",
      tone: "success",
      title: "Payment received – your plan is active.",
      detail: planLabel ? `You are now on ${planLabel}. Everything in your plan is switched on.` : "Everything in your plan is switched on.",
      planLabel,
      openClinicSystem: clinicSystemOn,
    };
  }
  if (sub?.state === "pending_payment") {
    return {
      state: "pending_payment",
      tone: "info",
      title: "Thank you – your Direct Debit is being set up.",
      detail: `${planLabel ? `${planLabel} starts` : "Your plan starts"} as soon as the first payment clears, usually within a few working days. We will email you if anything goes wrong.`,
      planLabel,
      openClinicSystem: false,
    };
  }
  return {
    state: "unknown",
    tone: "info",
    title: "We could not confirm this payment yet.",
    detail: "If you paid, your plan will appear on the Plan and billing page within a few minutes. Nothing was charged twice.",
    planLabel,
    openClinicSystem: false,
  };
}
