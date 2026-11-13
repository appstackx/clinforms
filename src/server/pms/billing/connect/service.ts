/**
 * Card payments through the clinic's own connected account – the services the screens, the portal, the webhook and
 * the daily run call (docs/clinic-system/card-payments.md). Rules:
 *
 *   1. the platform switch (CLINFORMS_CARD_PAYMENTS=on) and the provider's configuration first – off = refused;
 *   2. the member's permission (owner for the account and readers; settings.setup for plans; billing.pay to take
 *      payments and save cards; billing.refund to refund), then every id read back from the member's own clinic and
 *      site scope (./access.ts rules – another clinic's id is "not found");
 *   3. an intent row is written BEFORE the provider is asked, and its id is the provider's idempotency key, so a
 *      retried click never charges twice;
 *   4. money is recorded ONLY by recordIntentPayment / recordIntentRefund into pms_payments with the provider's
 *      reference (unique per clinic) – the screens, the return pages, the webhook and the daily run can all call it
 *      for the same payment and it is recorded exactly once;
 *   5. no card number ever reaches this code (the provider's hosted pages and readers take cards).
 */
import "server-only";
import {
  CARD_COPY,
  CONNECT_PROVIDER,
  MEMBERSHIP_MAX_ATTEMPTS,
  MIN_CARD_PENCE,
  SIMULATED_READER_CODE,
  accountStateOf,
  cardConsentWording,
  cardPaymentsReady,
  cardPaymentsSwitchOn,
  clampDay,
  membershipConsentWording,
  nextChargeOn,
  noShowChargeRefusal,
  periodOf,
  platformFeePence,
  type CardSetupView,
  type ConsentChannel,
  type InvoiceCardView,
  type PatientCardsView,
  type PayoutsView,
} from "../../../../modules/pms/billing/card-payments";
import { formatDocumentNumber } from "../../../../modules/pms/billing/numbers";
import type { Invoice } from "../../../../modules/pms/billing/types";
import { formatPence, ukToday } from "../../../../modules/pms/core/text";
import { pmsNow } from "../../../../modules/pms/core/clock";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { isPlausibleRecordId } from "../../../../modules/pms/records/form-values";
import { CardPaymentsError } from "../../comms/credits/card-payments";
import { RepoInputError, type RepoContext } from "../../../repos/context";
import { listSites } from "../../../repos/pms/directory";
import {
  activateMandate,
  addReader,
  cancelMembership,
  cancelMembershipsOfMandate,
  countMembersByPlan,
  createIntent,
  createMandate,
  createMembership,
  createPlan,
  createRefundIntent,
  customerRefFor,
  findIntentByRef,
  findMandateBySetupRef,
  getCardSettings,
  getIntent,
  getMandate,
  getMembership,
  getReader,
  intentSucceededQuery,
  listIntentsForInvoice,
  listMandates,
  listMemberships,
  listPlans,
  listReaders,
  listRefundIntents,
  mandateLabel,
  markIntentSucceeded,
  membershipCharged,
  moveIntent,
  removeMandate,
  removeReader,
  saveConnectedAccount,
  setCardEnabled,
  setIntentRefs,
  setMandateSetupRef,
  setNoShowPolicy,
  setPlanActive,
  syncAccountState,
  type CardIntent,
  type CardSettings,
  type Membership,
} from "../../../repos/pms/billing/card-payments";
import { createCreditNote, spreadOverLines } from "../../../repos/pms/billing/credit-notes";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../../repos/pms/billing/invoices";
import { getPayment, recordPayment, reversePayment } from "../../../repos/pms/billing/payments";
import { getBillingSettings } from "../../../repos/pms/billing/settings";
import { attempt, fail, forbidden, invoiceInScope, notFound, ok, patientInClinic, type BillingActor, type Result } from "../access";
import { connectConfig, type ConnectApi, type ConnectConfig, type IntentInfo } from "./client";

export const SYSTEM_ACTOR: PmsActor = { userId: null, sessionId: null };

/* ------------------------------------------------------------------------------------------------
 * Dependencies (env by default; tests pass a fake provider)
 * ----------------------------------------------------------------------------------------------*/

export interface CardDeps {
  switchOn: boolean;
  config: { ok: true; config: ConnectConfig } | { ok: false; reason: string };
}

export function cardDeps(env: Readonly<Record<string, string | undefined>> = process.env): CardDeps {
  return { switchOn: cardPaymentsSwitchOn(env), config: connectConfig(env) };
}

/** Members as the card services need them (the clinic actor, or tests' testActor). */
export type CardActor = BillingActor & { role?: string; clinicName?: string; email?: string };

type Ready = { api: ConnectApi; mode: "test" | "live"; settings: CardSettings; account: string };

function usable(deps: CardDeps): { ok: true; config: ConnectConfig } | { ok: false; error: string } {
  if (!deps.switchOn) return { ok: false, error: CARD_COPY.off };
  if (!deps.config.ok) return { ok: false, error: deps.config.reason };
  return { ok: true, config: deps.config.config };
}

/** The clinic's account when card payments may be taken now, else a plain refusal. */
async function readyFor(ctx: RepoContext, tenantId: string, deps: CardDeps): Promise<{ ok: true; ready: Ready } | { ok: false; error: string }> {
  const u = usable(deps);
  if (!u.ok) return u;
  const settings = await getCardSettings(ctx, tenantId);
  if (!cardPaymentsReady({ enabled: settings.enabled, accountRef: settings.accountRef, status: settings.status, mode: settings.accountMode, keyMode: u.config.mode }) || !settings.accountRef) {
    return { ok: false, error: CARD_COPY.notReady };
  }
  return { ok: true, ready: { api: u.config.api, mode: u.config.mode, settings, account: settings.accountRef } };
}

function providerFailure(err: unknown): Result<never> | null {
  if (err instanceof CardPaymentsError) return fail("invalid", err.message);
  return null;
}

async function guarded<T>(what: string, work: () => Promise<Result<T>>): Promise<Result<T>> {
  return attempt(what, async () => {
    try {
      return await work();
    } catch (err) {
      const f = providerFailure(err);
      if (f) return f;
      throw err;
    }
  });
}

/** May this member manage the clinic's payment account and readers? The owner (two-step is required for everyone). */
export function mayManageCards(actor: Pick<CardActor, "role" | "can">): boolean {
  return actor.role === "owner" && actor.can("settings.owner");
}

const today = (ctx: RepoContext) => ukToday(ctx.now ? ctx.now() : pmsNow());

/* ------------------------------------------------------------------------------------------------
 * Recording – the ONLY place card money enters the books (exactly once)
 * ----------------------------------------------------------------------------------------------*/

export type RecordOutcome = { status: "recorded" | "already"; paymentId: string } | { status: "not_paid" | "refused"; why: string };

async function paymentByRef(ctx: RepoContext, tenantId: string, ref: string): Promise<string | null> {
  const r = await ctx.db.selectFrom("pms_payments").select("id").where("tenant_id", "=", tenantId).where("provider", "=", CONNECT_PROVIDER).where("provider_ref", "=", ref).executeTakeFirst();
  return r?.id ?? null;
}

/**
 * Records a succeeded payment intent of the clinic's account against the intent row that started it – once. The
 * provider object must carry this clinic's id and the intent row's id in its metadata (we set both); an intent
 * nobody here started (the clinic's own dashboard, another app) is never recorded. Allocated to the intent's invoice
 * up to what it still owes – the rest stays on the patient's account (a payment never takes an invoice below zero).
 */
