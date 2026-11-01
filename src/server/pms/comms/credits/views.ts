/**
 * Text credits – the server side of the Text credits page (Messages → Text credits) and its actions.
 *
 * Who: everyone with messages.send SEES the balance and the history; only the clinic's OWNER and ADMINS buy packs,
 * save or remove the card and change automatic top-up (a fixed rule – spending the clinic's money is not a
 * configurable permission). Every id comes from the member's own clinic (actor.tenantId); nothing from the request.
 */
import "server-only";
import { CREDIT_ENTRY_LABELS, SMS_PACKS, creditsText, pencePerCredit, smsPack, type CreditEntryView, type SmsPackKey, type TextCreditsView } from "../../../../modules/pms/comms/credits";
import { formatPence } from "../../../../modules/pms/core/text";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { getSmsCreditAccount, listSmsCreditEntries, removeCreditCard, saveAutoTopup, type SmsCreditEntry } from "../../../repos/pms/comms/credits";
import { RepoInputError, pmsAuditQuery, writeWithAudit, type RepoContext } from "../../../repos/pms/context";
import { providerStatus } from "../providers";
import { cardPaymentsConfig, createCardPayments, CardPaymentsError, type CardPayments } from "./card-payments";
import { clinicCustomerRef } from "./customer";
import { CREDITS_PAGE_PATH } from "./notify";
import { fulfilCheckout, type FulfilResult } from "./service";

export interface CreditsActor {
  tenantId: string;
  clinicName: string;
  role: string;
  can: (permission: "messages.send") => boolean;
  actor: PmsActor;
  repo: () => RepoContext;
}

export type CreditsResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MANAGE_ONLY = "Only the clinic's owner and admins can buy text credits or change automatic top-up.";
export const PAYMENTS_OFF = "Card payments for text credits are not set up yet.";

export function canManageCredits(actor: Pick<CreditsActor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** The card payment service from env, or why it is off. TESTS pass their own. */
export function cardPaymentsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): { ok: true; payments: CardPayments } | { ok: false; reason: string } {
  const c = cardPaymentsConfig(env);
  return c.ok ? { ok: true, payments: createCardPayments(c.config) } : { ok: false, reason: c.reason };
}

const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function entryView(e: SmsCreditEntry): CreditEntryView {
  const pack = smsPack(e.pack);
  const note =
    e.kind === "purchase" || e.kind === "auto_topup"
      ? `${pack ? `${pack.credits.toLocaleString("en-GB")}-credit pack` : "Pack"}${e.amountPence !== null ? ` · ${formatPence(e.amountPence)}` : ""}`
      : e.kind === "adjustment"
        ? e.reason
        : null;
  return { id: e.id, at: UK.format(new Date(e.createdAt)).replace(",", ""), kind: e.kind, label: CREDIT_ENTRY_LABELS[e.kind], credits: e.credits, balanceAfter: e.balanceAfter, note };
}

export function packViews() {
  return SMS_PACKS.map((p) => ({ key: p.key, credits: p.credits, price: formatPence(p.pricePence), perText: `${pencePerCredit(p).toLocaleString("en-GB")}p a text` }));
}

export async function textCreditsFor(actor: CreditsActor, env: Readonly<Record<string, string | undefined>> = process.env): Promise<CreditsResult<TextCreditsView>> {
  if (!actor.can("messages.send")) return { ok: false, error: "You do not have permission to see text credits." };
  const ctx = actor.repo();
  const [acct, entries] = await Promise.all([getSmsCreditAccount(ctx, actor.tenantId), listSmsCreditEntries(ctx, actor.tenantId, { limit: 100 })]);
  const config = cardPaymentsConfig(env);
  return {
    ok: true,
    value: {
      clinicName: actor.clinicName,
      balance: acct.balance,
      lowThreshold: acct.lowThreshold,
      canManage: canManageCredits(actor),
      paymentsReady: config.ok,
      paymentsUnavailable: config.ok ? null : config.reason,
      smsMode: providerStatus(env).sms,
      packs: packViews(),
      autoTopup: { enabled: acct.autoTopup, threshold: acct.autoTopupThreshold, pack: acct.autoTopupPack, paused: Boolean(acct.autoTopupPausedAt), failure: acct.autoTopupFailure },
      card: acct.card ? { brand: acct.card.brand, last4: acct.card.last4, expires: `${String(acct.card.expMonth).padStart(2, "0")}/${String(acct.card.expYear).slice(-2)}` } : null,
      entries: entries.map(entryView),
    },
  };
}

/** The balance in a few words for the Messages page (everyone with messages.send). */
export async function creditBalanceFor(actor: Pick<CreditsActor, "tenantId" | "repo">): Promise<{ balance: number; low: boolean }> {
  const acct = await getSmsCreditAccount(actor.repo(), actor.tenantId);
  return { balance: acct.balance, low: acct.balance <= acct.lowThreshold };
}

async function customerFor(actor: CreditsActor, payments: CardPayments): Promise<string> {
  return clinicCustomerRef(actor.repo(), { tenantId: actor.tenantId, clinicName: actor.clinicName }, payments, actor.actor);
}

const returnUrls = (origin: string) => ({
  successUrl: `${origin}${CREDITS_PAGE_PATH}/done?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${origin}${CREDITS_PAGE_PATH}/cancelled`,
});

