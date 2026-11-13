/**
 * Card payments through each clinic's OWN connected payment account (cp01–cp09, docs/clinic-system/card-payments.md).
 * Pure: no imports from the server. The clinic is the merchant of record (direct charges on its connected account),
 * pays the provider's fees and owns refunds and disputes; the platform fee is optional and 0 by default.
 *
 * Two switches, both OFF by default:
 *   1. the platform switch CLINFORMS_CARD_PAYMENTS=on (env) – off = no page, no navigation entry, every action refuses,
 *      the webhook answers 404;
 *   2. the clinic's own switch (pms_card_settings.enabled) – the owner turns it on once the account is connected.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const CARD_PAYMENTS_ENV = "CLINFORMS_CARD_PAYMENTS";

/** The platform switch: "on" (any case, trimmed) – anything else is off. */
export function cardPaymentsSwitchOn(env: Env): boolean {
  return (
    String(env[CARD_PAYMENTS_ENV] ?? "")
      .trim()
      .toLowerCase() === "on"
  );
}

/** The provider id stored on payments and refunds taken through the clinic's own account. */
export const CONNECT_PROVIDER = "stripe_connect";

/* ------------------------------------------------------------------------------------------------
 * The connected account's state
 * ----------------------------------------------------------------------------------------------*/

export const CARD_ACCOUNT_STATUSES = ["none", "pending", "active", "restricted", "closed"] as const;
export type CardAccountStatus = (typeof CARD_ACCOUNT_STATUSES)[number];