export async function recordIntentPayment(ctx: RepoContext, tenantId: string, intent: CardIntent, pi: IntentInfo, actor: PmsActor = SYSTEM_ACTOR): Promise<RecordOutcome> {
  if (intent.kind !== "payment") return { status: "refused", why: "not_a_payment" };
  if (pi.metadata.tenant_id !== tenantId || pi.metadata.card_intent_id !== intent.id) return { status: "refused", why: "metadata_mismatch" };
  if (pi.status !== "succeeded" || pi.currency !== "gbp" || pi.amountReceived <= 0) return { status: "not_paid", why: pi.status || "unknown" };
  if (intent.intentRef && intent.intentRef !== pi.id) return { status: "refused", why: "other_intent" };
  const existing = await paymentByRef(ctx, tenantId, pi.id);
  if (existing) {
    if (intent.status !== "succeeded" || intent.paymentId !== existing) await markIntentSucceeded(ctx, tenantId, intent.id, existing, pi.id);
    return { status: "already", paymentId: existing };
  }
  const patientId = intent.patientId;
  if (!patientId) return { status: "refused", why: "no_patient" };
  const inv = intent.invoiceId ? await getInvoice(ctx, tenantId, intent.invoiceId) : null;
  const allocatable = inv && inv.status === "issued" && inv.billTo === "patient" && inv.patientId === patientId ? Math.max(0, Math.min(pi.amountReceived, inv.balancePence)) : 0;
  const paidOn = pi.createdAt ? ukToday(new Date(pi.createdAt * 1000)) : today(ctx);
  const receivedOn = paidOn > today(ctx) ? today(ctx) : paidOn;
  const reference = (pi.card ? `${pi.card.brand.charAt(0).toUpperCase()}${pi.card.brand.slice(1)} ending ${pi.card.last4}` : "Card payment").slice(0, 80);
  const write = (allocate: number) =>
    recordPayment(
      ctx,
      tenantId,
      {
        payerKind: "patient",
        patientId,
        receivedOn,
        method: intent.purpose === "portal" ? "online" : "card",
        amountPence: pi.amountReceived,
        reference,
        siteId: inv?.siteId ?? null,
        allocations: allocate > 0 && inv ? [{ invoiceId: inv.id, amountPence: allocate }] : [],
      },
      actor,
      { provider: CONNECT_PROVIDER, providerRef: pi.id, extra: (paymentId, at) => [intentSucceededQuery(ctx, tenantId, intent.id, paymentId, at, pi.id)] },
    );
  try {
    const p = await write(allocatable);
    return { status: "recorded", paymentId: p.id };
  } catch (err) {
    if (!(err instanceof RepoInputError)) throw err;
    // Recorded meanwhile by another caller (the unique provider reference): read it back.
    const again = await paymentByRef(ctx, tenantId, pi.id);
    if (again) {
      await markIntentSucceeded(ctx, tenantId, intent.id, again, pi.id);
      return { status: "already", paymentId: again };
    }
    if (allocatable === 0) throw err;
    // The invoice changed meanwhile (paid another way): the card payment stays on the patient's account.
    const p = await write(0);
    return { status: "recorded", paymentId: p.id };
  }
}

/** Reads the intent's provider object again and records it if it succeeded (the "Check" buttons, return pages). */
export async function settleIntent(ctx: RepoContext, tenantId: string, api: ConnectApi, account: string, intent: CardIntent, actor: PmsActor = SYSTEM_ACTOR): Promise<{ intent: CardIntent; outcome: RecordOutcome | null; providerStatus: string | null }> {
  let ref = intent.intentRef;
  if (!ref && intent.checkoutRef) {
    const cs = await api.getCheckout(account, intent.checkoutRef);
    if (cs.paymentIntent) {
      await setIntentRefs(ctx, tenantId, intent.id, { intentRef: cs.paymentIntent });
      ref = cs.paymentIntent;
    } else if (cs.status === "expired") {
      await moveIntent(ctx, tenantId, intent.id, ["open", "processing"], "canceled");
    }
  }
  if (!ref || intent.kind !== "payment") return { intent: (await getIntent(ctx, tenantId, intent.id)) ?? intent, outcome: null, providerStatus: null };
  const pi = await api.getPaymentIntent(account, ref);
  let outcome: RecordOutcome | null = null;
  if (pi.status === "succeeded") outcome = await recordIntentPayment(ctx, tenantId, { ...intent, intentRef: ref }, pi, actor);
  else if (pi.status === "canceled") await moveIntent(ctx, tenantId, intent.id, ["open", "processing", "failed"], "canceled");
  else if (pi.status === "requires_payment_method" && pi.errorCode) await moveIntent(ctx, tenantId, intent.id, ["open", "processing"], "failed", { failureCode: pi.errorCode });
  return { intent: (await getIntent(ctx, tenantId, intent.id)) ?? intent, outcome, providerStatus: pi.status };
}

/**
 * Records a refund made through the clinic's account – once (its re_… reference is unique per clinic). Allocated to
 * the invoice when the invoice owes the money back (a credit note was issued first); otherwise kept on the patient's
 * account so takings stay true and the screen shows the difference.
 */
export async function recordIntentRefund(ctx: RepoContext, tenantId: string, intent: CardIntent, refund: { id: string; status: string; amount: number }, reason: string | null, actor: PmsActor = SYSTEM_ACTOR): Promise<RecordOutcome> {
  if (intent.kind !== "refund") return { status: "refused", why: "not_a_refund" };
  if (refund.status === "failed" || refund.status === "canceled") {
    await moveIntent(ctx, tenantId, intent.id, ["open", "processing"], "failed", { failureCode: refund.status });
    return { status: "not_paid", why: refund.status };
  }
  const existing = await paymentByRef(ctx, tenantId, refund.id);
  if (existing) {
    if (intent.paymentId !== existing) await markIntentSucceeded(ctx, tenantId, intent.id, existing, refund.id);
    return { status: "already", paymentId: existing };
  }
  if (!intent.patientId) return { status: "refused", why: "no_patient" };
  const inv = intent.invoiceId ? await getInvoice(ctx, tenantId, intent.invoiceId) : null;
  const owedBack = inv && inv.status === "issued" && inv.billTo === "patient" ? Math.max(0, -inv.balancePence) : 0;
  const allocate = Math.min(owedBack, refund.amount);
  const write = (a: number) =>
    recordPayment(
      ctx,
      tenantId,
      {
        kind: "refund",
        payerKind: "patient",
        patientId: intent.patientId,
        receivedOn: today(ctx),
        method: "card",
        amountPence: refund.amount,
        reference: "Refund to card",
        notes: reason ?? undefined,
        siteId: inv?.siteId ?? null,
        allocations: a > 0 && inv ? [{ invoiceId: inv.id, amountPence: a }] : [],
      },
      actor,
      { provider: CONNECT_PROVIDER, providerRef: refund.id, extra: (paymentId, at) => [intentSucceededQuery(ctx, tenantId, intent.id, paymentId, at, refund.id)] },
    );
  try {
    return { status: "recorded", paymentId: (await write(allocate)).id };
  } catch (err) {
    if (!(err instanceof RepoInputError)) throw err;
    const again = await paymentByRef(ctx, tenantId, refund.id);
    if (again) {
      await markIntentSucceeded(ctx, tenantId, intent.id, again, refund.id);
      return { status: "already", paymentId: again };
    }
    if (allocate === 0) throw err;
    return { status: "recorded", paymentId: (await write(0)).id };
  }
}

/** A refund that failed after it was recorded: the refund is reversed (money did not leave), the intent marked failed. */
export async function refundFailed(ctx: RepoContext, tenantId: string, refundRef: string): Promise<boolean> {
  const intent = await findIntentByRef(ctx, tenantId, refundRef);
  const paymentId = await paymentByRef(ctx, tenantId, refundRef);
  if (intent) await ctx.db.updateTable("pms_card_intents").set({ status: "failed", failure_code: "refund_failed", updated_at: (ctx.now ? ctx.now() : pmsNow()).toISOString() }).where("tenant_id", "=", tenantId).where("id", "=", intent.id).execute();
  if (!paymentId) return false;
  return reversePayment(ctx, tenantId, paymentId, { reason: "The card refund failed at the payment provider – no money was returned." }, SYSTEM_ACTOR);
}

/* ------------------------------------------------------------------------------------------------
 * Set-up → Card payments (owner)
 * ----------------------------------------------------------------------------------------------*/

export async function cardSetupFor(actor: CardActor, deps: CardDeps = cardDeps()): Promise<Result<CardSetupView>> {
  if (!mayManageCards(actor)) return forbidden();
  return guarded("card.setup_view", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const u = usable(deps);
    const keyMode = deps.config.ok ? deps.config.config.mode : "test";
    const [s, sites, readers, plans, members] = await Promise.all([getCardSettings(ctx, t), listSites(ctx, t), listReaders(ctx, t, { activeOnly: true }), listPlans(ctx, t), countMembersByPlan(ctx, t)]);
    const siteName = new Map(sites.map((x) => [x.id, x.name]));
    const sameMode = s.accountMode === keyMode;
    return ok({
      switchOn: deps.switchOn,
      configured: u.ok,
      unavailableReason: u.ok ? null : u.error,
      keyMode,
      enabled: s.enabled,
      accountRef: sameMode ? s.accountRef : null,
      status: sameMode ? s.status : "none",
      requirementsDue: sameMode ? s.requirementsDue : 0,
      ready: cardPaymentsReady({ enabled: s.enabled, accountRef: s.accountRef, status: s.status, mode: s.accountMode, keyMode }),
      lastSyncedAt: s.lastSyncedAt,
      noShowEnabled: s.noShowEnabled,
      noShowPolicy: s.noShowPolicy ?? "",
      feeText: s.feeBps === 0 && s.feeFixedPence === 0 ? "None – the clinic pays only the payment provider's own fees." : `${(s.feeBps / 100).toFixed(2)}% + ${formatPence(s.feeFixedPence)} per payment`,
      sites: sites.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
      readers: readers.map((r) => ({ id: r.id, label: r.label, siteId: r.siteId, siteName: siteName.get(r.siteId) ?? "A removed site", simulated: r.simulated, status: r.status })),
      plans: plans.map((p) => ({ id: p.id, name: p.name, pricePence: p.pricePence, active: p.active, members: members.get(p.id) ?? 0 })),
      webhookReady: deps.config.ok ? deps.config.config.webhookSecrets.length > 0 : false,
      rev: s.rev,
    });
  });
}

