/**
 * Prepaid text credits (Khuram, 31/10/2026). Pure – browser-safe.
 *
 * - PREPAID only: a clinic buys a pack up front; nothing is ever sent on credit (a clinic could leave a bill).
 * - 1 credit = 1 UK text segment: up to 160 GSM-7 characters is one; longer texts cost one credit per 153-character
 *   part; a text with a character outside GSM-7 is sent as unicode (70 / 67 per part) – smsInfo() in ./sms.ts.
 * - Not enough credit for an automatic text: it goes by email instead when the patient has an email address and
 *   allows email, otherwise it is recorded as not sent ("no text credit"). The balance is never negative.
 * - Warnings by email to the clinic's owner and admins at 20 % of the last pack bought and at zero, once each time
 *   the balance crosses the line (bought credit above the line arms the warning again).
 * - Automatic top-up (optional): with a saved card, when a text would take the balance below the clinic's threshold
 *   (default 100), the chosen pack is charged first. A failed charge: no top-up, automatic top-up paused, the owner
 *   told, the text goes by email or not at all.
 * - Unused credits stay while the account is open; they are not refundable.
 */
import { z } from "zod";
import { smsInfo } from "./sms";

export const SMS_PACK_KEYS = ["sms_500", "sms_1000", "sms_5000"] as const;
export type SmsPackKey = (typeof SMS_PACK_KEYS)[number];

export interface SmsPack {
  /** The price's lookup key at the payment provider (and the pack's id here). */
  key: SmsPackKey;
  credits: number;
  /** What the clinic pays, in pence (GBP). */
  pricePence: number;
}

/** The packs on sale. The payment provider's prices must match these (checked before every checkout). */
export const SMS_PACKS: readonly SmsPack[] = [
  { key: "sms_500", credits: 500, pricePence: 3000 },
  { key: "sms_1000", credits: 1000, pricePence: 5500 },
  { key: "sms_5000", credits: 5000, pricePence: 25000 },
];

export function isSmsPackKey(value: unknown): value is SmsPackKey {
  return typeof value === "string" && (SMS_PACK_KEYS as readonly string[]).includes(value);
}

export function smsPack(key: unknown): SmsPack | null {
  return isSmsPackKey(key) ? (SMS_PACKS.find((p) => p.key === key) ?? null) : null;
}

/** Pence per credit, rounded to a tenth of a penny ("6.0p a text"). */
export function pencePerCredit(pack: SmsPack): number {
  return Math.round((pack.pricePence / pack.credits) * 10) / 10;
}

/**
 * Credits a text costs: one per segment as the network counts them (./sms.ts smsInfo). An empty text costs
 * nothing (it is never sent).
 */
export function creditsForSms(text: string): number {
  return smsInfo(text).segments;
}

/** The share of the last pack at which the clinic is warned (20 %). */
export const LOW_BALANCE_SHARE = 0.2;
/** The smallest pack's credits: the base of the low-balance line until a pack has been bought. */
export const DEFAULT_PACK_CREDITS = SMS_PACKS[0].credits;

/** The low-balance line for a clinic whose last pack had `lastPackCredits` credits (20 %, whole credits). */
export function lowThresholdFor(lastPackCredits: number | null | undefined): number {
  const base = lastPackCredits && lastPackCredits > 0 ? lastPackCredits : DEFAULT_PACK_CREDITS;
  return Math.floor(base * LOW_BALANCE_SHARE);
}

export type CreditWarning = "low" | "zero";

/**
 * Which warning a balance calls for now: "zero" at 0 (it covers "low" too), "low" at or under the line – each only
 * when it has not been sent since the balance last rose above the line.
 */
export function warningDue(state: { balance: number; lowThreshold: number; lowWarned: boolean; zeroWarned: boolean }): CreditWarning | null {
  if (state.balance <= 0) return state.zeroWarned ? null : "zero";
  if (state.balance <= state.lowThreshold) return state.lowWarned ? null : "low";
  return null;
}

export const AUTO_TOPUP_DEFAULT_THRESHOLD = 100;
export const AUTO_TOPUP_MAX_THRESHOLD = 100_000;

/** Whether an automatic top-up is due before using `needed` credits. */
export function topUpDue(state: { autoTopup: boolean; paused: boolean; hasCard: boolean; pack: SmsPackKey | null; balance: number; threshold: number }, needed: number): boolean {
  if (!state.autoTopup || state.paused || !state.hasCard || !state.pack) return false;
  return state.balance - Math.max(0, needed) < state.threshold;
}

