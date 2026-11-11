/**
 * Gift cards for the screens (PK04). Same rules as the other billing services (./access.ts): the permission first,
 * ids read back from the member's clinic and site scope, plain results. The code is returned ONCE, by the sale.
 *
 *   Billing → Gift cards (list, look up by code, a card's history)   billing.view
 *   sell a gift card (patient record → Invoices)                       billing.edit
 *   spend one                                                          billing.pay (Take payment → Gift card, ./writes.ts)
 */
import "server-only";
import {
  GIFT_CARD_MOVE_LABELS,
  GIFT_CARD_STATE_LABELS,
  SellGiftCardInputSchema,
  giftCardBalanceLabel,
  giftCardSaleLine,
  giftCardState,
  maskedCode,
  normaliseGiftCardCode,
  type GiftCard,
  type GiftCardDetailView,
  type GiftCardRowView,
  type GiftCardsScreen,
} from "../../../modules/pms/billing/gift-cards";
import { ukToday } from "../../../modules/pms/core/text";
import { pmsNow } from "../../../modules/pms/core/clock";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import type { RepoContext } from "../../repos/context";
import { createDraftInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { findGiftCardByCode, getGiftCard, giftCardDraftQueries, giftCardsOutstanding, listGiftCardMoves, listGiftCards } from "../../repos/pms/billing/gift-cards";
import { getPatientSummaries } from "../../repos/pms/patients";
import { patientVisibleInScope } from "../access";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, type BillingActor, type Result } from "./access";
import { nameOf } from "./views";

const todayOf = (ctx: RepoContext) => ukToday(ctx.now ? ctx.now() : pmsNow());

async function visible(actor: BillingActor, c: GiftCard): Promise<boolean> {
  const scope = actor.siteIds ?? null;
  if (scope === null) return true;
  if (!c.buyerPatientId) return false;
  return patientVisibleInScope(actor.repo(), actor.tenantId, c.buyerPatientId, scope);
}

function row(c: GiftCard, today: string, names: Map<string, { firstName: string; lastName: string; preferredName: string | null }>): GiftCardRowView {
  const state = giftCardState(c, today);
  const p = c.buyerPatientId ? names.get(c.buyerPatientId) : undefined;
  return {
    id: c.id,
    masked: maskedCode(c.codeLast4),
    state,
    stateLabel: GIFT_CARD_STATE_LABELS[state],
    balance: giftCardBalanceLabel(c),
    balancePence: c.balancePence,
    initialPence: c.initialPence,
    soldOn: c.soldOn,
    expiresOn: c.expiresOn,
    buyerName: p ? nameOf(p) : null,
    buyerPatientId: c.buyerPatientId,
    saleInvoiceId: c.saleInvoiceId,
  };
}

export type { GiftCardsScreen };

/** Billing → Gift cards: the latest cards, what they still hold, and one card (by id, or looked up by its code). */
export async function giftCardsFor(actor: BillingActor, options: { cardId?: string | null; code?: string | null } = {}): Promise<Result<GiftCardsScreen>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.gift_cards", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const today = todayOf(ctx);
    const all = await listGiftCards(ctx, t, { limit: 200 });
    const cards: GiftCard[] = [];
    for (const c of all) if (await visible(actor, c)) cards.push(c);
    let one: GiftCard | null = null;
    let lookupError: string | null = null;
    if (options.code) {
      const code = normaliseGiftCardCode(options.code);
      one = code ? await findGiftCardByCode(ctx, t, code) : null;
      if (one && !(await visible(actor, one))) one = null;
      if (!one) lookupError = "No gift card has that code in this clinic.";
    } else if (options.cardId && isPlausibleRecordId(options.cardId)) {
      one = await getGiftCard(ctx, t, options.cardId);
      if (one && !(await visible(actor, one))) one = null;
    }
    const ids = [...cards, ...(one ? [one] : [])].map((c) => c.buyerPatientId).filter((x): x is string => typeof x === "string");
    const names = await getPatientSummaries(ctx, t, Array.from(new Set(ids)));
    let card: GiftCardDetailView | null = null;
    if (one) {
      const full = (await getGiftCard(ctx, t, one.id)) as GiftCard;
      const moves = await listGiftCardMoves(ctx, t, one.id);
      card = { ...row(full, today, names), recipientName: full.recipientName, moves: moves.map((m) => ({ ...m, label: GIFT_CARD_MOVE_LABELS[m.kind] })) };
    }
    return ok({ rows: cards.map((c) => row(c, today, names)), outstandingPence: await giftCardsOutstanding(ctx, t), card, lookupError });
  });
}