/**
 * "Connect your payment account": makes the clinic's connected account (once per mode – the provider's idempotency
 * key is the clinic and mode) and answers the provider's onboarding link. Run again to resume onboarding.
 */
export async function connectAccountFor(actor: CardActor, urls: { refreshUrl: string; returnUrl: string }, deps: CardDeps = cardDeps()): Promise<Result<{ url: string }>> {
  if (!mayManageCards(actor)) return forbidden();
  const u = usable(deps);
  if (!u.ok) return fail("invalid", u.error);
  return guarded("card.connect", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const s = await getCardSettings(ctx, t);
    let account = s.accountMode === u.config.mode && s.status !== "closed" ? s.accountRef : null;
    if (!account) {
      const made = await u.config.api.createAccount({ tenantId: t, clinicName: actor.clinicName ?? "Clinic", email: actor.email ?? null }, `clindesk-account-${u.config.mode}-${t}`);
      await saveConnectedAccount(ctx, t, { accountRef: made.id, mode: u.config.mode, state: accountStateOf(made.raw) }, actor.actor);
      account = made.id;
    }
    return ok({ url: await u.config.api.onboardingLink(account, urls) });
  });
}

/** Re-reads the account from the provider (the onboarding return page and the "Refresh" button). */
export async function refreshAccountFor(actor: CardActor, deps: CardDeps = cardDeps()): Promise<Result<{ status: string }>> {
  if (!mayManageCards(actor)) return forbidden();
  const u = usable(deps);
  if (!u.ok) return fail("invalid", u.error);
  return guarded("card.refresh", async () => {
    const s = await getCardSettings(actor.repo(), actor.tenantId);
    if (!s.accountRef || s.accountMode !== u.config.mode) return fail("invalid", "Connect the clinic's payment account first.");
    const state = accountStateOf(await u.config.api.getAccount(s.accountRef));
    await syncAccountState(actor.repo(), actor.tenantId, s.accountRef, state, actor.actor);
    return ok({ status: state.status });
  });
}

export async function setCardPaymentsEnabledFor(actor: CardActor, enabled: boolean, deps: CardDeps = cardDeps()): Promise<Result<{ enabled: boolean }>> {
  if (!mayManageCards(actor)) return forbidden();
  const u = usable(deps);
  if (!u.ok && enabled) return fail("invalid", u.error);
  return guarded("card.enable", async () => {
    const ctx = actor.repo();
    const s = await getCardSettings(ctx, actor.tenantId);
    if (enabled) {
      const mode = u.ok ? u.config.mode : "test";
      if (!s.accountRef || s.accountMode !== mode || s.status === "closed" || s.status === "none") return fail("invalid", "Connect the clinic's payment account first.");
      if (mode === "live" && s.status !== "active") return fail("invalid", "The payment provider has not finished checking the clinic's account. Finish the account set-up, then try again.");
    }
    await setCardEnabled(ctx, actor.tenantId, enabled, actor.actor);
    return ok({ enabled });
  });
}

export async function setNoShowPolicyFor(actor: CardActor, input: { enabled: boolean; policy: string }, deps: CardDeps = cardDeps()): Promise<Result<{ enabled: boolean }>> {
  if (!mayManageCards(actor)) return forbidden();
  if (!deps.switchOn) return fail("invalid", CARD_COPY.off);
  return guarded("card.no_show_policy", async () => {
    await setNoShowPolicy(actor.repo(), actor.tenantId, { enabled: input.enabled === true, policy: String(input.policy ?? "").slice(0, 600) }, actor.actor);
    return ok({ enabled: input.enabled === true });
  });
}

/** Registers a reader at a site (TEST mode: the provider's simulated reader). The site's location is made once. */
export async function addReaderFor(actor: CardActor, input: { siteId: string; label: string; registrationCode: string; line1: string; city: string; postcode: string }, deps: CardDeps = cardDeps()): Promise<Result<{ id: string }>> {
  if (!mayManageCards(actor)) return forbidden();
  const u = usable(deps);
  if (!u.ok) return fail("invalid", u.error);
  return guarded("card.add_reader", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const s = await getCardSettings(ctx, t);
    if (!s.accountRef || s.accountMode !== u.config.mode) return fail("invalid", "Connect the clinic's payment account first.");
    const site = (await listSites(ctx, t)).find((x) => x.id === input.siteId && x.active);
    if (!site) return fail("invalid", "Choose one of the clinic's sites.");
    const label = String(input.label ?? "").trim();
    if (!label || label.length > 60) return fail("invalid", "Give the reader a name (60 characters at most).", { fieldErrors: { label: "Required" } });
    const simulated = u.config.mode === "test";
    const code = simulated ? SIMULATED_READER_CODE : String(input.registrationCode ?? "").trim();
    if (!simulated && !/^[a-z0-9-]{3,40}$/i.test(code)) return fail("invalid", "Enter the pairing code shown on the reader.", { fieldErrors: { registrationCode: "Required" } });
    const existing = (await listReaders(ctx, t)).find((r) => r.siteId === site.id);
    let location = existing?.locationRef ?? null;
    if (!location) {
      const line1 = String(input.line1 ?? "").trim();
      const city = String(input.city ?? "").trim();
      const postcode = String(input.postcode ?? "").trim().toUpperCase();
      if (!line1 || !city || !/^[A-Z0-9 ]{5,8}$/.test(postcode)) return fail("invalid", "Enter the site's address (first line, town and postcode) – the payment provider needs it for the reader.");
      location = await u.config.api.createLocation(s.accountRef, { displayName: site.name, line1, city, postcode }, `clindesk-location-${t}-${site.id}`);
    }
    const reader = await u.config.api.registerReader(s.accountRef, { registrationCode: code, location, label });
    const saved = await addReader(ctx, t, { siteId: site.id, locationRef: location, readerRef: reader.id, label, deviceType: reader.deviceType, simulated }, actor.actor);
    return ok({ id: saved.id });
  });
}

export async function removeReaderFor(actor: CardActor, readerId: string, deps: CardDeps = cardDeps()): Promise<Result<{ removed: boolean }>> {
  if (!mayManageCards(actor)) return forbidden();
  return guarded("card.remove_reader", async () => {
    const ctx = actor.repo();
    const reader = await getReader(ctx, actor.tenantId, String(readerId ?? ""));
    if (!reader) return notFound();
    const s = await getCardSettings(ctx, actor.tenantId);
    const u = usable(deps);
    if (u.ok && s.accountRef) await u.config.api.deleteReader(s.accountRef, reader.readerRef).catch(() => undefined);
    return ok({ removed: await removeReader(ctx, actor.tenantId, reader.id, actor.actor) });
  });
}

export async function createPlanFor(actor: CardActor, input: { name: string; pricePence: number; vatCode?: "exempt" | "standard" | "reduced" | "zero" }, deps: CardDeps = cardDeps()): Promise<Result<{ id: string }>> {
  if (!actor.can("settings.setup")) return forbidden();
  if (!deps.switchOn) return fail("invalid", CARD_COPY.off);
  return guarded("card.create_plan", async () => ok({ id: (await createPlan(actor.repo(), actor.tenantId, { name: String(input.name ?? ""), pricePence: Number(input.pricePence), vatCode: input.vatCode }, actor.actor)).id }));
}

export async function setPlanActiveFor(actor: CardActor, planId: string, active: boolean, deps: CardDeps = cardDeps()): Promise<Result<{ changed: boolean }>> {
  if (!actor.can("settings.setup")) return forbidden();
  if (!deps.switchOn) return fail("invalid", CARD_COPY.off);
  if (!isPlausibleRecordId(planId)) return notFound();
  return guarded("card.plan_active", async () => {
    const plan = (await listPlans(actor.repo(), actor.tenantId)).find((p) => p.id === planId);
    if (!plan) return notFound();
    return ok({ changed: await setPlanActive(actor.repo(), actor.tenantId, plan.id, active === true, actor.actor) });
  });
}

/* ------------------------------------------------------------------------------------------------
 * The invoice screen: reader, saved card, refunds
 * ----------------------------------------------------------------------------------------------*/

function isNoShowInvoice(inv: Invoice): boolean {
  return inv.lines.some((l) => l.visitStatus === "did_not_attend" || l.visitStatus === "late_cancellation");
}

function payableByCard(inv: Invoice): string | null {
  if (inv.status !== "issued") return "Issue the invoice before taking a card payment.";
  if (inv.billTo !== "patient") return "Card payments here are for invoices to the patient. Insurer and account invoices are paid by their payer.";
  if (inv.balancePence < MIN_CARD_PENCE) return "Nothing (or too little for a card payment) is owed on this invoice.";
  return null;
}

