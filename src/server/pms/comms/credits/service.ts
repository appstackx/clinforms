/**
 * Prepaid text credits – what happens around every text and every payment (rules: src/modules/pms/comms/credits.ts,
 * ledger: src/server/repos/pms/comms/credits.ts).
 *
 * Around a text (src/server/pms/comms/dispatch.ts): takeCreditsForText BEFORE the provider is called – an automatic
 * top-up first when one is due, then the reservation (a debit entry); "no credit" means the caller sends an email
 * instead or records the text as not sent. After the provider answered: returnCreditsForText unless the text was
 * sent (failed, kept in the outbox, never written). Then the owner/admin warnings (20 % of the last pack, zero),
 * once per crossing.
 *
 * Payments: fulfilCheckout (the webhook's checkout.session.completed and the success page – both idempotent, the
 * first to arrive credits the pack) and fulfilPaymentIntent (payment_intent.succeeded – checkout purchases and
 * automatic top-ups). Every payment is re-read from the provider and checked against the clinic before anything
 * is credited: the clinic id in the metadata AND the client reference, the clinic's own customer, the pack's price
 * and currency, paid, the key's mode.
 */
import { randomBytes } from "node:crypto";
import { smsPack, topUpDue, warningDue, type CreditWarning } from "../../../../modules/pms/comms/credits";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { assertTenantId, type DbContext } from "../../../repos/pms/context";
import {
  claimCreditWarning,
  claimTopUp,
  creditSmsPack,
  finishTopUp,
  getSmsCreditAccount,
  releaseSmsCredits,
  reserveSmsCredits,
  saveCreditCard,
  webhookEventApplied,
  type CreditChangeResult,
  type SmsCreditAccount,
} from "../../../repos/pms/comms/credits";
import { CardPaymentsError, type CardPayments, type CheckoutSessionInfo, type PaymentIntentInfo } from "./card-payments";

export const CREDITS_SYSTEM_ACTOR: PmsActor = { userId: null, sessionId: null };

export type CreditNotice = { kind: "low"; balance: number; lowThreshold: number } | { kind: "zero" } | { kind: "topup_failed" };

/** Tells the clinic's owner and admins (by email – ./notify.ts). Never throws into a send. */
export type CreditNotifier = (ctx: DbContext, tenantId: string, notice: CreditNotice) => Promise<void>;

export interface CreditDeps {
  /** The card payment service (null: not configured – no automatic top-up). */
  payments?: (() => CardPayments | null) | null;
  notify?: CreditNotifier | null;
}

/* ------------------------------------------------------------------------------------------------
 * Around a text
 * ----------------------------------------------------------------------------------------------*/

export type TakeResult = { ok: true; debitId: string; credits: number; balance: number } | { ok: false; balance: number };

/**
 * Before handing a text to the provider: tops up first if due (automatic top-up), then reserves `credits`. No
 * credit (still not enough after any top-up): nothing taken, the zero warning considered, { ok: false }.
 */
export async function takeCreditsForText(ctx: DbContext, tenantId: string, input: { credits: number; messageId: string }, actor: PmsActor, deps: CreditDeps = {}): Promise<TakeResult> {
  assertTenantId(tenantId);
  await autoTopUpIfDue(ctx, tenantId, input.credits, deps);
  const r: CreditChangeResult = await reserveSmsCredits(ctx, tenantId, input, actor);
  if (!r.ok) {
    const acct = await getSmsCreditAccount(ctx, tenantId);
    await warnIfDue(ctx, tenantId, acct, deps);
    return { ok: false, balance: acct.balance };
  }
  await warnIfDue(ctx, tenantId, null, deps, r.balance);
  return { ok: true, debitId: r.entryId, credits: input.credits, balance: r.balance };
}

/** After the provider answered something other than "sent" (or the message could not be written): the credits back. */
export async function returnCreditsForText(ctx: DbContext, tenantId: string, taken: { debitId: string; credits: number }, messageId: string | null, why: string, actor: PmsActor): Promise<void> {
  await releaseSmsCredits(ctx, tenantId, { debitId: taken.debitId, credits: taken.credits, messageId, why }, actor);
}