async function audited(actor: CreditsActor, detail: Record<string, unknown>): Promise<void> {
  const ctx = actor.repo();
  await writeWithAudit(ctx, [pmsAuditQuery(ctx, actor.tenantId, actor.actor, { action: "pms.sms_credit.checkout", targetType: "pms_sms_credit_account", targetId: actor.tenantId, detail })]);
}

/** A pack's card payment page (owner / admin): the URL to send the browser to. */
export async function startPackCheckout(actor: CreditsActor, input: { pack: string; saveCard: boolean; origin: string; idempotencyKey: string }, payments: CardPayments | null): Promise<CreditsResult<{ url: string }>> {
  if (!actor.can("messages.send") || !canManageCredits(actor)) return { ok: false, error: MANAGE_ONLY };
  const pack = smsPack(input.pack);
  if (!pack) return { ok: false, error: "Choose one of the packs." };
  if (!payments) return { ok: false, error: PAYMENTS_OFF };
  try {
    const prices = await payments.packPrices();
    const priceId = prices.get(pack.key as SmsPackKey);
    if (!priceId) return { ok: false, error: "That pack is not on sale at the moment. Try again later." };
    const customerRef = await customerFor(actor, payments);
    const s = await payments.createPackCheckout({ tenantId: actor.tenantId, customerRef, pack, priceId, saveCard: input.saveCard, idempotencyKey: input.idempotencyKey, ...returnUrls(input.origin) });
    if (!s.url || !/^https:\/\//.test(s.url)) return { ok: false, error: "The card payment page could not be opened. Try again." };
    await audited(actor, { pack: pack.key, credits: pack.credits, session: s.id, saveCard: input.saveCard });
    return { ok: true, value: { url: s.url } };
  } catch (err) {
    return { ok: false, error: err instanceof CardPaymentsError ? "The card payment service could not be reached. Try again." : "The card payment page could not be opened. Try again." };
  }
}

/** Saving a card for automatic top-up (owner / admin): the card payment page in "save a card" mode. */
export async function startCardSetup(actor: CreditsActor, input: { origin: string; idempotencyKey: string }, payments: CardPayments | null): Promise<CreditsResult<{ url: string }>> {
  if (!actor.can("messages.send") || !canManageCredits(actor)) return { ok: false, error: MANAGE_ONLY };
  if (!payments) return { ok: false, error: PAYMENTS_OFF };
  try {
    const customerRef = await customerFor(actor, payments);
    const s = await payments.createCardCheckout({ tenantId: actor.tenantId, customerRef, idempotencyKey: input.idempotencyKey, ...returnUrls(input.origin) });
    if (!s.url || !/^https:\/\//.test(s.url)) return { ok: false, error: "The card payment page could not be opened. Try again." };
    await audited(actor, { saveCard: true, session: s.id });
    return { ok: true, value: { url: s.url } };
  } catch {
    return { ok: false, error: "The card payment service could not be reached. Try again." };
  }
}

/** Back from the card payment page: re-read the checkout and credit it (idempotent with the webhook). */
export async function completeCheckoutFor(actor: CreditsActor, sessionId: string, payments: CardPayments | null): Promise<FulfilResult | { status: "unavailable" }> {
  if (!payments || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return { status: "unavailable" };
  try {
    const s = await payments.getCheckoutSession(sessionId);
    return await fulfilCheckout(actor.repo(), payments, s, { expectTenantId: actor.tenantId, actor: actor.actor });
  } catch {
    return { status: "unavailable" };
  }
}

export const TOPUP_NEEDS_WEBHOOK = "Automatic top-up is not available yet: card payment confirmations are not set up on this system.";

export async function saveAutoTopupFor(
  actor: CreditsActor,
  input: { enabled: boolean; threshold: number; pack: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CreditsResult<{ message: string }>> {
  if (!actor.can("messages.send") || !canManageCredits(actor)) return { ok: false, error: MANAGE_ONLY };
  if (input.enabled) {
    // Review fix 31/10/2026: automatic top-up only with the webhook's signing secret set (it credits a charge the
    // sending request could not record) and only while card payments are on.
    const c = cardPaymentsConfig(env);
    if (!c.ok) return { ok: false, error: PAYMENTS_OFF };
    if (!c.config.webhookSecret) return { ok: false, error: TOPUP_NEEDS_WEBHOOK };
  }
  try {
    const a = await saveAutoTopup(actor.repo(), actor.tenantId, { enabled: input.enabled, threshold: input.threshold, pack: input.pack as SmsPackKey }, actor.actor);
    const pack = smsPack(a.autoTopupPack);
    return {
      ok: true,
      value: { message: a.autoTopup && pack ? `Automatic top-up is on: ${creditsText(pack.credits)} when the balance drops below ${a.autoTopupThreshold.toLocaleString("en-GB")}.` : "Automatic top-up is off." },
    };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message.replace(/^Automatic top-up: [a-zA-Z.]+: /, "") : "The setting could not be saved. Try again." };
  }
}

export async function removeCardFor(actor: CreditsActor): Promise<CreditsResult<{ message: string }>> {
  if (!actor.can("messages.send") || !canManageCredits(actor)) return { ok: false, error: MANAGE_ONLY };
  await removeCreditCard(actor.repo(), actor.tenantId, actor.actor);
  return { ok: true, value: { message: "The card was removed and automatic top-up is off." } };
}