function amountFor(inv: Invoice, requested: number | undefined): number | string {
  const amount = requested === undefined || requested === null ? inv.balancePence : Number(requested);
  if (!Number.isInteger(amount) || amount < MIN_CARD_PENCE) return `The smallest card payment is ${formatPence(MIN_CARD_PENCE)}.`;
  if (amount > inv.balancePence) return `This invoice owes only ${formatPence(inv.balancePence)}.`;
  return amount;
}

export async function invoiceCardViewFor(actor: CardActor, invoiceId: string, deps: CardDeps = cardDeps()): Promise<Result<InvoiceCardView | null>> {
  if (!actor.can("billing.view")) return forbidden();
  if (!deps.switchOn) return ok(null);
  return guarded("card.invoice_view", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const s = await getCardSettings(ctx, t);
    const keyMode = deps.config.ok ? deps.config.config.mode : "test";
    const ready = deps.config.ok && cardPaymentsReady({ enabled: s.enabled, accountRef: s.accountRef, status: s.status, mode: s.accountMode, keyMode });
    const intents = await listIntentsForInvoice(ctx, t, inv.id);
    if (!ready && intents.length === 0) return ok(null);
    const [readers, mandates] = await Promise.all([listReaders(ctx, t, { activeOnly: true }), inv.billTo === "patient" ? listMandates(ctx, t, inv.patientId) : Promise.resolve([])]);
    const scope = actor.siteIds ?? null;
    const payments: InvoiceCardView["cardPayments"] = [];
    for (const i of intents.filter((x) => x.kind === "payment" && x.status === "succeeded" && x.paymentId && x.intentRef)) {
      const p = await getPayment(ctx, t, i.paymentId as string);
      if (!p || p.status !== "recorded") continue;
      const refunded = (await listRefundIntents(ctx, t, i.intentRef as string)).filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((a, r) => a + r.amountPence, 0);
      payments.push({ paymentId: p.id, intentRef: i.intentRef as string, label: p.reference ?? "Card payment", amountPence: p.amountPence, refundedPence: refunded, refundablePence: Math.max(0, p.amountPence - refunded), receivedOn: p.receivedOn });
    }
    const pending = intents.find((x) => x.purpose === "reader" && (x.status === "open" || x.status === "processing"));
    const readerLabel = pending?.readerId ? readers.find((r) => r.id === pending.readerId)?.label ?? "Card reader" : "Card reader";
    return ok({
      ready,
      testMode: keyMode === "test",
      invoiceId: inv.id,
      balancePence: inv.balancePence,
      noShow: isNoShowInvoice(inv),
      readers: readers.filter((r) => scope === null || scope.has(r.siteId)).filter((r) => !inv.siteId || r.siteId === inv.siteId || readers.length === 1 || true).map((r) => ({ id: r.id, label: r.label, simulated: r.simulated })),
      savedCards: mandates.filter((m) => m.status === "active").map((m) => ({ id: m.id, label: mandateLabel(m), allowsNoShow: m.allowsNoShow })),
      noShowPolicyOn: s.noShowEnabled,
      cardPayments: payments,
      pendingReader: pending ? { intentId: pending.id, readerLabel, amountPence: pending.amountPence } : null,
      can: { pay: actor.can("billing.pay"), refund: actor.can("billing.refund") },
    });
  });
}

/** Sends the invoice's balance (or part of it) to a reader at the desk. The patient taps or inserts their card. */
export async function startReaderPaymentFor(actor: CardActor, input: { invoiceId: string; readerId: string; amountPence?: number }, deps: CardDeps = cardDeps()): Promise<Result<{ intentId: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.reader_start", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const r = await readyFor(ctx, t, deps);
    if (!r.ok) return fail("invalid", r.error);
    const inv = await invoiceInScope(actor, input.invoiceId);
    if (!inv) return notFound();
    const refusal = payableByCard(inv);
    if (refusal) return fail("invalid", refusal);
    const amount = amountFor(inv, input.amountPence);
    if (typeof amount === "string") return fail("invalid", amount, { fieldErrors: { amountPence: amount } });
    const reader = await getReader(ctx, t, String(input.readerId ?? ""));
    if (!reader || reader.status !== "active") return fail("invalid", "Choose one of the clinic's card readers.");
    if (actor.siteIds && !actor.siteIds.has(reader.siteId)) return fail("invalid", "Choose a card reader at one of your sites.");
    // One payment at a time per invoice at the desk: an open one is shown, not doubled.
    const open = (await listIntentsForInvoice(ctx, t, inv.id)).find((x) => x.purpose === "reader" && (x.status === "open" || x.status === "processing"));
    if (open) return fail("invalid", "A card payment for this invoice is already waiting on a reader. Check it or cancel it first.");
    const fee = platformFeePence(amount, { bps: r.ready.settings.feeBps, fixedPence: r.ready.settings.feeFixedPence });
    const intent = await createIntent(ctx, t, { kind: "payment", purpose: "reader", amountPence: amount, feePence: fee, invoiceId: inv.id, patientId: inv.patientId, readerId: reader.id }, actor.actor);
    try {
      const pi = await r.ready.api.createReaderPayment(r.ready.account, { amountPence: amount, feePence: fee, description: `Invoice ${inv.number ?? ""}`.trim(), metadata: { tenant_id: t, card_intent_id: intent.id, invoice_id: inv.id } }, intent.id);
      await setIntentRefs(ctx, t, intent.id, { intentRef: pi.id });
      await r.ready.api.processOnReader(r.ready.account, reader.readerRef, pi.id);
      await moveIntent(ctx, t, intent.id, ["open"], "processing");
    } catch (err) {
      await moveIntent(ctx, t, intent.id, ["open", "processing"], "failed", { failureCode: err instanceof CardPaymentsError ? err.code : "error" });
      throw err;
    }
    return ok({ intentId: intent.id });
  });
}

/** "Check payment": reads the payment again and records it when it succeeded. */
export async function checkCardPaymentFor(actor: CardActor, intentId: string, deps: CardDeps = cardDeps()): Promise<Result<{ status: string; message: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.check", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const intent = await getIntent(ctx, t, String(intentId ?? ""));
    if (!intent || intent.kind !== "payment" || !intent.invoiceId || !(await invoiceInScope(actor, intent.invoiceId))) return notFound();
    const u = usable(deps);
    if (!u.ok) return fail("invalid", u.error);
    const s = await getCardSettings(ctx, t);
    if (!s.accountRef) return fail("invalid", CARD_COPY.notReady);
    const r = await settleIntent(ctx, t, u.config.api, s.accountRef, intent, actor.actor);
    const status = r.intent.status;
    const message =
      status === "succeeded"
        ? `${formatPence(r.intent.amountPence)} taken by card and recorded on the invoice.`
        : status === "failed"
          ? "The card was declined or the payment did not finish. Nothing was taken."
          : status === "canceled"
            ? "The card payment was cancelled. Nothing was taken."
            : "Still waiting for the card on the reader.";
    return ok({ status, message });
  });
}

/** Cancels a payment waiting on the reader (if it already went through, it is recorded instead). */
export async function cancelReaderPaymentFor(actor: CardActor, intentId: string, deps: CardDeps = cardDeps()): Promise<Result<{ status: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.reader_cancel", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const intent = await getIntent(ctx, t, String(intentId ?? ""));
    if (!intent || intent.purpose !== "reader" || !intent.invoiceId || !(await invoiceInScope(actor, intent.invoiceId))) return notFound();
    const u = usable(deps);
    if (!u.ok) return fail("invalid", u.error);
    const s = await getCardSettings(ctx, t);
    if (!s.accountRef) return fail("invalid", CARD_COPY.notReady);
    const reader = intent.readerId ? await getReader(ctx, t, intent.readerId) : null;
    if (reader) await u.config.api.cancelReaderAction(s.accountRef, reader.readerRef).catch(() => undefined);
    if (intent.intentRef) {
      const pi = await u.config.api.getPaymentIntent(s.accountRef, intent.intentRef);
      if (pi.status === "succeeded") {
        await recordIntentPayment(ctx, t, intent, pi, actor.actor);
        return ok({ status: "succeeded" });
      }
      if (pi.status !== "canceled") {
        const after = await u.config.api.cancelPaymentIntent(s.accountRef, intent.intentRef).catch(async () => u.config.api.getPaymentIntent(s.accountRef as string, intent.intentRef as string));
        if (after.status === "succeeded") {
          await recordIntentPayment(ctx, t, intent, after, actor.actor);
          return ok({ status: "succeeded" });
        }
      }
    }
    await moveIntent(ctx, t, intent.id, ["open", "processing", "failed"], "canceled");
    return ok({ status: "canceled" });
  });
}

