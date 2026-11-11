/**
 * Gift cards (PK04, migrations 0234–0235): `pms_gift_cards` and the append-only `pms_gift_card_moves` (sale, redeem,
 * refund, expire, adjust – each with the balance after it, never below zero). Rules: src/modules/pms/billing/gift-cards.ts.
 *
 * - Made with the draft invoice that sells it (status pending, in the draft's batch – createDraftInvoice's `extra`),
 *   so the code can be handed over; activated in the ISSUE batch (sold = issued, a "sale" move); a cancelled draft
 *   cancels it; crediting the sale line in full cancels an unspent card (a spent one cannot be credited).
 * - The code is never stored readable: SHA-256 of "<clinic>:<code>" + its last 4 characters.
 * - Spending is a payment of method "other" (the payments table's method CHECK cannot change without rebuilding it on
 *   SQLite) with the card in its reference; the card's balance drops in the payment's own batch, optimistically on the
 *   balance read (a concurrent spend refuses the batch: the move's card id is NULL unless the card holds the expected
 *   balance). Reversing the payment puts the amount back ("refund" move) in the reversal's batch.
 *
 * Before the migrations every read answers "no gift cards" (readOrEmpty) and no gift-card statement is added to an
 * invoice's or payment's batch unless it has gift-card rows.
 */
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { formatGiftCardCode, giftCardExpiry, type GiftCard, type GiftCardMove, type GiftCardMoveKind, type GiftCardStatus } from "../../../../modules/pms/billing/gift-cards";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, num, numOrNull, pmsAuditQuery, pmsId, type RepoContext } from "../context";
import { readOrEmpty } from "./healthcode";
import { ensureSettingsQuery } from "./settings";
import { chunks, todayOf } from "./shared";

export const CARDS = "pms_gift_cards";
export const MOVES = "pms_gift_card_moves";
export const GIFT_CARD_PREFIX = P.giftCard;
export const GIFT_CARD_MOVE_PREFIX = P.giftCardMove;

/** SHA-256 of "<clinic>:<code>" (hex): the same code in two clinics never collides or links them. */
export function giftCardCodeHash(tenantId: string, code: string): string {
  return createHash("sha256").update(`${tenantId}:${code}`).digest("hex");
}

/** A new random code. */
export function newGiftCardCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return formatGiftCardCode(bytes);
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function toCard(ctx: RepoContext, r: Record<string, unknown>, decrypt: boolean): GiftCard {
  const id = String(r.id);
  return {
    id,
    rev: num(r.rev),
    codeLast4: String(r.code_last4),
    initialPence: num(r.initial_pence),
    balancePence: num(r.balance_pence),
    soldOn: (r.sold_on as string | null) ?? null,
    expiresOn: (r.expires_on as string | null) ?? null,
    saleInvoiceId: (r.sale_invoice_id as string | null) ?? null,
    saleLineId: (r.sale_line_id as string | null) ?? null,
    buyerPatientId: (r.buyer_patient_id as string | null) ?? null,
    recipientName: decrypt ? decryptField(ctx, String(r.tenant_id), CARDS, "recipient_name_enc", id, (r.recipient_name_enc as string | null) ?? null) : null,
    status: String(r.status) as GiftCardStatus,
    createdAt: iso(r.created_at),
  };
}

/* ------------------------------------------------------------------------------------------------
 * The sale (with the draft invoice) and the start (with its issue)
 * ----------------------------------------------------------------------------------------------*/

export interface NewGiftCard {
  id: string;
  /** Shown ONCE to the member selling it. */
  code: string;
  amountPence: number;
}

/** A pending card for a draft's sale line: its id and code, and the statements for the draft's batch (createDraftInvoice's `extra`). */
export function giftCardDraftQueries(
  ctx: RepoContext,
  tenantId: string,
  v: { amountPence: number; buyerPatientId: string | null; recipientName: string | null },
  actor: PmsActor,
): { card: NewGiftCard; queries: (lines: { id: string }[], invoiceId: string, at: string) => BatchQuery[] } {
  const id = pmsId(GIFT_CARD_PREFIX, ctx);
  const code = newGiftCardCode();
  return {
    card: { id, code, amountPence: v.amountPence },
    queries: (lines, invoiceId, at) => [
      // Cards hang off the clinic's billing settings row (offboarding deletes them with it).
      ensureSettingsQuery(ctx, tenantId, at),
      ctx.db.insertInto(CARDS).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        code_sha256: giftCardCodeHash(tenantId, code),
        code_last4: code.slice(-4),
        initial_pence: v.amountPence,
        balance_pence: 0,
        sold_on: null,
        expires_on: null,
        sale_invoice_id: invoiceId,
        sale_line_id: lines[0].id,
        buyer_patient_id: v.buyerPatientId,
        recipient_name_enc: encryptField(ctx, tenantId, CARDS, "recipient_name_enc", id, v.recipientName),
        status: "pending",
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.gift_card.sell", targetType: "pms_gift_card", targetId: id, detail: { invoiceId, amountPence: v.amountPence } }),
    ],
  };
}

