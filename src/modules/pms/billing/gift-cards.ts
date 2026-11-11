/**
 * Gift cards (PK04, docs/clinic-system/courses-giftcards-products.md). Pure, browser-safe: the code format, inputs,
 * labels and the screens' types.
 *
 * - Sold on an ordinary `item` line of an invoice to the buyer (a patient), referenced by pms_invoice_line_refs
 *   (ref_id = the card). The card is made with the draft (status pending) so its code can be handed over; it can be
 *   spent once that invoice is ISSUED (sold = issued).
 * - The code is a bearer value: 12 characters without look-alikes, shown ONCE when the card is made, stored only as
 *   SHA-256 (per clinic) and its last 4 characters.
 * - No VAT at sale (a multi-purpose voucher): VAT is charged on what it is spent on, as usual.
 * - Spent with Take payment → Gift card: a payment of method `gift_card` whose reference is the card; the balance drops
 *   by the amount in the same batch (never below zero). Reversing that payment puts the amount back.
 * - Expires 24 months after the sale by default (the date is printed for the buyer).
 */
import { z } from "zod";
import { formatPence, formatUkDate } from "../core/text";

export const GIFT_CARD_STATUSES = ["pending", "active", "used", "expired", "cancelled"] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

export const GIFT_CARD_MOVE_KINDS = ["sale", "redeem", "refund", "expire", "adjust"] as const;
export type GiftCardMoveKind = (typeof GIFT_CARD_MOVE_KINDS)[number];

/** No 0/O, 1/I/L, 5/S or 8/B. */
export const GIFT_CARD_ALPHABET = "ACDEFGHJKMNPQRTUVWXYZ234679";
export const GIFT_CARD_DEFAULT_MONTHS = 24;
export const GIFT_CARD_MAX_PENCE = 100_000;

/** "CD7K-M4Q9-X2HP" from 12 random characters (the caller supplies the random bytes). */
export function formatGiftCardCode(random: Uint8Array): string {
  if (random.length < 12) throw new Error("12 random bytes needed");
  let s = "";
  for (let i = 0; i < 12; i++) s += GIFT_CARD_ALPHABET[random[i] % GIFT_CARD_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** A code as typed (any case, spaces or dashes) → "XXXX-XXXX-XXXX", or null when it cannot be a code. */
export function normaliseGiftCardCode(typed: string): string | null {
  const s = String(typed ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (s.length !== 12) return null;
  for (const ch of s) if (!GIFT_CARD_ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** "•••• •••• X2HP" – how a card is shown everywhere after it is made. */
export function maskedCode(last4: string): string {
  return `•••• •••• ${last4}`;
}

/** The expiry: N months after the sale, the day before (24 months from 02/11/2026 → 01/11/2028). */
export function giftCardExpiry(soldOn: string, months = GIFT_CARD_DEFAULT_MONTHS): string {
  const [y, m, d] = soldOn.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return new Date(Date.UTC(ty, tm, day - 1)).toISOString().slice(0, 10);
}

export interface GiftCard {
  id: string;
  rev: number;
  codeLast4: string;
  initialPence: number;
  balancePence: number;
  soldOn: string | null;
  expiresOn: string | null;
  saleInvoiceId: string | null;
  saleLineId: string | null;
  buyerPatientId: string | null;
  /** Decrypted only on a single card. */
  recipientName: string | null;
  status: GiftCardStatus;
  createdAt: string;
}

export interface GiftCardMove {
  id: string;
  kind: GiftCardMoveKind;
  amountPence: number;
  balanceAfter: number;
  paymentId: string | null;
  createdAt: string;
}

/** The state on screen: an active card past its expiry is expired; one with nothing left is used. */
export function giftCardState(c: Pick<GiftCard, "status" | "balancePence" | "expiresOn">, today: string): GiftCardStatus {
  if (c.status === "cancelled" || c.status === "pending") return c.status;
  if (c.status === "expired" || (c.expiresOn !== null && c.expiresOn < today)) return "expired";
  if (c.balancePence <= 0 || c.status === "used") return "used";
  return "active";
}

export const GIFT_CARD_STATE_LABELS: Readonly<Record<GiftCardStatus, string>> = {
  pending: "Not issued yet",
  active: "Active",
  used: "Used up",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const GIFT_CARD_MOVE_LABELS: Readonly<Record<GiftCardMoveKind, string>> = {
  sale: "Sold",
  redeem: "Spent",
  refund: "Put back (payment reversed)",
  expire: "Expired",
  adjust: "Balance adjusted",
};

/** "£40.00 of £50.00 left · expires 01/11/2028" */
export function giftCardBalanceLabel(c: Pick<GiftCard, "balancePence" | "initialPence" | "expiresOn">): string {
  return `${formatPence(c.balancePence)} of ${formatPence(c.initialPence)} left${c.expiresOn ? ` · expires ${formatUkDate(c.expiresOn)}` : ""}`;
}

export const SellGiftCardInputSchema = z.object({
  amountPence: z.number({ error: "Enter the amount" }).int("Whole pence only").min(100, "At least £1.00").max(GIFT_CARD_MAX_PENCE, "At most £1,000.00"),
  /** Who it is for (printed on the card). Encrypted. */
  recipientName: z.union([z.string().trim().max(80, "At most 80 characters"), z.null()]).optional(),
  months: z.number().int().min(1).max(120).optional(),
});
export type SellGiftCardInput = z.input<typeof SellGiftCardInputSchema>;

/** The invoice line that sells a gift card: no VAT at sale (VAT is charged when it is spent). */
export function giftCardSaleLine(amountPence: number): { kind: "item"; description: string; quantity: 1; unitPricePence: number; vatCode: "exempt" } {
  return { kind: "item", description: "Gift card (no VAT – VAT is charged when it is spent)", quantity: 1, unitPricePence: amountPence, vatCode: "exempt" };
}

/* ------------------------------------------------------------------------------------------------
 * What the screens receive
 * ----------------------------------------------------------------------------------------------*/

export interface GiftCardRowView {
  id: string;
  masked: string;
  state: GiftCardStatus;
  stateLabel: string;
  balance: string;
  balancePence: number;
  initialPence: number;
  soldOn: string | null;
  expiresOn: string | null;
  buyerName: string | null;
  buyerPatientId: string | null;
  saleInvoiceId: string | null;
}

export interface GiftCardDetailView extends GiftCardRowView {
  recipientName: string | null;
  moves: (GiftCardMove & { label: string })[];
}

export interface GiftCardsScreen {
  rows: GiftCardRowView[];
  outstandingPence: number;
  /** The card looked up or opened, with its history. */
  card: GiftCardDetailView | null;
  lookupError: string | null;
}