/** TEST MODE ONLY: the simulated reader "taps" a test card (4242… succeeds; 4000000000009995 is declined). */
export async function simulateReaderTapFor(actor: CardActor, intentId: string, cardNumber: string | undefined, deps: CardDeps = cardDeps()): Promise<Result<{ status: string; message: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  const u = usable(deps);
  if (!u.ok) return fail("invalid", u.error);
  if (u.config.mode !== "test") return fail("invalid", "Test cards work in test mode only.");
  return guarded("card.simulate", async () => {
    const ctx = actor.repo();
    const intent = await getIntent(ctx, actor.tenantId, String(intentId ?? ""));
    if (!intent || intent.purpose !== "reader" || !intent.readerId || !intent.invoiceId || !(await invoiceInScope(actor, intent.invoiceId))) return notFound();
    const reader = await getReader(ctx, actor.tenantId, intent.readerId);
    const s = await getCardSettings(ctx, actor.tenantId);
    if (!reader || !reader.simulated || !s.accountRef) return fail("invalid", "Only a test reader takes test cards.");
    await u.config.api.presentTestCard(s.accountRef, reader.readerRef, cardNumber && /^\d{12,19}$/.test(cardNumber) ? cardNumber : undefined);
    return checkCardPaymentFor(actor, intent.id, deps);
  });
}

/**
 * Charges a patient's saved card for an invoice (staff, billing.pay). A missed-appointment or late-cancellation fee
 * only with the clinic's policy on AND the patient's consent to such charges on that card.
 */
export async function chargeSavedCardFor(actor: CardActor, input: { invoiceId: string; mandateId: string; amountPence?: number }, deps: CardDeps = cardDeps()): Promise<Result<{ status: string; message: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.charge_saved", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const r = await readyFor(ctx, t, deps);
    if (!r.ok) return fail("invalid", r.error);
    const inv = await invoiceInScope(actor, input.invoiceId);
    if (!inv) return notFound();
    const refusal = payableByCard(inv);
    if (refusal) return fail("invalid", refusal);
    const amount = amountFor(inv, input.amountPence);
    if (typeof amount === "string") return fail("invalid", amount, { fieldErrors: { amountPence: amount } });
    const m = await getMandate(ctx, t, String(input.mandateId ?? ""));
    if (!m || m.patientId !== inv.patientId || m.status !== "active" || !m.methodRef) return fail("invalid", "That saved card is not this patient's.");
    if (isNoShowInvoice(inv)) {
      const no = noShowChargeRefusal({ policyOn: r.ready.settings.noShowEnabled, mandateAllowsNoShow: m.allowsNoShow });
      if (no) return fail("invalid", no);
    }
    const busy = (await listIntentsForInvoice(ctx, t, inv.id)).find((x) => x.kind === "payment" && (x.status === "open" || x.status === "processing"));
    if (busy) return fail("invalid", "Another card payment for this invoice is still in progress. Check it first.");
    return chargeMandate(ctx, t, r.ready, { inv, mandate: m, amount, purpose: "saved_card", actor: actor.actor });
  });
}

async function chargeMandate(
  ctx: RepoContext,
  t: string,
  ready: Ready,
  input: { inv: Invoice; mandate: { id: string; customerRef: string; methodRef: string | null }; amount: number; purpose: "saved_card" | "membership"; actor: PmsActor; membershipId?: string; period?: string; existing?: CardIntent },
): Promise<Result<{ status: string; message: string }>> {
  const fee = platformFeePence(input.amount, { bps: ready.settings.feeBps, fixedPence: ready.settings.feeFixedPence });
  const intent =
    input.existing ??
    (await createIntent(
      ctx,
      t,
      { kind: "payment", purpose: input.purpose, amountPence: input.amount, feePence: fee, invoiceId: input.inv.id, patientId: input.inv.patientId, mandateId: input.mandate.id, membershipId: input.membershipId ?? null, period: input.period ?? null },
      input.actor,
    ));
  const outcome = await ready.api.chargeSavedCard(
    ready.account,
    {
      amountPence: intent.amountPence,
      feePence: intent.feePence,
      customer: input.mandate.customerRef,
      paymentMethod: input.mandate.methodRef as string,
      description: `Invoice ${input.inv.number ?? ""}`.trim(),
      metadata: { tenant_id: t, card_intent_id: intent.id, invoice_id: input.inv.id },
    },
    // A retry of the same intent (membership's next attempt) needs a new key; the intent id + attempt makes it unique.
    `${intent.id}-${intent.attempts}`,
  );
  if (outcome.intent?.id) await setIntentRefs(ctx, t, intent.id, { intentRef: outcome.intent.id }).catch(() => undefined);
  if (outcome.ok) {
    const rec = await recordIntentPayment(ctx, t, { ...intent, intentRef: outcome.intent.id }, outcome.intent, input.actor);
    if (rec.status === "recorded" || rec.status === "already") return ok({ status: "succeeded", message: `${formatPence(outcome.intent.amountReceived)} taken from the saved card and recorded on the invoice.` });
    return fail("error", "The card was charged but the payment could not be recorded yet. It will be recorded automatically – do not charge again.");
  }
  await moveIntent(ctx, t, intent.id, ["open", "processing"], "failed", { failureCode: outcome.code, bumpAttempts: true });
  const why = outcome.code === "authentication_required" ? "The card's bank wants the patient to confirm this payment themselves. Ask them to pay in the patient portal or at the desk." : "The card was declined. Nothing was taken.";
  return fail("invalid", why);
}

/**
 * Refunds (part of) a card payment taken through the clinic's account, back to the same card. Audited; at most what
 * is left of that payment (checked in the database). The invoice is credited first for what it does not already owe
 * back, so the books always agree with the refund.
 */
export async function refundCardPaymentFor(actor: CardActor, input: { invoiceId: string; paymentId: string; amountPence: number; reason: string }, deps: CardDeps = cardDeps()): Promise<Result<{ refundedPence: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.refund")) return forbidden();
  return guarded("card.refund", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const u = usable(deps);
    if (!u.ok) return fail("invalid", u.error);
    const s = await getCardSettings(ctx, t);
    if (!s.accountRef || s.accountMode !== u.config.mode) return fail("invalid", CARD_COPY.notReady);
    const inv = await invoiceInScope(actor, input.invoiceId);
    if (!inv) return notFound();
    const amount = Number(input.amountPence);
    const reason = String(input.reason ?? "").trim();
    if (!Number.isInteger(amount) || amount <= 0) return fail("invalid", "Enter the amount to refund.", { fieldErrors: { amountPence: "Required" } });
    if (reason.length < 3) return fail("invalid", "Say why the money is refunded.", { fieldErrors: { reason: "Required" } });
    const p = isPlausibleRecordId(input.paymentId) ? await getPayment(ctx, t, input.paymentId) : null;
    if (!p || p.kind !== "payment" || p.status !== "recorded" || p.provider !== CONNECT_PROVIDER || !p.providerRef || !p.allocations.some((a) => a.invoiceId === inv.id)) {
      return fail("invalid", "That card payment is not on this invoice.");
    }
    const owedBack = Math.max(0, -inv.balancePence);
    if (amount > owedBack && amount - owedBack > inv.totalPence - inv.creditedPence) return fail("invalid", "That is more than can be credited on this invoice.");
    const parentIntent = await findIntentByRef(ctx, t, p.providerRef);
    // 1. Claim the amount (refused in the database beyond what is left of this payment).
    const refundIntent = await createRefundIntent(ctx, t, { parentRef: p.providerRef, paymentAmountPence: p.amountPence, amountPence: amount, invoiceId: inv.id, patientId: p.patientId, feePence: 0 }, actor.actor);
    // 2. Credit the invoice for what it does not already owe back.
    if (amount > owedBack) {
      try {
        await createCreditNote(ctx, t, { invoiceId: inv.id, lines: spreadOverLines(inv, amount - owedBack), reason }, actor.actor);
      } catch (err) {
        await moveIntent(ctx, t, refundIntent.id, ["open"], "canceled");
        throw err;
      }
    }
    // 3. The refund at the provider (its idempotency key is the refund intent).
    let refund;
    try {
      refund = await u.config.api.createRefund(s.accountRef, { paymentIntent: p.providerRef, amountPence: amount, refundPlatformFee: (parentIntent?.feePence ?? 0) > 0, metadata: { tenant_id: t, card_intent_id: refundIntent.id, invoice_id: inv.id } }, refundIntent.id);
    } catch (err) {
      await moveIntent(ctx, t, refundIntent.id, ["open"], "failed", { failureCode: err instanceof CardPaymentsError ? err.code : "error" });
      if (err instanceof CardPaymentsError) return fail("invalid", "The payment provider refused the refund. The invoice was credited; nothing was returned to the card yet – try again, or refund another way.");
      throw err;
    }
    await setIntentRefs(ctx, t, refundIntent.id, { intentRef: refund.id });
    const rec = await recordIntentRefund(ctx, t, { ...refundIntent, intentRef: refund.id }, refund, reason, actor.actor);
    if (rec.status === "not_paid") return fail("invalid", "The payment provider could not make the refund. Nothing was returned to the card.");
    return ok({ refundedPence: amount });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Saved cards (desk and portal) and memberships
 * ----------------------------------------------------------------------------------------------*/

export async function patientCardsFor(actor: CardActor, patientId: string, deps: CardDeps = cardDeps()): Promise<Result<PatientCardsView | null>> {
  if (!actor.can("billing.view")) return forbidden();
  if (!deps.switchOn) return ok(null);
  return guarded("card.patient_view", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const s = await getCardSettings(ctx, t);
    const keyMode = deps.config.ok ? deps.config.config.mode : "test";
    const ready = deps.config.ok && cardPaymentsReady({ enabled: s.enabled, accountRef: s.accountRef, status: s.status, mode: s.accountMode, keyMode });
    const [mandates, plans, memberships] = await Promise.all([listMandates(ctx, t, patient.id), listPlans(ctx, t), listMemberships(ctx, t, patient.id)]);
    if (!ready && mandates.length === 0 && memberships.length === 0) return ok(null);
    const planById = new Map(plans.map((p) => [p.id, p]));
    const mandateById = new Map(mandates.map((m) => [m.id, m]));
    const clinicName = actor.clinicName ?? "the clinic";
    return ok({
      ready,
      testMode: keyMode === "test",
      cards: mandates
        .filter((m) => m.status === "active" || m.status === "pending")
        .map((m) => ({ id: m.id, label: m.status === "pending" ? "Card form not finished yet" : mandateLabel(m), status: m.status, consentAt: m.consentAt, consentChannel: m.consentChannel, allowsNoShow: m.allowsNoShow, wording: m.consentWording })),
      noShowPolicy: s.noShowEnabled ? s.noShowPolicy : null,
      consentPreview: { plain: cardConsentWording({ clinicName, noShowPolicy: null }), withNoShow: s.noShowEnabled && s.noShowPolicy ? cardConsentWording({ clinicName, noShowPolicy: s.noShowPolicy }) : null },
      plans: plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, pricePence: p.pricePence })),
      memberships: memberships.map((ms) => ({
        id: ms.id,
        planName: planById.get(ms.planId)?.name ?? "A plan",
        pricePence: planById.get(ms.planId)?.pricePence ?? 0,
        status: ms.status,
        nextChargeOn: ms.nextChargeOn,
        cardLabel: mandateById.get(ms.mandateId) ? mandateLabel(mandateById.get(ms.mandateId)!) : "Saved card",
      })),
      can: { pay: actor.can("billing.pay"), manage: actor.can("billing.pay") },
    });
  });
}