export interface SellGiftCardFields {
  amountPence: number;
  recipientName?: string | null;
  siteId?: string | null;
  /** Issue the invoice at once (the card can then be spent). */
  issue?: boolean;
}

/**
 * Sells a gift card to a patient: a draft invoice with the card's line (no VAT), the card made with it (pending) –
 * issued too when asked. Returns the CODE once: it is never shown again.
 */
export async function sellGiftCardFor(actor: BillingActor, patientId: string, f: SellGiftCardFields): Promise<Result<{ code: string; giftCardId: string; invoiceId: string; number: string | null; issued: boolean; expiresOn: string | null }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  const parsed = SellGiftCardInputSchema.safeParse({ amountPence: f.amountPence, recipientName: f.recipientName ?? null });
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the amount.");
  return attempt("billing.sell_gift_card", async (): Promise<Result<{ code: string; giftCardId: string; invoiceId: string; number: string | null; issued: boolean; expiresOn: string | null }>> => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const scope = actor.siteIds ?? null;
    let siteId: string | null = f.siteId && isPlausibleRecordId(f.siteId) ? f.siteId : null;
    if (siteId === null && scope !== null && scope.size === 1) siteId = Array.from(scope)[0];
    if (siteId !== null && scope !== null && !scope.has(siteId)) return fail("invalid", "Choose one of your sites.");
    if (siteId === null && scope !== null) return fail("invalid", "Choose the site the gift card is sold at.");
    const recipient = parsed.data.recipientName ? parsed.data.recipientName : null;
    const made = giftCardDraftQueries(ctx, t, { amountPence: parsed.data.amountPence, buyerPatientId: patient.id, recipientName: recipient }, actor.actor);
    const { invoice } = await createDraftInvoice(ctx, t, { patientId: patient.id, siteId, billTo: "patient", lines: [giftCardSaleLine(parsed.data.amountPence)] }, actor.actor, {
      lineRefs: [{ lineIndex: 0, refType: "gift_card", refId: made.card.id }],
      extra: made.queries,
    });
    let number: string | null = null;
    let issued = false;
    if (f.issue) {
      const r = await issueInvoice(ctx, t, invoice.id, invoice.rev, {}, actor.actor);
      if (!r.ok) return fail("invalid", "The invoice could not be issued. It is kept as a draft: issue it from the invoice page before the card is spent.");
      number = r.invoice.number;
      issued = true;
    }
    const card = await getGiftCard(ctx, t, made.card.id);
    return ok({ code: made.card.code, giftCardId: made.card.id, invoiceId: invoice.id, number, issued, expiresOn: card?.expiresOn ?? null });
  });
}

/** A patient's gift cards (bought by them), for their Invoices tab. */
export async function patientGiftCardsFor(actor: BillingActor, patientId: string): Promise<Result<{ rows: GiftCardRowView[]; canSell: boolean }>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.patient_gift_cards", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const cards = await listGiftCards(ctx, actor.tenantId, { buyerPatientId: patient.id, limit: 50 });
    const names = await getPatientSummaries(ctx, actor.tenantId, [patient.id]);
    const today = todayOf(ctx);
    return ok({ rows: cards.map((c) => row(c, today, names)), canSell: actor.can("billing.edit") });
  });
}