/** Whether the clinic has `credits` now, without taking them (the outbox provider: nothing is sent or charged). */
export async function hasCreditsFor(ctx: DbContext, tenantId: string, credits: number): Promise<{ ok: boolean; balance: number }> {
  const acct = await getSmsCreditAccount(ctx, tenantId);
  return { ok: acct.balance >= credits, balance: acct.balance };
}

/** Sends the warning the balance calls for, once per crossing (claimed in the database first). */
export async function warnIfDue(ctx: DbContext, tenantId: string, account: SmsCreditAccount | null, deps: CreditDeps, balanceNow?: number): Promise<CreditWarning | null> {
  const acct = account ?? (await getSmsCreditAccount(ctx, tenantId));
  const state = { balance: balanceNow ?? acct.balance, lowThreshold: acct.lowThreshold, lowWarned: acct.lowWarned, zeroWarned: acct.zeroWarned };
  const due = warningDue(state);
  if (!due) return null;
  if (!(await claimCreditWarning(ctx, tenantId, due, CREDITS_SYSTEM_ACTOR))) return null;
  await notifySafely(ctx, tenantId, due === "zero" ? { kind: "zero" } : { kind: "low", balance: state.balance, lowThreshold: acct.lowThreshold }, deps);
  return due;
}

async function notifySafely(ctx: DbContext, tenantId: string, notice: CreditNotice, deps: CreditDeps): Promise<void> {
  if (!deps.notify) return;
  try {
    await deps.notify(ctx, tenantId, notice);
  } catch {
    // A warning email that fails must never stop a text or a payment (the claim and its audit row stay).
  }
}

/** "pending": charged, but recording the credit failed – the webhook (required for top-up) credits it later. */
export type TopUpResult = "not_due" | "busy" | "topped_up" | "pending" | "failed" | "unavailable";

/**
 * The automatic top-up, when the clinic has it on, a saved card, a pack, no pause, and the balance would drop
 * below its threshold: one claim per clinic at a time, the saved card charged off-session for the pack (the claim
 * token is the payment's idempotency key), the pack credited once by its payment reference. A failure: nothing
 * credited, automatic top-up paused, the owner told.
 */
export async function autoTopUpIfDue(ctx: DbContext, tenantId: string, needed: number, deps: CreditDeps): Promise<TopUpResult> {
  const acct = await getSmsCreditAccount(ctx, tenantId);
  const due = topUpDue({ autoTopup: acct.autoTopup, paused: Boolean(acct.autoTopupPausedAt), hasCard: Boolean(acct.card), pack: acct.autoTopupPack, balance: acct.balance, threshold: acct.autoTopupThreshold }, needed);
  if (!due) return "not_due";
  const payments = deps.payments ? deps.payments() : null;
  const pack = smsPack(acct.autoTopupPack);
  // Review fix 31/10/2026: no automatic top-up without the webhook (it credits a charge this request could not
  // record), and never with a customer or card saved in the other mode (a test card once live payments are on).
  if (!payments || !payments.webhookReady || !pack || !acct.card || !acct.customerRef) return "unavailable";
  if ((acct.customerMode ?? "test") !== payments.mode) return "unavailable";
  const token = `topup_${randomBytes(12).toString("base64url")}`;
  if (!(await claimTopUp(ctx, tenantId, token, CREDITS_SYSTEM_ACTOR))) return "busy";
  let outcome: Awaited<ReturnType<CardPayments["chargeSavedCard"]>>;
  try {
    outcome = await payments.chargeSavedCard({ tenantId, customerRef: acct.customerRef, methodRef: acct.card.methodRef, pack, idempotencyKey: token });
  } catch (err) {
    outcome = { ok: false, code: err instanceof CardPaymentsError ? err.code : "provider_error" };
  }
  if (outcome.ok) {
    const p = outcome.payment;
    const good = p.status === "succeeded" && p.currency === "gbp" && p.amount === pack.pricePence && (!p.customer || p.customer === acct.customerRef);
    if (good) {
      try {
        await creditSmsPack(ctx, tenantId, { kind: "auto_topup", pack: pack.key, amountPence: p.amount, paymentRef: p.id, mode: payments.mode }, CREDITS_SYSTEM_ACTOR);
      } catch {
        // Charged but not recorded (review fix 31/10/2026): never charge again for it – the claim's time blocks a
        // new attempt for TOPUP_CLAIM_MINUTES, and the payment's own webhook event (payment_intent.succeeded,
        // metadata kind sms_auto_topup) credits it once by its payment reference.
        await finishTopUp(ctx, tenantId, token, { ok: true }, CREDITS_SYSTEM_ACTOR).catch(() => undefined);
        console.warn(JSON.stringify({ event: "sms_credits.topup_credit_pending", tenantId, payment: p.id }));
        return "pending";
      }
      await finishTopUp(ctx, tenantId, token, { ok: true }, CREDITS_SYSTEM_ACTOR);
      return "topped_up";
    }
    outcome = { ok: false, code: "unexpected_payment" };
  }
  await finishTopUp(ctx, tenantId, token, { ok: false, code: outcome.code }, CREDITS_SYSTEM_ACTOR);
  await notifySafely(ctx, tenantId, { kind: "topup_failed" }, deps);
  return "failed";
}