async function cardsOnLines(ctx: RepoContext, tenantId: string, lineIds: string[]): Promise<GiftCard[]> {
  return readOrEmpty(CARDS, [] as GiftCard[], async () => {
    const out: GiftCard[] = [];
    for (const group of chunks(lineIds)) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(CARDS).selectAll().where("tenant_id", "=", tenantId).where("sale_line_id", "in", group).execute();
      out.push(...rows.map((r) => toCard(ctx, r as unknown as Record<string, unknown>, false)));
    }
    return out;
  });
}

/**
 * For the ISSUE batch: the invoice's pending cards become active with their value, sale date and expiry, and a
 * "sale" move – whose card id is read in the statement (NULL, the whole issue refused, unless this issue applied).
 */
export async function giftCardStartQueries(ctx: RepoContext, tenantId: string, inv: { id: string; lines: { id: string }[] }, issuedOn: string, token: string, actor: PmsActor, at: string): Promise<BatchQuery[]> {
  const cards = (
    await cardsOnLines(
      ctx,
      tenantId,
      inv.lines.map((l) => l.id),
    )
  ).filter((c) => c.status === "pending");
  const queries: BatchQuery[] = [];
  const issuedNow = sql<boolean>`exists (select 1 from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and edit_token = ${token} and status = 'issued')`;
  for (const c of cards) {
    queries.push(
      ctx.db
        .updateTable(CARDS)
        .set((eb) => ({ status: "active", balance_pence: eb.ref("initial_pence"), sold_on: issuedOn, expires_on: giftCardExpiry(issuedOn), rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", c.id)
        .where("status", "=", "pending")
        .where(issuedNow),
      ctx.db.insertInto(MOVES).values({
        tenant_id: tenantId,
        id: pmsId(GIFT_CARD_MOVE_PREFIX, ctx),
        gift_card_id: sql<string>`(select id from pms_gift_cards where tenant_id = ${tenantId} and id = ${c.id} and status = 'active' and sold_on = ${issuedOn} and updated_at = ${at})`,
        kind: "sale",
        amount_pence: c.initialPence,
        payment_id: null,
        balance_after: c.initialPence,
        created_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.gift_card.start", targetType: "pms_gift_card", targetId: c.id, detail: { invoiceId: inv.id, amountPence: c.initialPence } }),
    );
  }
  return queries;
}

/** For cancelDraftInvoice's batch: the drafts' pending cards are cancelled with them (the code then spends nothing). */
export async function giftCardCancelDraftQueries(ctx: RepoContext, tenantId: string, invoiceIds: string[], at: string): Promise<BatchQuery[]> {
  const pending = await readOrEmpty(CARDS, [] as { id: string; sale_invoice_id: string | null }[], async () => {
    if (invoiceIds.length === 0) return [];
    return ctx.db.selectFrom(CARDS).select(["id", "sale_invoice_id"]).where("tenant_id", "=", tenantId).where("sale_invoice_id", "in", invoiceIds).where("status", "=", "pending").execute();
  });
  return pending.map((c) =>
    ctx.db
      .updateTable(CARDS)
      .set((eb) => ({ status: "cancelled", rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", c.id)
      .where("status", "=", "pending")
      .where(sql<boolean>`exists (select 1 from pms_invoices where tenant_id = ${tenantId} and id = ${c.sale_invoice_id} and status = 'cancelled')`),
  );
}

/**
 * For a credit note: a card sold on a credited line must be credited in full and unspent; the card is then cancelled
 * (its balance to 0, an "adjust" move). Throws a plain refusal otherwise. [] when no line sold a card.
 */
export async function giftCardCreditQueries(ctx: RepoContext, tenantId: string, parts: { lineId: string; creditPence: number; lineLeftPence: number }[], actor: PmsActor, at: string): Promise<BatchQuery[]> {
  const cards = await cardsOnLines(
    ctx,
    tenantId,
    parts.map((p) => p.lineId),
  );
  const queries: BatchQuery[] = [];
  for (const c of cards) {
    if (c.status === "cancelled") continue;
    const part = parts.find((p) => p.lineId === c.saleLineId);
    if (!part) continue;
    if (c.balancePence < c.initialPence && c.status !== "pending") throw new RepoInputError("This gift card has been spent from, so its sale cannot be credited. Credit what it paid for instead.");
    if (part.creditPence < part.lineLeftPence) throw new RepoInputError("A gift card's sale is credited in full or not at all.");
    queries.push(
      ctx.db
        .updateTable(CARDS)
        .set((eb) => ({ status: "cancelled", balance_pence: 0, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", c.id)
        .where("balance_pence", "=", c.balancePence)
        .where("status", "=", c.status),
      ctx.db.insertInto(MOVES).values({
        tenant_id: tenantId,
        id: pmsId(GIFT_CARD_MOVE_PREFIX, ctx),
        gift_card_id: sql<string>`(select id from pms_gift_cards where tenant_id = ${tenantId} and id = ${c.id} and status = 'cancelled' and updated_at = ${at})`,
        kind: "adjust",
        amount_pence: -c.balancePence,
        payment_id: null,
        balance_after: 0,
        created_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.gift_card.cancel", targetType: "pms_gift_card", targetId: c.id, detail: { balancePence: c.balancePence } }),
    );
  }
  return queries;
}

/* ------------------------------------------------------------------------------------------------
 * Spending (a payment) and putting it back (its reversal)
 * ----------------------------------------------------------------------------------------------*/

/** The card a typed code belongs to, in this clinic (null: no such card). */
export async function findGiftCardByCode(ctx: RepoContext, tenantId: string, code: string): Promise<GiftCard | null> {
  assertTenantId(tenantId);
  return readOrEmpty(CARDS, null as GiftCard | null, async () => {
    const r = await ctx.db.selectFrom(CARDS).selectAll().where("tenant_id", "=", tenantId).where("code_sha256", "=", giftCardCodeHash(tenantId, code)).executeTakeFirst();
    return r ? toCard(ctx, r as unknown as Record<string, unknown>, false) : null;
  });
}

/** Why a card cannot pay `amount` today, or null when it can. */
export function giftCardRefusal(c: GiftCard, amountPence: number, today: string): string | null {
  if (c.status === "pending") return "This gift card's invoice has not been issued yet.";
  if (c.status === "cancelled") return "This gift card has been cancelled.";
  if (c.status === "expired" || (c.expiresOn !== null && c.expiresOn < today)) return "This gift card has expired.";
  if (c.balancePence <= 0) return "Nothing is left on this gift card.";
  if (amountPence > c.balancePence) return `Only £${(c.balancePence / 100).toFixed(2)} is left on this gift card.`;
  return null;
}

/** For the payment's batch: the card's balance drops by the amount (optimistic on the balance read) + a "redeem" move. */
export function giftCardRedeemQueries(ctx: RepoContext, tenantId: string, c: GiftCard, amountPence: number, paymentId: string, actor: PmsActor, at: string): BatchQuery[] {
  const after = c.balancePence - amountPence;
  if (after < 0) throw new RepoInputError("More than is left on the gift card.");
  return [
    ctx.db
      .updateTable(CARDS)
      .set((eb) => ({ balance_pence: after, status: after === 0 ? "used" : "active", rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", c.id)
      .where("status", "=", "active")
      .where("balance_pence", "=", c.balancePence),
    ctx.db.insertInto(MOVES).values({
      tenant_id: tenantId,
      id: pmsId(GIFT_CARD_MOVE_PREFIX, ctx),
      // NULL (refused) unless THIS spend changed the card (someone else's spend meanwhile → try again).
      gift_card_id: sql<string>`(select id from pms_gift_cards where tenant_id = ${tenantId} and id = ${c.id} and balance_pence = ${after} and updated_at = ${at})`,
      kind: "redeem",
      amount_pence: -amountPence,
      payment_id: paymentId,
      balance_after: after,
      created_by: actor.userId,
      created_at: at,
    }),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.gift_card.redeem", targetType: "pms_gift_card", targetId: c.id, detail: { paymentId, amountPence } }),
  ];
}

/** For a payment's reversal batch: what the payment took off a card goes back ("refund" move). [] when it used none. */
export async function giftCardRestoreQueries(ctx: RepoContext, tenantId: string, paymentId: string, actor: PmsActor, at: string): Promise<BatchQuery[]> {
  const moves = await readOrEmpty(MOVES, [] as { gift_card_id: string; amount_pence: unknown }[], () =>
    ctx.db.selectFrom(MOVES).select(["gift_card_id", "amount_pence"]).where("tenant_id", "=", tenantId).where("payment_id", "=", paymentId).execute(),
  );
  const spent = new Map<string, number>();
  for (const m of moves) spent.set(m.gift_card_id, (spent.get(m.gift_card_id) ?? 0) - num(m.amount_pence));
  const queries: BatchQuery[] = [];
  const reversedNow = sql<boolean>`exists (select 1 from pms_payments where tenant_id = ${tenantId} and id = ${paymentId} and status = 'reversed' and reversed_at = ${at})`;
  for (const [cardId, amount] of Array.from(spent.entries())) {
    if (amount <= 0) continue;
    const card = await ctx.db.selectFrom(CARDS).select(["balance_pence", "status"]).where("tenant_id", "=", tenantId).where("id", "=", cardId).executeTakeFirst();
    if (!card || card.status === "cancelled") continue;
    const after = num(card.balance_pence) + amount;
    queries.push(
      ctx.db
        .updateTable(CARDS)
        .set((eb) => ({ balance_pence: after, status: card.status === "used" ? "active" : card.status, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", cardId)
        .where("balance_pence", "=", num(card.balance_pence))
        .where(reversedNow),
      ctx.db.insertInto(MOVES).values({
        tenant_id: tenantId,
        id: pmsId(GIFT_CARD_MOVE_PREFIX, ctx),
        // NULL (refused) unless the card got the amount back in this batch.
        gift_card_id: sql<string>`(select id from pms_gift_cards where tenant_id = ${tenantId} and id = ${cardId} and balance_pence = ${after} and updated_at = ${at})`,
        kind: "refund",
        amount_pence: amount,
        payment_id: paymentId,
        balance_after: after,
        created_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.gift_card.refund", targetType: "pms_gift_card", targetId: cardId, detail: { paymentId, amountPence: amount } }),
    );
  }
  return queries;
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------------------------------*/

export async function getGiftCard(ctx: RepoContext, tenantId: string, id: string): Promise<GiftCard | null> {
  assertTenantId(tenantId);
  assertId(id, "gift card id");
  return readOrEmpty(CARDS, null as GiftCard | null, async () => {
    const r = await ctx.db.selectFrom(CARDS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return r ? toCard(ctx, r as unknown as Record<string, unknown>, true) : null;
  });
}

/** The clinic's cards, newest first (or one buyer's). Never decrypted. */
export async function listGiftCards(ctx: RepoContext, tenantId: string, options: { buyerPatientId?: string; limit?: number } = {}): Promise<GiftCard[]> {
  assertTenantId(tenantId);
  return readOrEmpty(CARDS, [] as GiftCard[], async () => {
    let q = ctx.db.selectFrom(CARDS).selectAll().where("tenant_id", "=", tenantId);
    if (options.buyerPatientId) q = q.where("buyer_patient_id", "=", options.buyerPatientId);
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.min(500, Math.max(1, options.limit ?? 200)))
      .execute();
    return rows.map((r) => toCard(ctx, r as unknown as Record<string, unknown>, false));
  });
}

export async function listGiftCardMoves(ctx: RepoContext, tenantId: string, cardId: string): Promise<GiftCardMove[]> {
  assertTenantId(tenantId);
  return readOrEmpty(MOVES, [] as GiftCardMove[], async () => {
    const rows = await ctx.db.selectFrom(MOVES).selectAll().where("tenant_id", "=", tenantId).where("gift_card_id", "=", cardId).orderBy("created_at").orderBy("id").limit(500).execute();
    return rows.map((r) => ({ id: r.id, kind: r.kind as GiftCardMoveKind, amountPence: num(r.amount_pence), balanceAfter: num(r.balance_after), paymentId: r.payment_id, createdAt: iso(r.created_at) }));
  });
}

/** What active, unexpired cards still hold (the clinic's liability), in pence. */
export async function giftCardsOutstanding(ctx: RepoContext, tenantId: string): Promise<number> {
  assertTenantId(tenantId);
  const today = todayOf(ctx);
  return readOrEmpty(CARDS, 0, async () => {
    const r = await ctx.db
      .selectFrom(CARDS)
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>("balance_pence"), sql<number>`0`).as("n"))
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "active")
      .where((eb) => eb.or([eb("expires_on", "is", null), eb("expires_on", ">=", today)]))
      .executeTakeFirst();
    return numOrNull(r?.n) ?? 0;
  });
}