/**
 * Starts saving a card: the patient's consent is recorded FIRST (exact words, version, how and who), then the
 * provider's hosted card form opens (the patient types the card there – on the clinic's screen at the desk, or on
 * their own device in the portal). The card becomes usable once the provider confirms it.
 */
export async function startSaveCard(
  ctx: RepoContext,
  tenantId: string,
  input: { patientId: string; clinicName: string; channel: ConsentChannel; allowsNoShow: boolean; successUrl: string; cancelUrl: string },
  actor: PmsActor,
  deps: CardDeps,
): Promise<Result<{ url: string; mandateId: string }>> {
  const r = await readyFor(ctx, tenantId, deps);
  if (!r.ok) return fail("invalid", r.error);
  const noShow = input.allowsNoShow === true && r.ready.settings.noShowEnabled && Boolean(r.ready.settings.noShowPolicy);
  const wording = cardConsentWording({ clinicName: input.clinicName, noShowPolicy: noShow ? r.ready.settings.noShowPolicy : null });
  let customer = await customerRefFor(ctx, tenantId, input.patientId);
  if (!customer) customer = await r.ready.api.createCustomer(r.ready.account, { tenantId, patientId: input.patientId }, `clindesk-customer-${tenantId}-${input.patientId}`);
  const mandate = await createMandate(ctx, tenantId, { patientId: input.patientId, customerRef: customer, consentWording: wording, channel: input.channel, allowsNoShow: noShow }, actor);
  const intent = await createIntent(ctx, tenantId, { kind: "setup", purpose: "save_card", amountPence: 0, patientId: input.patientId, mandateId: mandate.id }, actor);
  const sep = (u: string) => (u.includes("?") ? "&" : "?");
  const cs = await r.ready.api.createSetupCheckout(
    r.ready.account,
    { customer, successUrl: `${input.successUrl}${sep(input.successUrl)}card=${mandate.id}`, cancelUrl: input.cancelUrl, metadata: { tenant_id: tenantId, card_intent_id: intent.id, mandate_id: mandate.id } },
    intent.id,
  );
  await setMandateSetupRef(ctx, tenantId, mandate.id, cs.id);
  await setIntentRefs(ctx, tenantId, intent.id, { checkoutRef: cs.id });
  if (!cs.url) return fail("error", "The payment provider gave no card form. Try again.");
  return ok({ url: cs.url, mandateId: mandate.id });
}

/**
 * Finishes saving a card once the provider says the set-up succeeded (the return page, the webhook – either first,
 * once). The set-up intent must belong to this clinic's account and carry this mandate's id.
 */
export async function completeSaveCard(ctx: RepoContext, tenantId: string, api: ConnectApi, account: string, mandateId: string, actor: PmsActor = SYSTEM_ACTOR): Promise<"active" | "pending" | "failed" | "refused"> {
  const m = await getMandate(ctx, tenantId, mandateId);
  if (!m) return "refused";
  if (m.status === "active") return "active";
  if (m.status !== "pending" || !m.setupRef) return "refused";
  const cs = await api.getCheckout(account, m.setupRef);
  if (cs.metadata.tenant_id !== tenantId || cs.metadata.mandate_id !== m.id) return "refused";
  if (cs.status === "expired") {
    await removeMandate(ctx, tenantId, m.id, actor, "failed");
    return "failed";
  }
  if (!cs.setupIntent) return "pending";
  const si = await api.getSetupIntent(account, cs.setupIntent);
  if (si.status !== "succeeded" || !si.paymentMethod) return "pending";
  if (si.customer && si.customer !== m.customerRef) return "refused";
  const card = await api.getCard(account, si.paymentMethod);
  await activateMandate(ctx, tenantId, m.id, { methodRef: si.paymentMethod, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear }, actor);
  const intent = await findIntentByRef(ctx, tenantId, m.setupRef);
  if (intent) {
    await setIntentRefs(ctx, tenantId, intent.id, { intentRef: si.id }).catch(() => undefined);
    await moveIntent(ctx, tenantId, intent.id, ["open", "processing"], "succeeded");
  }
  return "active";
}

export async function startSaveCardFor(actor: CardActor, input: { patientId: string; allowsNoShow: boolean; consentConfirmed: boolean; successUrl: string; cancelUrl: string }, deps: CardDeps = cardDeps()): Promise<Result<{ url: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  if (input.consentConfirmed !== true) return fail("invalid", "Read the wording to the patient and tick that they agreed before saving a card.", { fieldErrors: { consent: "Required" } });
  return guarded("card.save_start", async () => {
    const patient = await patientInClinic(actor, input.patientId);
    if (!patient) return notFound();
    const r = await startSaveCard(actor.repo(), actor.tenantId, { patientId: patient.id, clinicName: actor.clinicName ?? "the clinic", channel: "desk", allowsNoShow: input.allowsNoShow === true, successUrl: input.successUrl, cancelUrl: input.cancelUrl }, actor.actor, deps);
    return r.ok ? ok({ url: r.value.url }) : r;
  });
}

/** The desk's return from the card form (or "Check card"): finishes the mandate if the provider confirmed it. */
export async function checkSavedCardFor(actor: CardActor, mandateId: string, deps: CardDeps = cardDeps()): Promise<Result<{ status: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.save_check", async () => {
    const ctx = actor.repo();
    const m = await getMandate(ctx, actor.tenantId, String(mandateId ?? ""));
    if (!m || !(await patientInClinic(actor, m.patientId))) return notFound();
    const u = usable(deps);
    if (!u.ok) return fail("invalid", u.error);
    const s = await getCardSettings(ctx, actor.tenantId);
    if (!s.accountRef) return fail("invalid", CARD_COPY.notReady);
    return ok({ status: await completeSaveCard(ctx, actor.tenantId, u.config.api, s.accountRef, m.id, actor.actor) });
  });
}

