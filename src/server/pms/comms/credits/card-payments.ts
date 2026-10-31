/**
 * Card payments for text credits: the clinic system's OWN payment account (CLAUDE.md: one account per product –
 * never another product's), over the payment provider's REST API with fetch and a PINNED API version (no SDK
 * dependency). Server only. Nothing clinical is ever sent: a customer per clinic (the clinic's id and name), a
 * checkout for a pack, a saved card, an off-session charge for an automatic top-up.
 *
 *   STRIPE_CLINDESK_SECRET_KEY      the account's secret key – a TEST key (sk_test_… / rk_test_…); a live key is
 *                                   refused unless STRIPE_CLINDESK_ALLOW_LIVE=1 (go-live step, SMS-CREDITS.md)
 *   STRIPE_CLINDESK_WEBHOOK_SECRET  the webhook endpoint's signing secret (whsec_…)
 *   STRIPE_CLINDESK_PUBLISHABLE_KEY not needed by the hosted checkout (kept for later; name only)
 *   STRIPE_CLINDESK_API_BASE        LOCAL runs only: a stand-in on this machine (http://127.0.0.1:<port>/v1) –
 *                                   anything that is not the provider's own host or a loopback address is refused
 *
 * Payment methods follow the account's own settings (this API version refuses payment_method_types on a checkout);
 * the account must have cards switched on for automatic top-up (SMS-CREDITS.md).
 *
 * Every answer is checked against the mode of the key: a test key never accepts a live answer and the other way
 * round. Keys are never logged or echoed (errors carry the provider's error code only).
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SMS_PACKS, smsPack, type SmsPack, type SmsPackKey } from "../../../../modules/pms/comms/credits";
import { stripeApiBase } from "../../billing/payments/stripe-test";

/** The provider's API version every request is pinned to (the account's version when this was built, 31/10/2026). */
export const CARD_API_VERSION = "2026-10-28.endive";

const KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;
/** Webhook signatures older (or newer) than this are refused (the provider's own default). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Env = Readonly<Record<string, string | undefined>>;

export class CardPaymentsError extends Error {
  readonly code: string;
  constructor(message: string, code = "card_payments_error") {
    super(message);
    this.name = "CardPaymentsError";
    this.code = code;
  }
}

export interface CardPaymentsConfig {
  secretKey: string;
  webhookSecret: string | null;
  apiBase: string;
  live: boolean;
}

/** The configuration from env, or why card payments for credits are off (plain words, no values). */
export function cardPaymentsConfig(env: Env = process.env): { ok: true; config: CardPaymentsConfig } | { ok: false; reason: string } {
  const key = (env.STRIPE_CLINDESK_SECRET_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "Card payments for text credits are not set up yet." };
  const m = KEY_PATTERN.exec(key);
  if (!m) return { ok: false, reason: "The card payment key is not valid, so card payments are off." };
  const live = m[2] === "live";
  if (live && env.STRIPE_CLINDESK_ALLOW_LIVE !== "1") return { ok: false, reason: "A live card payment key is set but live payments are not switched on, so card payments are off." };
  let apiBase: string;
  try {
    apiBase = stripeApiBase(env.STRIPE_CLINDESK_API_BASE || undefined);
  } catch {
    return { ok: false, reason: "The card payment address is not allowed, so card payments are off." };
  }
  if (live && apiBase !== "https://api.stripe.com/v1") return { ok: false, reason: "Live card payments must use the provider's own address." };
  const hook = (env.STRIPE_CLINDESK_WEBHOOK_SECRET ?? "").trim();
  return { ok: true, config: { secretKey: key, webhookSecret: hook.length >= 16 ? hook : null, apiBase, live } };
}