export interface AccountState {
  status: Exclude<CardAccountStatus, "none">;
  /** The card_payments capability as the provider reports it ("active", "pending", "restricted", "unsupported"). */
  cardPayments: string;
  /** Payouts to the clinic's bank ("active" …). */
  payouts: string;
  /** How many things the provider still needs from the clinic. */
  requirementsDue: number;
  /** The clinic has been through the provider's form at least once (terms accepted). */
  onboardingDone: boolean;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The account's state from the provider's v2 account object (retrieved with include=configuration.merchant,
 * requirements, identity). Never trusts a field it does not recognise: anything unexpected is "restricted".
 */
export function accountStateOf(account: Record<string, unknown>): AccountState {
  const merchant = obj(obj(account.configuration).merchant);
  const caps = obj(merchant.capabilities);
  const card = s(obj(caps.card_payments).status) ?? "restricted";
  const payouts = s(obj(obj(caps.stripe_balance).payouts).status) ?? "restricted";
  const entries = Array.isArray(obj(account.requirements).entries) ? (obj(account.requirements).entries as unknown[]) : [];
  const due = entries.filter((e) => s(obj(e).awaiting_action_from) === "user").length;
  const tos = obj(obj(obj(obj(account.identity).attestations).terms_of_service).account);
  const onboardingDone = Boolean(s(tos.date)) || card === "active";
  let status: AccountState["status"];
  if (account.closed === true) status = "closed";
  else if (card === "active") status = "active";
  else if (!onboardingDone || card === "pending") status = "pending";
  else status = "restricted";
  return { status, cardPayments: card, payouts, requirementsDue: due, onboardingDone };
}

/**
 * Whether the clinic may take card payments now: its own switch is on and its account is connected – active in live
 * mode. In TEST mode an account that has not finished verification may take test payments too (the provider's test
 * accounts allow it and no real money moves); the screens say so.
 */
export function cardPaymentsReady(input: { enabled: boolean; accountRef: string | null; status: CardAccountStatus; mode: "test" | "live" | null; keyMode: "test" | "live" }): boolean {
  if (!input.enabled || !input.accountRef || input.mode !== input.keyMode) return false;
  if (input.status === "active") return true;
  return input.keyMode === "test" && (input.status === "pending" || input.status === "restricted");
}

/* ------------------------------------------------------------------------------------------------
 * The platform fee (owner's decision – default 0)
 * ----------------------------------------------------------------------------------------------*/

export const PLATFORM_FEE_LIMITS = { maxBps: 1000, maxFixedPence: 500 } as const;

/**
 * The platform's fee on one payment in pence: basis points of the amount (rounded half up) plus a fixed part. 0 when
 * nothing is configured (the default). Never more than half the payment (a mistyped setting cannot take the payment).
 */
export function platformFeePence(amountPence: number, fee: { bps: number; fixedPence: number }): number {
  if (!Number.isInteger(amountPence) || amountPence <= 0) return 0;
  const bps = Math.max(0, Math.min(PLATFORM_FEE_LIMITS.maxBps, Math.floor(fee.bps || 0)));
  const fixed = Math.max(0, Math.min(PLATFORM_FEE_LIMITS.maxFixedPence, Math.floor(fee.fixedPence || 0)));
  const raw = Math.floor((amountPence * bps + 5000) / 10000) + fixed;
  return Math.min(raw, Math.floor(amountPence / 2));
}

/**
 * The default fee by plan (owner's decision – docs/clinic-system/card-payments.md "Decisions"). Every plan is 0 until
 * the owner decides; a clinic's own setting (set by the platform) wins when present.
 */
export const DEFAULT_PLATFORM_FEE = { bps: 0, fixedPence: 0 } as const;

/** The smallest card payment the provider accepts in GBP. */
export const MIN_CARD_PENCE = 30;

/* ------------------------------------------------------------------------------------------------
 * Consent to keep a card on file (cp04)
 * ----------------------------------------------------------------------------------------------*/

/** Bump when the wording changes: every mandate keeps the version AND the exact words the patient agreed to. */
export const CARD_CONSENT_VERSION = "card-on-file-1";

export interface ConsentWordingInput {
  clinicName: string;
  /** The clinic's missed-appointment policy, when the patient also agrees to those charges. */
  noShowPolicy: string | null;
}

/** The exact words the patient agrees to (stored verbatim on the mandate). Plain English; names the provider. */
export function cardConsentWording(input: ConsentWordingInput): string {
  const clinic = input.clinicName.trim() || "the clinic";
  const base =
    `I agree that ${clinic} may keep my card details with its payment provider, Stripe, and charge this card for ` +
    `treatment and other services I receive from the clinic, after the clinic has told me the amount. My card number ` +
    `is never seen or stored by the clinic. I can ask the clinic to remove my card at any time.`;
  if (!input.noShowPolicy) return base;
  return `${base} I also agree that the clinic may charge this card its fee for a missed appointment or a late cancellation, under this policy: ${input.noShowPolicy.trim()}`;
}

/** The words for a monthly membership charged to a saved card (stored on the membership). */
export function membershipConsentWording(input: { clinicName: string; planName: string; pricePence: number; chargeDay: number }): string {
  const clinic = input.clinicName.trim() || "the clinic";
  return (
    `I agree that ${clinic} may charge my saved card ${penceText(input.pricePence)} today and then on day ${input.chargeDay} of every month ` +
    `for my "${input.planName.trim()}" membership, until I or the clinic cancel it. Each charge comes with an invoice.`
  );
}

function penceText(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

export const CONSENT_CHANNELS = ["portal", "desk", "phone"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_CHANNEL_LABELS: Readonly<Record<ConsentChannel, string>> = {
  portal: "The patient agreed in the patient portal",
  desk: "The patient agreed in person at the desk",
  phone: "The patient agreed on the phone",
};

export const MANDATE_STATUSES = ["pending", "active", "removed", "failed"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

/**
 * A missed-appointment or late-cancellation fee may be charged to a saved card only when the clinic's policy is on
 * AND the patient agreed to such charges when the card was saved (the mandate's allowsNoShow).
 */
export function noShowChargeRefusal(input: { policyOn: boolean; mandateAllowsNoShow: boolean }): string | null {
  if (!input.policyOn) return "This clinic does not charge missed-appointment fees to saved cards. Turn it on in Set-up → Card payments, or take the payment another way.";
  if (!input.mandateAllowsNoShow) return "The patient did not agree to missed-appointment charges when the card was saved. Ask them to pay another way.";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Memberships (pk03): charged monthly by our own scheduler
 * ----------------------------------------------------------------------------------------------*/

export const MEMBERSHIP_STATUSES = ["active", "payment_failed", "cancelled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Retries of a failed monthly charge before the membership is marked "payment failed" (one a day). */
export const MEMBERSHIP_MAX_ATTEMPTS = 3;

/** "YYYY-MM" of a "YYYY-MM-DD" date (the period a membership charge is for – one charge per membership per period). */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

/** The next charge date on `day` (1–28) strictly after the period of `from` ("YYYY-MM-DD"). */
export function nextChargeOn(from: string, day: number): string {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(clampDay(day)).padStart(2, "0")}`;
}

/** The first charge date: today when today is the charge day or later this month is not chosen – the first charge is taken on the start date. */
export function firstChargeOn(startOn: string): string {
  return startOn;
}

export function clampDay(day: number): number {
  return Math.max(1, Math.min(28, Math.floor(day) || 1));
}

/* ------------------------------------------------------------------------------------------------
 * Intents (every payment, saved card and refund made through the clinic's account)
 * ----------------------------------------------------------------------------------------------*/

export const CARD_INTENT_KINDS = ["payment", "setup", "refund"] as const;
export type CardIntentKind = (typeof CARD_INTENT_KINDS)[number];
export const CARD_INTENT_PURPOSES = ["reader", "saved_card", "portal", "membership", "save_card", "refund"] as const;
export type CardIntentPurpose = (typeof CARD_INTENT_PURPOSES)[number];
export const CARD_INTENT_STATUSES = ["open", "processing", "succeeded", "failed", "canceled"] as const;
export type CardIntentStatus = (typeof CARD_INTENT_STATUSES)[number];

export const CARD_PURPOSE_LABELS: Readonly<Record<CardIntentPurpose, string>> = {
  reader: "Card reader",
  saved_card: "Saved card",
  portal: "Paid online",
  membership: "Membership",
  save_card: "Card saved",
  refund: "Refund to card",
};

/** Simulated readers for TEST mode (the provider's registration code). */
export const SIMULATED_READER_CODE = "simulated-wpe";

/* ------------------------------------------------------------------------------------------------
 * Screens (browser-safe views)
 * ----------------------------------------------------------------------------------------------*/

export interface CardSetupView {
  switchOn: boolean;
  configured: boolean;
  unavailableReason: string | null;
  keyMode: "test" | "live";
  enabled: boolean;
  accountRef: string | null;
  status: CardAccountStatus;
  requirementsDue: number;
  ready: boolean;
  lastSyncedAt: string | null;
  noShowEnabled: boolean;
  noShowPolicy: string;
  feeText: string;
  sites: { id: string; name: string }[];
  readers: { id: string; label: string; siteId: string; siteName: string; simulated: boolean; status: string }[];
  plans: { id: string; name: string; pricePence: number; active: boolean; members: number }[];
  webhookReady: boolean;
  rev: number;
}

export interface InvoiceCardView {
  ready: boolean;
  testMode: boolean;
  invoiceId: string;
  balancePence: number;
  /** A missed-appointment or late-cancellation fee (no-show rules apply to saved-card charges). */
  noShow: boolean;
  readers: { id: string; label: string; simulated: boolean }[];
  savedCards: { id: string; label: string; allowsNoShow: boolean }[];
  noShowPolicyOn: boolean;
  /** Payments taken through the clinic's account on this invoice, with what can still be refunded. */
  cardPayments: { paymentId: string; intentRef: string; label: string; amountPence: number; refundedPence: number; refundablePence: number; receivedOn: string }[];
  /** A desk payment still in progress (on a reader, or a saved-card charge whose answer is being confirmed). */
  pendingReader: { intentId: string; readerLabel: string; amountPence: number; onReader: boolean } | null;
  can: { pay: boolean; refund: boolean };
}

export interface PatientCardsView {
  ready: boolean;
  testMode: boolean;
  cards: { id: string; label: string; status: MandateStatus; consentAt: string; consentChannel: string; allowsNoShow: boolean; wording: string }[];
  noShowPolicy: string | null;
  consentPreview: { plain: string; withNoShow: string | null };
  plans: { id: string; name: string; pricePence: number }[];
  memberships: { id: string; planName: string; pricePence: number; status: MembershipStatus; nextChargeOn: string | null; cardLabel: string }[];
  can: { pay: boolean; manage: boolean };
}

export interface PayoutsView {
  ready: boolean;
  testMode: boolean;
  balance: { availablePence: number; pendingPence: number };
  payouts: { id: string; amountPence: number; arrivalOn: string; status: string }[];
  /** The selected payout's lines (or the latest card movements when none is chosen). */
  lines: { id: string; type: string; grossPence: number; providerFeePence: number; platformFeePence: number; netPence: number; availableOn: string; invoiceNumber: string | null; invoiceId: string | null }[];
  selected: string | null;
  totals: { grossPence: number; providerFeePence: number; platformFeePence: number; netPence: number };
}

export const CARD_COPY = {
  off: "Card payments are not switched on for this system.",
  notReady: "Card payments are not set up for this clinic yet. The owner connects the clinic's payment account in Set-up → Card payments.",
  ownerOnly: "Only the clinic's owner can manage card payments.",
  testBanner: "Test mode – no real card is charged and no money moves.",
} as const;