export async function removeSavedCardFor(actor: CardActor, mandateId: string, deps: CardDeps = cardDeps()): Promise<Result<{ removed: boolean; membershipsCancelled: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.save_remove", async () => {
    const ctx = actor.repo();
    const m = await getMandate(ctx, actor.tenantId, String(mandateId ?? ""));
    if (!m || !(await patientInClinic(actor, m.patientId))) return notFound();
    const cancelled = await cancelMembershipsOfMandate(ctx, actor.tenantId, m.id, actor.actor);
    const removed = await removeMandate(ctx, actor.tenantId, m.id, actor.actor);
    const s = await getCardSettings(ctx, actor.tenantId);
    const u = usable(deps);
    if (removed && m.methodRef && s.accountRef && u.ok) await u.config.api.detachCard(s.accountRef, m.methodRef).catch(() => undefined);
    return ok({ removed, membershipsCancelled: cancelled });
  });
}

export async function startMembershipFor(actor: CardActor, input: { patientId: string; planId: string; mandateId: string; chargeDay: number; consentConfirmed: boolean }, deps: CardDeps = cardDeps()): Promise<Result<{ id: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  if (input.consentConfirmed !== true) return fail("invalid", "Read the membership wording to the patient and tick that they agreed.", { fieldErrors: { consent: "Required" } });
  return guarded("card.membership_start", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const r = await readyFor(ctx, t, deps);
    if (!r.ok) return fail("invalid", r.error);
    const patient = await patientInClinic(actor, input.patientId);
    if (!patient) return notFound();
    const plan = (await listPlans(ctx, t)).find((p) => p.id === input.planId && p.active);
    if (!plan) return fail("invalid", "Choose one of the clinic's membership plans.");
    const m = await getMandate(ctx, t, String(input.mandateId ?? ""));
    if (!m || m.patientId !== patient.id || m.status !== "active") return fail("invalid", "Choose one of the patient's saved cards.");
    const day = clampDay(input.chargeDay);
    const start = today(ctx);
    const wording = membershipConsentWording({ clinicName: actor.clinicName ?? "the clinic", planName: plan.name, pricePence: plan.pricePence, chargeDay: day });
    const ms = await createMembership(ctx, t, { patientId: patient.id, planId: plan.id, mandateId: m.id, siteId: null, chargeDay: day, startedOn: start, consentWording: wording, channel: "desk" }, actor.actor);
    return ok({ id: ms.id });
  });
}

export async function cancelMembershipFor(actor: CardActor, membershipId: string): Promise<Result<{ cancelled: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return guarded("card.membership_cancel", async () => {
    const ctx = actor.repo();
    const ms = await getMembership(ctx, actor.tenantId, String(membershipId ?? ""));
    if (!ms || !(await patientInClinic(actor, ms.patientId))) return notFound();
    return ok({ cancelled: await cancelMembership(ctx, actor.tenantId, ms.id, actor.actor) });
  });
}

/**
 * One membership's charge for the period that is due: an issued invoice for the plan, then the saved card charged
 * off-session. Exactly once per membership and month: the intent row's unique (membership, period) claims the
 * month before anything else happens, the invoice is made once (linked on the intent), and the provider's
 * idempotency key is the intent (+ attempt). A decline is retried the next days, then the membership is marked
 * "payment failed" and the invoice stays open for the patient to pay.
 */
export async function chargeMembership(ctx: RepoContext, tenantId: string, ms: Membership, ready: Ready, todayIso: string): Promise<"charged" | "declined" | "skipped" | "failed"> {
  if (!ms.nextChargeOn || ms.nextChargeOn > todayIso || ms.status !== "active") return "skipped";
  const period = periodOf(ms.nextChargeOn);
  const plan = (await listPlans(ctx, tenantId)).find((p) => p.id === ms.planId);
  const mandate = await getMandate(ctx, tenantId, ms.mandateId);
  if (!plan || !mandate || mandate.status !== "active" || !mandate.methodRef) {
    await membershipCharged(ctx, tenantId, ms.id, { ok: false, giveUp: true });
    return "failed";
  }
  // 1. Claim the period (or find this period's claim from an earlier run).
  let intent: CardIntent | null = null;
  const claimed = await ctx.db.selectFrom("pms_card_intents").selectAll().where("tenant_id", "=", tenantId).where("kind", "=", "payment").where("membership_id", "=", ms.id).where("period", "=", period).executeTakeFirst();
  if (claimed) intent = await getIntent(ctx, tenantId, claimed.id);
  if (!intent) {
    try {
      intent = await createIntent(ctx, tenantId, { kind: "payment", purpose: "membership", amountPence: plan.pricePence, feePence: platformFeePence(plan.pricePence, { bps: ready.settings.feeBps, fixedPence: ready.settings.feeFixedPence }), patientId: ms.patientId, mandateId: mandate.id, membershipId: ms.id, period }, SYSTEM_ACTOR);
    } catch (err) {
      if (err instanceof RepoInputError) return "skipped"; // another run claimed it this instant
      throw err;
    }
  }
  if (intent.status === "succeeded") {
    await membershipCharged(ctx, tenantId, ms.id, { ok: true, nextChargeOn: nextChargeOn(ms.nextChargeOn, ms.chargeDay) });
    return "charged";
  }
  // A charge from an earlier run that may have gone through: look before charging again.
  if (intent.intentRef) {
    const settled = await settleIntent(ctx, tenantId, ready.api, ready.account, intent);
    if (settled.intent.status === "succeeded") {
      await membershipCharged(ctx, tenantId, ms.id, { ok: true, nextChargeOn: nextChargeOn(ms.nextChargeOn, ms.chargeDay) });
      return "charged";
    }
    intent = settled.intent;
  }
  // A run that stopped half-way (status processing, no answer recorded): ask the provider before charging again.
  if (intent.status === "processing") {
    const age = (ctx.now ? ctx.now() : pmsNow()).getTime() - Date.parse(intent.updatedAt);
    if (age < 10 * 60_000) return "skipped";
    const found = (await ready.api.findPaymentsForIntent(ready.account, intent.id)).find((p) => p.status === "succeeded");
    if (found) {
      await recordIntentPayment(ctx, tenantId, { ...intent, intentRef: found.id }, found);
      await membershipCharged(ctx, tenantId, ms.id, { ok: true, nextChargeOn: nextChargeOn(ms.nextChargeOn, ms.chargeDay) });
      return "charged";
    }
    await moveIntent(ctx, tenantId, intent.id, ["processing"], "failed", { failureCode: "interrupted" });
    intent = (await getIntent(ctx, tenantId, intent.id)) as CardIntent;
  }
  // 2. Take the run's turn on this intent (exactly one caller moves it to processing).
  if (!(await moveIntent(ctx, tenantId, intent.id, ["open", "failed"], "processing"))) return "skipped";
  // 3. The invoice (once – linked on the intent).
  let invoiceId = intent.invoiceId;
  if (!invoiceId) {
    const settings = await getBillingSettings(ctx, tenantId);
    const { invoice } = await createDraftInvoice(
      ctx,
      tenantId,
      { patientId: ms.patientId, siteId: ms.siteId, lines: [{ kind: "item", description: `${plan.name} – membership ${period}`, unitPricePence: plan.pricePence, quantity: 1, vatCode: settings.vatRegistered ? plan.vatCode : "none" }] },
      SYSTEM_ACTOR,
    );
    const issued = await issueInvoice(ctx, tenantId, invoice.id, invoice.rev, {}, SYSTEM_ACTOR);
    if (!issued.ok) throw new RepoInputError("The membership invoice could not be issued.");
    await ctx.db.updateTable("pms_card_intents").set({ invoice_id: invoice.id, amount_pence: issued.invoice.totalPence, updated_at: (ctx.now ? ctx.now() : pmsNow()).toISOString() }).where("tenant_id", "=", tenantId).where("id", "=", intent.id).where("invoice_id", "is", null).execute();
    invoiceId = invoice.id;
    intent = (await getIntent(ctx, tenantId, intent.id)) as CardIntent;
  }
  const inv = await getInvoice(ctx, tenantId, invoiceId);
  if (!inv || inv.balancePence <= 0) {
    // Paid another way meanwhile: nothing to charge.
    await moveIntent(ctx, tenantId, intent.id, ["processing"], "canceled");
    await membershipCharged(ctx, tenantId, ms.id, { ok: true, nextChargeOn: nextChargeOn(ms.nextChargeOn, ms.chargeDay) });
    return "skipped";
  }
  const amount = Math.min(inv.balancePence, intent.amountPence);
  const r = await chargeMandate(ctx, tenantId, ready, { inv, mandate, amount, purpose: "membership", actor: SYSTEM_ACTOR, existing: { ...intent, amountPence: amount } });
  if (r.ok) {
    await membershipCharged(ctx, tenantId, ms.id, { ok: true, nextChargeOn: nextChargeOn(ms.nextChargeOn, ms.chargeDay) });
    return "charged";
  }
  const after = await getIntent(ctx, tenantId, intent.id);
  await membershipCharged(ctx, tenantId, ms.id, { ok: false, giveUp: (after?.attempts ?? MEMBERSHIP_MAX_ATTEMPTS) >= MEMBERSHIP_MAX_ATTEMPTS });
  return "declined";
}