function form(fields: Record<string, string | number | boolean>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** The checkout as the service needs it (whatever the provider's event or answer looked like). */
export interface CheckoutSessionInfo {
  id: string;
  mode: "payment" | "setup" | "other";
  status: string | null;
  paymentStatus: string | null;
  livemode: boolean;
  clientReferenceId: string | null;
  customer: string | null;
  amountTotal: number | null;
  currency: string | null;
  metadata: Record<string, string>;
  paymentIntent: string | null;
  /** The card saved with a pack purchase ("save this card"), when the answer included it. */
  paymentMethod: string | null;
  setupIntent: string | null;
  setupPaymentMethod: string | null;
  url: string | null;
}

export interface PaymentIntentInfo {
  id: string;
  status: string;
  amount: number;
  amountReceived: number | null;
  currency: string;
  customer: string | null;
  paymentMethod: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
}

export interface CardInfo {
  methodRef: string;
  customerRef: string | null;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type ChargeOutcome = { ok: true; payment: PaymentIntentInfo } | { ok: false; code: string };

export interface CardPayments {
  readonly live: boolean;
  /** The pack prices at the provider, checked against SMS_PACKS (amount, currency, one-off, credits metadata). */
  packPrices(): Promise<Map<SmsPackKey, string>>;
  createCustomer(input: { tenantId: string; clinicName: string }): Promise<string>;
  createPackCheckout(input: { tenantId: string; customerRef: string; pack: SmsPack; priceId: string; successUrl: string; cancelUrl: string; saveCard: boolean; idempotencyKey: string }): Promise<CheckoutSessionInfo>;
  createCardCheckout(input: { tenantId: string; customerRef: string; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<CheckoutSessionInfo>;
  getCheckoutSession(id: string): Promise<CheckoutSessionInfo>;
  getPaymentIntent(id: string): Promise<PaymentIntentInfo>;
  getCard(methodRef: string): Promise<CardInfo>;
  /** An automatic top-up: the saved card charged off-session for one pack. A decline is an answer, not an error. */
  chargeSavedCard(input: { tenantId: string; customerRef: string; methodRef: string; pack: SmsPack; idempotencyKey: string }): Promise<ChargeOutcome>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>).id) : null);
function meta(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
}

/** Reads a checkout session object (an API answer or an event's data.object). */
export function checkoutSessionInfo(o: Record<string, unknown>): CheckoutSessionInfo {
  const pi = o.payment_intent;
  const si = o.setup_intent;
  const mode = o.mode === "payment" || o.mode === "setup" ? o.mode : "other";
  return {
    id: String(o.id ?? ""),
    mode,
    status: str(o.status),
    paymentStatus: str(o.payment_status),
    livemode: o.livemode === true,
    clientReferenceId: str(o.client_reference_id),
    customer: idOf(o.customer),
    amountTotal: typeof o.amount_total === "number" ? o.amount_total : null,
    currency: str(o.currency),
    metadata: meta(o.metadata),
    paymentIntent: idOf(pi),
    paymentMethod: pi && typeof pi === "object" ? idOf((pi as Record<string, unknown>).payment_method) : null,
    setupIntent: idOf(si),
    setupPaymentMethod: si && typeof si === "object" ? idOf((si as Record<string, unknown>).payment_method) : null,
    url: str(o.url),
  };
}

/** Reads a payment intent object. */
export function paymentIntentInfo(o: Record<string, unknown>): PaymentIntentInfo {
  return {
    id: String(o.id ?? ""),
    status: String(o.status ?? ""),
    amount: typeof o.amount === "number" ? o.amount : 0,
    amountReceived: typeof o.amount_received === "number" ? o.amount_received : null,
    currency: String(o.currency ?? ""),
    customer: idOf(o.customer),
    paymentMethod: idOf(o.payment_method),
    livemode: o.livemode === true,
    metadata: meta(o.metadata),
  };
}

export function createCardPayments(config: CardPaymentsConfig, fetchImpl: Fetch = (url, init) => fetch(url, init)): CardPayments {
  const call = async (method: "GET" | "POST", path: string, body?: Record<string, string | number | boolean>, idempotencyKey?: string): Promise<{ status: number; json: Record<string, unknown> }> => {
    const headers: Record<string, string> = { authorization: `Bearer ${config.secretKey}`, "stripe-version": CARD_API_VERSION };
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${config.apiBase}${path}`, { method, headers, body: body ? form(body) : undefined, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new CardPaymentsError("The card payment service could not be reached. Try again.", "unreachable");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof json.livemode === "boolean" && json.livemode !== config.live) throw new CardPaymentsError("Refused: the card payment service answered in the wrong mode.", "wrong_mode");
    return { status: res.status, json };
  };
  const ok = async (method: "GET" | "POST", path: string, body?: Record<string, string | number | boolean>, idempotencyKey?: string): Promise<Record<string, unknown>> => {
    const r = await call(method, path, body, idempotencyKey);
    if (r.status < 200 || r.status >= 300) {
      const err = (r.json.error ?? {}) as Record<string, unknown>;
      throw new CardPaymentsError("The card payment service refused the request.", String(err.code ?? `http_${r.status}`).slice(0, 40));
    }
    return r.json;
  };

  let priceCache: { at: number; map: Map<SmsPackKey, string> } | null = null;

  return {
    live: config.live,
    async packPrices() {
      if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.map;
      const q = SMS_PACKS.map((p) => `lookup_keys[]=${encodeURIComponent(p.key)}`).join("&");
      const list = await ok("GET", `/prices?active=true&limit=10&${q}`);
      const data = Array.isArray(list.data) ? (list.data as Record<string, unknown>[]) : [];
      const map = new Map<SmsPackKey, string>();
      for (const p of data) {
        const pack = smsPack(p.lookup_key);
        if (!pack || typeof p.id !== "string") continue;
        const m = meta(p.metadata);
        const good = p.currency === "gbp" && p.type === "one_time" && p.unit_amount === pack.pricePence && m.sms_credits === String(pack.credits) && p.active !== false;
        if (!good) throw new CardPaymentsError(`The card payment price for ${pack.key} does not match the pack (amount, currency or credits).`, "price_mismatch");
        map.set(pack.key, p.id);
      }
      priceCache = { at: Date.now(), map };
      return map;
    },
    async createCustomer(input) {
      const c = await ok("POST", "/customers", { name: input.clinicName.slice(0, 200), "metadata[tenant_id]": input.tenantId, "metadata[kind]": "clinic" }, `customer-${input.tenantId}`);
      if (typeof c.id !== "string") throw new CardPaymentsError("The card payment service gave no customer.");
      return c.id;
    },
    async createPackCheckout(input) {
      const body: Record<string, string | number | boolean> = {
        mode: "payment",
        "line_items[0][price]": input.priceId,
        "line_items[0][quantity]": 1,
        customer: input.customerRef,
        client_reference_id: input.tenantId,
        locale: "en-GB",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "metadata[tenant_id]": input.tenantId,
        "metadata[kind]": "sms_pack",
        "metadata[pack]": input.pack.key,
        "metadata[save_card]": input.saveCard ? "1" : "0",
        "payment_intent_data[metadata][tenant_id]": input.tenantId,
        "payment_intent_data[metadata][kind]": "sms_pack",
        "payment_intent_data[metadata][pack]": input.pack.key,
        "payment_intent_data[description]": `Text credits – ${input.pack.credits}`,
      };
      if (input.saveCard) body["payment_intent_data[setup_future_usage]"] = "off_session";
      return checkoutSessionInfo(await ok("POST", "/checkout/sessions", body, input.idempotencyKey));
    },
    async createCardCheckout(input) {
      return checkoutSessionInfo(
        await ok(
          "POST",
          "/checkout/sessions",
          {
            mode: "setup",
            currency: "gbp",
            customer: input.customerRef,
            client_reference_id: input.tenantId,
                locale: "en-GB",
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            "metadata[tenant_id]": input.tenantId,
            "metadata[kind]": "sms_card",
            "setup_intent_data[metadata][tenant_id]": input.tenantId,
            "setup_intent_data[metadata][kind]": "sms_card",
          },
          input.idempotencyKey,
        ),
      );
    },
    async getCheckoutSession(id) {
      if (!/^cs_[A-Za-z0-9_]{6,}$/.test(id)) throw new CardPaymentsError("That is not a card payment reference.", "bad_reference");
      return checkoutSessionInfo(await ok("GET", `/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent&expand[]=setup_intent`));
    },
    async getPaymentIntent(id) {
      if (!/^pi_[A-Za-z0-9_]{6,}$/.test(id)) throw new CardPaymentsError("That is not a payment reference.", "bad_reference");
      return paymentIntentInfo(await ok("GET", `/payment_intents/${encodeURIComponent(id)}`));
    },
    async getCard(methodRef) {
      if (!/^pm_[A-Za-z0-9_]{6,}$/.test(methodRef)) throw new CardPaymentsError("That is not a card reference.", "bad_reference");
      const pm = await ok("GET", `/payment_methods/${encodeURIComponent(methodRef)}`);
      const card = (pm.card ?? {}) as Record<string, unknown>;
      if (typeof pm.id !== "string" || typeof card.last4 !== "string") throw new CardPaymentsError("The card payment service gave no card.", "no_card");
      return {
        methodRef: pm.id,
        customerRef: idOf(pm.customer),
        brand: typeof card.brand === "string" ? card.brand.slice(0, 20) : "card",
        last4: card.last4,
        expMonth: typeof card.exp_month === "number" ? card.exp_month : 12,
        expYear: typeof card.exp_year === "number" ? card.exp_year : 2030,
      };
    },
    async chargeSavedCard(input) {
      const r = await call(
        "POST",
        "/payment_intents",
        {
          amount: input.pack.pricePence,
          currency: "gbp",
          customer: input.customerRef,
          payment_method: input.methodRef,
          off_session: true,
          confirm: true,
          description: `Text credits – ${input.pack.credits} (automatic top-up)`,
          "metadata[tenant_id]": input.tenantId,
          "metadata[kind]": "sms_auto_topup",
          "metadata[pack]": input.pack.key,
        },
        input.idempotencyKey,
      );
      if (r.status >= 200 && r.status < 300) {
        const pi = paymentIntentInfo(r.json);
        return pi.status === "succeeded" ? { ok: true, payment: pi } : { ok: false, code: pi.status === "requires_action" ? "authentication_required" : pi.status.slice(0, 40) || "not_paid" };
      }
      if (r.status === 402 || r.status === 400) {
        const err = (r.json.error ?? {}) as Record<string, unknown>;
        return { ok: false, code: String(err.decline_code ?? err.code ?? "card_declined").slice(0, 40) };
      }
      throw new CardPaymentsError("The card payment service refused the request.", `http_${r.status}`);
    },
  };
}

/**
 * Checks a webhook's signature header ("t=<unix seconds>,v1=<hex HMAC-SHA256 of `t.payload`>[,v1=…]") against the
 * endpoint's signing secret, in constant time, and that `t` is within the tolerance of `nowSeconds`.
 */
export function verifyWebhookSignature(payload: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (t === null || sigs.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** TESTS / local e2e: a signature header for `payload` (what the provider sends). */
export function signWebhookPayload(payload: string, secret: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`, "utf8").digest("hex")}`;
}