/* ------------------------------------------------------------------------------------------------
 * Payments
 * ----------------------------------------------------------------------------------------------*/

export type FulfilResult =
  | { status: "credited"; credits: number; balance: number }
  | { status: "already" }
  | { status: "card_saved" }
  | { status: "not_paid" }
  | { status: "ignored"; why: string }
  | { status: "refused"; why: string };

/** The clinic a payment names, or why it is refused (metadata and client reference must agree). */
function tenantOf(metadata: Record<string, string>, clientReferenceId: string | null): { ok: true; tenantId: string } | { ok: false; why: string } {
  const t = metadata.tenant_id;
  if (!t) return { ok: false, why: "no_clinic" };
  try {
    assertTenantId(t);
  } catch {
    return { ok: false, why: "bad_clinic" };
  }
  if (clientReferenceId !== null && clientReferenceId !== t) return { ok: false, why: "clinic_mismatch" };
  return { ok: true, tenantId: t };
}

export interface FulfilOptions {
  /** The webhook event (its id goes on the credit's entry – a replayed event changes nothing). */
  eventId?: string | null;
  eventType?: string | null;
  /** The signed-in member's clinic (the success page): a session of another clinic is refused. */
  expectTenantId?: string | null;
  actor?: PmsActor;
}

async function seenBefore(ctx: DbContext, tenantId: string, eventId: string | null | undefined): Promise<boolean> {
  return eventId ? webhookEventApplied(ctx, tenantId, eventId) : false;
}

/**
 * A completed checkout (pack bought, or card saved). `session` must be the provider's own copy (re-read with
 * getCheckoutSession – the webhook never trusts the event body alone).
 */