/* ------------------------------------------------------------------------------------------------
 * The patient portal (l04: pay an invoice; save a card)
 * ----------------------------------------------------------------------------------------------*/

export interface PortalInvoiceRow {
  id: string;
  number: string;
  issuedOn: string | null;
  dueOn: string | null;
  balancePence: number;
}

/** The patient's issued invoices that still owe money – only when the clinic takes card payments now. */
export async function portalInvoices(ctx: RepoContext, tenantId: string, patientId: string, deps: CardDeps = cardDeps()): Promise<{ payable: boolean; testMode: boolean; rows: PortalInvoiceRow[] }> {
  const r = await readyFor(ctx, tenantId, deps);
  if (!r.ok) return { payable: false, testMode: false, rows: [] };
  const rows = await ctx.db
    .selectFrom("pms_invoices")
    .select(["id", "number_prefix", "number_seq", "issued_on", "due_on", "total_pence", "paid_pence", "credited_pence"])
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("bill_to", "=", "patient")
    .where("status", "=", "issued")
    .orderBy("issued_on")
    .limit(50)
    .execute()
    .catch(() => [] as never[]);
  return {
    payable: true,
    testMode: r.ready.mode === "test",
    rows: (rows as Record<string, unknown>[])
      .map((x) => ({
        id: String(x.id),
        number: formatDocumentNumber(x.number_prefix as string | null, x.number_seq === null || x.number_seq === undefined ? null : Number(x.number_seq)) ?? "",
        issuedOn: (x.issued_on as string | null) ?? null,
        dueOn: (x.due_on as string | null) ?? null,
        balancePence: Number(x.total_pence) - Number(x.paid_pence) - Number(x.credited_pence),
      }))
      .filter((x) => x.balancePence >= MIN_CARD_PENCE),
  };
}

/** "Pay now" in the portal: the provider's hosted payment page for the invoice's balance on the clinic's account. */
export async function startPortalPayment(ctx: RepoContext, tenantId: string, input: { patientId: string; invoiceId: string; successUrl: string; cancelUrl: string }, actor: PmsActor, deps: CardDeps = cardDeps()): Promise<Result<{ url: string }>> {
  try {
    const r = await readyFor(ctx, tenantId, deps);
    if (!r.ok) return fail("invalid", r.error);
    if (!isPlausibleRecordId(input.invoiceId)) return notFound();
    const inv = await getInvoice(ctx, tenantId, input.invoiceId);
    if (!inv || inv.patientId !== input.patientId || inv.billTo !== "patient") return notFound();
    const refusal = payableByCard(inv);
    if (refusal) return fail("invalid", "This invoice has nothing left to pay.");
    // An open checkout for the same amount is reused (one tab, one payment page).
    const open = (await listIntentsForInvoice(ctx, tenantId, inv.id)).filter((x) => x.purpose === "portal" && x.status === "open" && x.checkoutRef);
    for (const o of open) {
      const cs = await r.ready.api.getCheckout(r.ready.account, o.checkoutRef as string);
      if (cs.status === "open" && cs.url && o.amountPence === inv.balancePence) return ok({ url: cs.url });
      if (cs.status === "complete") {
        await settleIntent(ctx, tenantId, r.ready.api, r.ready.account, o, actor);
        return fail("invalid", "This invoice was just paid. Thank you.");
      }
      if (cs.status === "open") await r.ready.api.expireCheckout(r.ready.account, cs.id).catch(() => undefined);
      await moveIntent(ctx, tenantId, o.id, ["open"], "canceled");
    }
    const fee = platformFeePence(inv.balancePence, { bps: r.ready.settings.feeBps, fixedPence: r.ready.settings.feeFixedPence });
    const intent = await createIntent(ctx, tenantId, { kind: "payment", purpose: "portal", amountPence: inv.balancePence, feePence: fee, invoiceId: inv.id, patientId: inv.patientId }, actor);
    const sep = input.successUrl.includes("?") ? "&" : "?";
    const cs = await r.ready.api.createPaymentCheckout(
      r.ready.account,
      { amountPence: inv.balancePence, feePence: fee, lineName: `Invoice ${inv.number ?? ""}`.trim(), successUrl: `${input.successUrl}${sep}paid=${intent.id}`, cancelUrl: input.cancelUrl, metadata: { tenant_id: tenantId, card_intent_id: intent.id, invoice_id: inv.id } },
      intent.id,
    );
    await setIntentRefs(ctx, tenantId, intent.id, { checkoutRef: cs.id });
    if (!cs.url) return fail("error", "The payment page could not be opened. Try again.");
    return ok({ url: cs.url });
  } catch (err) {
    const f = providerFailure(err);
    if (f) return f;
    if (err instanceof RepoInputError) return fail("invalid", err.message);
    throw err;
  }
}

/** The portal's return page: records the payment if the provider confirms it (the webhook may have done so first). */
export async function completePortalPayment(ctx: RepoContext, tenantId: string, patientId: string, intentId: string, deps: CardDeps = cardDeps()): Promise<"paid" | "pending" | "unknown"> {
  const intent = await getIntent(ctx, tenantId, String(intentId ?? ""));
  if (!intent || intent.patientId !== patientId || intent.purpose !== "portal") return "unknown";
  if (intent.status === "succeeded") return "paid";
  const u = usable(deps);
  const s = await getCardSettings(ctx, tenantId);
  if (!u.ok || !s.accountRef) return "pending";
  const r = await settleIntent(ctx, tenantId, u.config.api, s.accountRef, intent);
  return r.intent.status === "succeeded" ? "paid" : "pending";
}

/* ------------------------------------------------------------------------------------------------
 * Payouts and fees (cp05) – read live from the clinic's account
 * ----------------------------------------------------------------------------------------------*/

export async function payoutsFor(actor: CardActor, input: { payout: string | null }, deps: CardDeps = cardDeps()): Promise<Result<PayoutsView | null>> {
  if (!actor.can("billing.view") || !actor.can("billing.refund")) return forbidden();
  if (!deps.switchOn) return ok(null);
  return guarded("card.payouts", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const u = usable(deps);
    const s = await getCardSettings(ctx, t);
    if (!u.ok || !s.accountRef || s.accountMode !== u.config.mode) return ok(null);
    const api = u.config.api;
    const [balance, payouts] = await Promise.all([api.getBalance(s.accountRef), api.listPayouts(s.accountRef, 20)]);
    const selected = input.payout && payouts.some((p) => p.id === input.payout) ? input.payout : null;
    const lines = await api.listBalanceLines(s.accountRef, { payout: selected, limit: 100 });
    // Which invoice each card movement belongs to: only intents of THIS clinic (matched by the provider's reference).
    const refs = Array.from(new Set(lines.map((l) => l.paymentIntent).filter((x): x is string => Boolean(x))));
    const invoiceOf = new Map<string, string>();
    for (let i = 0; i < refs.length; i += 90) {
      const rows = await ctx.db.selectFrom("pms_card_intents").select(["intent_ref", "invoice_id"]).where("tenant_id", "=", t).where("intent_ref", "in", refs.slice(i, i + 90)).execute();
      for (const r of rows) if (r.intent_ref && r.invoice_id) invoiceOf.set(r.intent_ref, r.invoice_id);
    }
    const numbers = new Map<string, string>();
    for (const id of Array.from(new Set(Array.from(invoiceOf.values())))) {
      const inv = await getInvoice(ctx, t, id);
      if (inv?.number) numbers.set(id, inv.number);
    }
    const day = (unix: number) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : "");
    const shown = lines.filter((l) => l.type !== "payout");
    const view: PayoutsView = {
      ready: true,
      testMode: u.config.mode === "test",
      balance: { availablePence: balance.available, pendingPence: balance.pending },
      payouts: payouts.map((p) => ({ id: p.id, amountPence: p.amount, arrivalOn: day(p.arrivalDate), status: p.status })),
      lines: shown.map((l) => {
        const invoiceId = l.paymentIntent ? (invoiceOf.get(l.paymentIntent) ?? null) : null;
        return { id: l.id, type: l.type, grossPence: l.amount, providerFeePence: l.providerFee, platformFeePence: l.platformFee, netPence: l.net, availableOn: day(l.availableOn), invoiceId, invoiceNumber: invoiceId ? (numbers.get(invoiceId) ?? null) : null };
      }),
      selected,
      totals: shown.reduce((a, l) => ({ grossPence: a.grossPence + l.amount, providerFeePence: a.providerFeePence + l.providerFee, platformFeePence: a.platformFeePence + l.platformFee, netPence: a.netPence + l.net }), { grossPence: 0, providerFeePence: 0, platformFeePence: 0, netPence: 0 }),
    };
    return ok(view);
  });
}