export const CREDIT_ENTRY_KINDS = ["purchase", "auto_topup", "debit", "adjustment", "reversal"] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

export const CREDIT_ENTRY_LABELS: Readonly<Record<CreditEntryKind, string>> = {
  purchase: "Credits bought",
  auto_topup: "Automatic top-up",
  debit: "Text sent",
  adjustment: "Adjustment by support",
  reversal: "Text not sent – credit returned",
};

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ----------------------------------------------------------------------------------------------*/

export const SmsPackKeySchema = z.enum(SMS_PACK_KEYS);

/** Automatic top-up settings (owner / admin). */
export const AutoTopupInputSchema = z.object({
  enabled: z.boolean(),
  threshold: z.coerce
    .number()
    .int("Enter a whole number of credits")
    .min(1, "Enter at least 1 credit")
    .max(AUTO_TOPUP_MAX_THRESHOLD, `Enter at most ${AUTO_TOPUP_MAX_THRESHOLD.toLocaleString("en-GB")} credits`),
  pack: SmsPackKeySchema,
});
export type AutoTopupInput = z.infer<typeof AutoTopupInputSchema>;

/** A support adjustment (platform staff): a whole, non-zero number of credits and a reason (no patient details). */
export const CreditAdjustmentSchema = z.object({
  credits: z.coerce
    .number()
    .int("Enter a whole number of credits")
    .refine((n) => n !== 0, "Enter a number of credits other than 0")
    .refine((n) => Math.abs(n) <= 100_000, "Enter at most 100,000 credits"),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(200, "Keep the reason under 200 characters"),
});
export type CreditAdjustmentInput = z.infer<typeof CreditAdjustmentSchema>;

/* ------------------------------------------------------------------------------------------------
 * Copy (UK English, plain; never the payment provider's name)
 * ----------------------------------------------------------------------------------------------*/

export const CREDIT_COPY = {
  title: "Text credits",
  explain:
    "Texts are paid for in advance. One credit sends one text of up to 160 characters; longer texts use one credit for each 153 characters, and texts with special characters or emoji use more.",
  fallback: "When the balance is too low, automatic messages go by email instead if the patient has an email address and allows email. Otherwise they are not sent.",
  nonRefundable: "Unused credits stay on your account while it is open. Credits are not refundable.",
  cardPayment: "You pay by card payment on a secure page. You come back here when you have paid.",
  manageOnly: "Only the clinic's owner and admins can buy credits or change automatic top-up.",
  noCredit: "Not enough text credit. Buy more under Messages → Text credits, or send it by email.",
  autoTopupFailed: "Automatic top-up was paused because the card payment did not go through.",
} as const;

/** "1,000 credits" / "1 credit". */
export function creditsText(n: number): string {
  return `${n.toLocaleString("en-GB")} ${Math.abs(n) === 1 ? "credit" : "credits"}`;
}

/* ------------------------------------------------------------------------------------------------
 * View models (the Text credits page – plain fields only)
 * ----------------------------------------------------------------------------------------------*/

export interface CreditPackView {
  key: SmsPackKey;
  credits: number;
  /** "£30.00" */
  price: string;
  /** "6p a text" */
  perText: string;
}

export interface CreditEntryView {
  id: string;
  /** "31/10/2026 14:05" (UK time). */
  at: string;
  kind: CreditEntryKind;
  label: string;
  credits: number;
  balanceAfter: number;
  /** "1,000-credit pack · £55.00", the support reason, … */
  note: string | null;
}

export interface TextCreditsView {
  clinicName: string;
  balance: number;
  lowThreshold: number;
  /** Owner / admin: buy packs, save a card, change automatic top-up. */
  canManage: boolean;
  /** Card payments are set up on this deployment (else why not, in plain words). */
  paymentsReady: boolean;
  paymentsUnavailable: string | null;
  /** The text service in use ("outbox": texts are kept, not sent – credits are only checked). */
  smsMode: "outbox" | "test" | "mailpit" | "misconfigured";
  packs: CreditPackView[];
  autoTopup: { enabled: boolean; threshold: number; pack: SmsPackKey | null; paused: boolean; failure: string | null };
  card: { brand: string; last4: string; expires: string } | null;
  entries: CreditEntryView[];
}