export async function fulfilCheckout(ctx: DbContext, payments: CardPayments, session: CheckoutSessionInfo, opts: FulfilOptions = {}): Promise<FulfilResult> {
  const actor = opts.actor ?? CREDITS_SYSTEM_ACTOR;
  if (session.livemode !== payments.live) return { status: "refused", why: "wrong_mode" };
  const kind = session.metadata.kind;
  if (kind !== "sms_pack" && kind !== "sms_card") return { status: "ignored", why: "not_text_credits" };
  const who = tenantOf(session.metadata, session.clientReferenceId);
  if (!who.ok) return { status: "refused", why: who.why };
  const tenantId = who.tenantId;
  if (opts.expectTenantId && opts.expectTenantId !== tenantId) return { status: "refused", why: "other_clinic" };
  if (await seenBefore(ctx, tenantId, opts.eventId)) return { status: "already" };
  const acct = await getSmsCreditAccount(ctx, tenantId);
  if (!acct.customerRef || session.customer !== acct.customerRef) return { status: "refused", why: "customer_mismatch" };

  if (kind === "sms_card") {
    if (session.mode !== "setup" || session.status !== "complete") return { status: "not_paid" };
    const pm = session.setupPaymentMethod;
    if (!pm) return { status: "not_paid" };
    const saved = await saveCardIfOurs(ctx, payments, tenantId, acct.customerRef, pm, actor);
    return saved ? { status: "card_saved" } : { status: "refused", why: "card_customer_mismatch" };
  }

  const pack = smsPack(session.metadata.pack);
  if (!pack) return { status: "refused", why: "unknown_pack" };
  if (session.mode !== "payment") return { status: "refused", why: "wrong_mode" };
  if (session.paymentStatus !== "paid" || session.status !== "complete" || !session.paymentIntent) return { status: "not_paid" };
  if (session.currency !== "gbp" || session.amountTotal !== pack.pricePence) return { status: "refused", why: "amount_mismatch" };
  const r = await creditSmsPack(ctx, tenantId, { kind: "purchase", pack: pack.key, amountPence: session.amountTotal, paymentRef: session.paymentIntent, mode: payments.mode, eventRef: opts.eventId ?? null }, actor);
  if (session.metadata.save_card === "1" && session.paymentMethod) await saveCardIfOurs(ctx, payments, tenantId, acct.customerRef, session.paymentMethod, actor).catch(() => false);
  if (!r.ok) return { status: "already" };
  return { status: "credited", credits: pack.credits, balance: r.balance };
}

async function saveCardIfOurs(ctx: DbContext, payments: CardPayments, tenantId: string, customerRef: string, methodRef: string, actor: PmsActor): Promise<boolean> {
  const card = await payments.getCard(methodRef);
  if (card.customerRef !== customerRef) return false;
  return saveCreditCard(ctx, tenantId, { customerRef, methodRef: card.methodRef, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear }, actor);
}

/**
 * A payment that succeeded (payment_intent.succeeded): a pack bought through checkout or an automatic top-up –
 * whichever of this and the checkout event arrives first credits it, the other changes nothing. `pi` must be the
 * provider's own copy (re-read).
 */
export async function fulfilPaymentIntent(ctx: DbContext, payments: CardPayments, pi: PaymentIntentInfo, opts: FulfilOptions = {}): Promise<FulfilResult> {
  const actor = opts.actor ?? CREDITS_SYSTEM_ACTOR;
  if (pi.livemode !== payments.live) return { status: "refused", why: "wrong_mode" };
  const kind = pi.metadata.kind;
  if (kind !== "sms_pack" && kind !== "sms_auto_topup") return { status: "ignored", why: "not_text_credits" };
  const who = tenantOf(pi.metadata, null);
  if (!who.ok) return { status: "refused", why: who.why };
  const tenantId = who.tenantId;
  if (await seenBefore(ctx, tenantId, opts.eventId)) return { status: "already" };
  const acct = await getSmsCreditAccount(ctx, tenantId);
  if (!acct.customerRef || pi.customer !== acct.customerRef) return { status: "refused", why: "customer_mismatch" };
  const pack = smsPack(pi.metadata.pack);
  if (!pack) return { status: "refused", why: "unknown_pack" };
  if (pi.status !== "succeeded") return { status: "not_paid" };
  if (pi.currency !== "gbp" || pi.amount !== pack.pricePence) return { status: "refused", why: "amount_mismatch" };
  const r = await creditSmsPack(ctx, tenantId, { kind: kind === "sms_auto_topup" ? "auto_topup" : "purchase", pack: pack.key, amountPence: pi.amount, paymentRef: pi.id, mode: payments.mode, eventRef: opts.eventId ?? null }, actor);
  if (!r.ok) return { status: "already" };
  return { status: "credited", credits: pack.credits, balance: r.balance };
}
