/**
 * The payment provider's API for CONNECTED accounts (card payments, docs/clinic-system/card-payments.md): each clinic
 * is its own connected account (Accounts v2) and the merchant of record – every payment is a DIRECT charge on the
 * clinic's account (v1 requests with the Stripe-Account header), the clinic pays the provider's fees and owns
 * refunds and disputes; the platform's optional fee is `application_fee_amount` (0 by default = left out).
 *
 * Plain fetch, no SDK; the same key, pinned API version and live-key guard as subscription billing
 * (STRIPE_CLINDESK_SECRET_KEY, STRIPE_CLINDESK_ALLOW_LIVE, CLINDESK_BILLING_LIVE – ../../comms/credits/card-payments.ts).
 * Every answer is checked against the key's mode. No card number ever passes here: cards are typed into the
 * provider's own hosted pages or presented to the provider's reader; we keep only references, brand and last 4.
 * Nothing clinical is sent – clinic, patient and invoice ids in metadata, "Invoice INV00042" as the line.
 */
import "server-only";
import { CARD_API_VERSION, CardPaymentsError, cardPaymentsConfig, type CardPaymentsConfig, type Fetch } from "../../comms/credits/card-payments";

type Env = Readonly<Record<string, string | undefined>>;
type Form = Record<string, string | number | boolean | undefined>;

const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,60}$/;
const REF = {
  pi: /^pi_[A-Za-z0-9_]{6,200}$/,
  seti: /^seti_[A-Za-z0-9_]{6,200}$/,
  cs: /^cs_[A-Za-z0-9_]{6,200}$/,
  re: /^(re|pyr)_[A-Za-z0-9_]{6,200}$/,
  pm: /^pm_[A-Za-z0-9_]{6,200}$/,
  tmr: /^tmr_[A-Za-z0-9_]{6,200}$/,
  tml: /^tml_[A-Za-z0-9_]{6,200}$/,
  po: /^po_[A-Za-z0-9_]{6,200}$/,
  cus: /^cus_[A-Za-z0-9_]{6,200}$/,
} as const;

export function isAccountRef(v: unknown): v is string {
  return typeof v === "string" && ACCOUNT_ID.test(v);
}

function need(kind: keyof typeof REF, v: string): string {
  if (!REF[kind].test(v)) throw new CardPaymentsError("That is not a valid payment reference.", "bad_reference");
  return encodeURIComponent(v);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>).id) : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
function meta(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(o(v))) if (typeof val === "string") out[k] = val;
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * What the service reads from the provider's objects
 * ----------------------------------------------------------------------------------------------*/

export interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export interface IntentInfo {
  id: string;
  status: string;
  amount: number;
  amountReceived: number;
  currency: string;
  livemode: boolean;
  metadata: Record<string, string>;
  customer: string | null;
  paymentMethod: string | null;
  applicationFee: number;
  /** The card used, when the provider told us (from the latest charge). */
  card: CardDetails | null;
  /** The provider's last error code (a decline), if any. */
  errorCode: string | null;
  /** The payment created on the reader saved a card for later (generated_card), if requested. */
  createdAt: number | null;
}

export interface SetupInfo {
  id: string;
  status: string;
  customer: string | null;
  paymentMethod: string | null;
  metadata: Record<string, string>;
  livemode: boolean;
}

export interface CheckoutInfo {
  id: string;
  mode: string;
  status: string | null;
  paymentStatus: string | null;
  paymentIntent: string | null;
  setupIntent: string | null;
  metadata: Record<string, string>;
  url: string | null;
  livemode: boolean;
  amountTotal: number | null;
}

export interface RefundInfo {
  id: string;
  status: string;
  amount: number;
  paymentIntent: string | null;
  metadata: Record<string, string>;
  livemode: boolean;
}

export interface ReaderInfo {
  id: string;
  label: string | null;
  deviceType: string | null;
  status: string | null;
  location: string | null;
  action: { type: string | null; status: string | null; paymentIntent: string | null; failureCode: string | null } | null;
}

export interface BalanceLine {
  id: string;
  type: string;
  amount: number;
  fee: number;
  platformFee: number;
  providerFee: number;
  net: number;
  availableOn: number;
  /** The payment intent behind a charge or refund line, when the provider gave it. */
  paymentIntent: string | null;
}

export interface PayoutInfo {
  id: string;
  amount: number;
  arrivalDate: number;
  status: string;
}

export type ChargeOutcome = { ok: true; intent: IntentInfo } | { ok: false; code: string; intent: IntentInfo | null };

export function intentInfo(x: Record<string, unknown>): IntentInfo {
  const charge = o(x.latest_charge);
  const pmd = o(charge.payment_method_details);
  const cardRaw = Object.keys(o(pmd.card)).length ? o(pmd.card) : o(pmd.card_present);
  const card: CardDetails | null = str(cardRaw.last4)
    ? { brand: (str(cardRaw.brand) ?? "card").slice(0, 20), last4: String(cardRaw.last4), expMonth: n(cardRaw.exp_month), expYear: n(cardRaw.exp_year) }
    : null;
  return {
    id: String(x.id ?? ""),
    status: String(x.status ?? ""),
    amount: n(x.amount) ?? 0,
    amountReceived: n(x.amount_received) ?? 0,
    currency: String(x.currency ?? ""),
    livemode: x.livemode === true,
    metadata: meta(x.metadata),
    customer: idOf(x.customer),
    paymentMethod: idOf(x.payment_method),
    applicationFee: n(x.application_fee_amount) ?? 0,
    card,
    errorCode: str(o(x.last_payment_error).decline_code) ?? str(o(x.last_payment_error).code),
    createdAt: n(x.created),
  };
}

export function setupInfo(x: Record<string, unknown>): SetupInfo {
  return { id: String(x.id ?? ""), status: String(x.status ?? ""), customer: idOf(x.customer), paymentMethod: idOf(x.payment_method), metadata: meta(x.metadata), livemode: x.livemode === true };
}

export function checkoutInfo(x: Record<string, unknown>): CheckoutInfo {
  return {
    id: String(x.id ?? ""),
    mode: String(x.mode ?? ""),
    status: str(x.status),
    paymentStatus: str(x.payment_status),
    paymentIntent: idOf(x.payment_intent),
    setupIntent: idOf(x.setup_intent),
    metadata: meta(x.metadata),
    url: str(x.url),
    livemode: x.livemode === true,
    amountTotal: n(x.amount_total),
  };
}

export function refundInfo(x: Record<string, unknown>): RefundInfo {
  return { id: String(x.id ?? ""), status: String(x.status ?? ""), amount: n(x.amount) ?? 0, paymentIntent: idOf(x.payment_intent), metadata: meta(x.metadata), livemode: x.livemode === true };
}

function readerInfo(x: Record<string, unknown>): ReaderInfo {
  const a = o(x.action);
  const ppi = o(a.process_payment_intent);
  return {
    id: String(x.id ?? ""),
    label: str(x.label),
    deviceType: str(x.device_type),
    status: str(x.status),
    location: idOf(x.location),
    action: Object.keys(a).length ? { type: str(a.type), status: str(a.status), paymentIntent: idOf(ppi.payment_intent), failureCode: str(a.failure_code) } : null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The client
 * ----------------------------------------------------------------------------------------------*/

export interface ConnectApi {
  readonly mode: "test" | "live";
  // Accounts v2
  createAccount(input: { tenantId: string; clinicName: string; email: string | null }, idempotencyKey: string): Promise<{ id: string; raw: Record<string, unknown> }>;
  getAccount(account: string): Promise<Record<string, unknown>>;
  onboardingLink(account: string, urls: { refreshUrl: string; returnUrl: string }): Promise<string>;
  closeAccount(account: string): Promise<void>;
  // Terminal
  createLocation(account: string, input: { displayName: string; line1: string; city: string; postcode: string }, idempotencyKey: string): Promise<string>;
  registerReader(account: string, input: { registrationCode: string; location: string; label: string }): Promise<ReaderInfo>;
  getReader(account: string, reader: string): Promise<ReaderInfo>;
  deleteReader(account: string, reader: string): Promise<void>;
  processOnReader(account: string, reader: string, paymentIntent: string): Promise<ReaderInfo>;
  cancelReaderAction(account: string, reader: string): Promise<ReaderInfo>;
  /** TEST MODE ONLY: the simulated reader "taps" a test card. */
  presentTestCard(account: string, reader: string, cardNumber?: string): Promise<ReaderInfo>;
  // Payments
  createReaderPayment(account: string, input: { amountPence: number; feePence: number; description: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<IntentInfo>;
  chargeSavedCard(account: string, input: { amountPence: number; feePence: number; customer: string; paymentMethod: string; description: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<ChargeOutcome>;
  getPaymentIntent(account: string, id: string): Promise<IntentInfo>;
  cancelPaymentIntent(account: string, id: string): Promise<IntentInfo>;
  /** Payment intents carrying our intent row's id (a charge whose answer was lost – crash, timeout). */
  findPaymentsForIntent(account: string, cardIntentId: string): Promise<IntentInfo[]>;
  // Hosted pages
  createCustomer(account: string, input: { tenantId: string; patientId: string }, idempotencyKey: string): Promise<string>;
  createPaymentCheckout(account: string, input: { amountPence: number; feePence: number; lineName: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<CheckoutInfo>;
  createSetupCheckout(account: string, input: { customer: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<CheckoutInfo>;
  getCheckout(account: string, id: string): Promise<CheckoutInfo>;
  expireCheckout(account: string, id: string): Promise<void>;
  getSetupIntent(account: string, id: string): Promise<SetupInfo>;
  getCard(account: string, paymentMethod: string): Promise<CardDetails & { customer: string | null }>;
  detachCard(account: string, paymentMethod: string): Promise<void>;
  // Refunds
  createRefund(account: string, input: { paymentIntent: string; amountPence: number; refundPlatformFee: boolean; metadata: Record<string, string> }, idempotencyKey: string): Promise<RefundInfo>;
  getRefund(account: string, id: string): Promise<RefundInfo>;
  // Reconciliation
  getBalance(account: string): Promise<{ available: number; pending: number }>;
  listPayouts(account: string, limit: number): Promise<PayoutInfo[]>;
  listBalanceLines(account: string, input: { payout: string | null; limit: number }): Promise<BalanceLine[]>;
}

/** The v1 base of the configuration ("…/v1") → the v2 base ("…/v2"). */
export function v2Base(apiBase: string): string {
  return apiBase.replace(/\/v1$/, "/v2");
}

export function createConnectApi(config: CardPaymentsConfig, fetchImpl: Fetch = (url, init) => fetch(url, init)): ConnectApi {
  const live = config.live;
  const mode: "test" | "live" = config.mode ?? (live ? "live" : "test");
  const form = (fields: Form) =>
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");

  async function call(method: "GET" | "POST" | "DELETE", path: string, opts: { account?: string; body?: Form; json?: unknown; idempotencyKey?: string; v2?: boolean } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { authorization: `Bearer ${config.secretKey}`, "stripe-version": CARD_API_VERSION };
    if (opts.account) {
      if (!ACCOUNT_ID.test(opts.account)) throw new CardPaymentsError("That is not a payment account reference.", "bad_reference");
      headers["stripe-account"] = opts.account;
    }
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = form(opts.body);
    }
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey.slice(0, 255);
    const base = opts.v2 ? v2Base(config.apiBase) : config.apiBase;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new CardPaymentsError("The card payment service could not be reached. Try again.", "unreachable");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof json.livemode === "boolean" && json.livemode !== live) throw new CardPaymentsError("Refused: the card payment service answered in the wrong mode.", "wrong_mode");
    return { status: res.status, json };
  }
  async function ok(method: "GET" | "POST" | "DELETE", path: string, opts: Parameters<typeof call>[2] = {}): Promise<Record<string, unknown>> {
    const r = await call(method, path, opts);
    if (r.status < 200 || r.status >= 300) {
      const err = o(r.json.error);
      throw new CardPaymentsError("The card payment service refused the request.", String(err.code ?? `http_${r.status}`).slice(0, 40));
    }
    return r.json;
  }
  const feeField = (fee: number): Form => (fee > 0 ? { application_fee_amount: fee } : {});
  const metaFields = (prefix: string, m: Record<string, string>): Form => Object.fromEntries(Object.entries(m).map(([k, v]) => [`${prefix}[${k}]`, v]));
  const expandCharge = "expand[]=latest_charge";

  return {
    mode,
    async createAccount(input, idempotencyKey) {
      const display = `${live ? "" : "TEST – "}${input.clinicName}`.slice(0, 100);
      const json = {
        display_name: display,
        ...(input.email ? { contact_email: input.email } : {}),
        identity: { country: "gb" },
        dashboard: "full",
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { currency: "gbp", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        metadata: { tenant_id: input.tenantId, app: "clindesk" },
        include: ["configuration.merchant", "requirements", "identity"],
      };
      const raw = await ok("POST", "/core/accounts", { json, idempotencyKey, v2: true });
      if (!isAccountRef(raw.id)) throw new CardPaymentsError("The card payment service gave no account.", "no_account");
      return { id: raw.id, raw };
    },
    async getAccount(account) {
      if (!ACCOUNT_ID.test(account)) throw new CardPaymentsError("That is not a payment account reference.", "bad_reference");
      return ok("GET", `/core/accounts/${account}?include=configuration.merchant&include=requirements&include=identity`, { v2: true });
    },
    async onboardingLink(account, urls) {
      if (!ACCOUNT_ID.test(account)) throw new CardPaymentsError("That is not a payment account reference.", "bad_reference");
      const r = await ok("POST", "/core/account_links", {
        v2: true,
        json: { account, use_case: { type: "account_onboarding", account_onboarding: { refresh_url: urls.refreshUrl, return_url: urls.returnUrl } } },
      });
      const url = str(r.url);
      if (!url || !/^https:\/\//.test(url)) throw new CardPaymentsError("The card payment service gave no link.", "no_link");
      return url;
    },
    async closeAccount(account) {
      if (!ACCOUNT_ID.test(account)) throw new CardPaymentsError("That is not a payment account reference.", "bad_reference");
      await ok("POST", `/core/accounts/${account}/close`, { v2: true, json: { applied_configurations: ["merchant"] } });
    },
    async createLocation(account, input, idempotencyKey) {
      const r = await ok("POST", "/terminal/locations", {
        account,
        idempotencyKey,
        body: { display_name: input.displayName.slice(0, 100), "address[line1]": input.line1, "address[city]": input.city, "address[postal_code]": input.postcode, "address[country]": "GB" },
      });
      const id = str(r.id);
      if (!id) throw new CardPaymentsError("The card payment service gave no location.", "no_location");
      return id;
    },
    async registerReader(account, input) {
      need("tml", input.location);
      return readerInfo(await ok("POST", "/terminal/readers", { account, body: { registration_code: input.registrationCode, location: input.location, label: input.label.slice(0, 60) } }));
    },
    async getReader(account, reader) {
      return readerInfo(await ok("GET", `/terminal/readers/${need("tmr", reader)}`, { account }));
    },
    async deleteReader(account, reader) {
      const r = await call("DELETE", `/terminal/readers/${need("tmr", reader)}`, { account });
      if (r.status !== 404 && (r.status < 200 || r.status >= 300)) throw new CardPaymentsError("The card payment service refused the request.", `http_${r.status}`);
    },
    async processOnReader(account, reader, paymentIntent) {
      need("pi", paymentIntent);
      return readerInfo(await ok("POST", `/terminal/readers/${need("tmr", reader)}/process_payment_intent`, { account, body: { payment_intent: paymentIntent } }));
    },
    async cancelReaderAction(account, reader) {
      return readerInfo(await ok("POST", `/terminal/readers/${need("tmr", reader)}/cancel_action`, { account }));
    },
    async presentTestCard(account, reader, cardNumber) {
      if (live) throw new CardPaymentsError("A test card can only be presented in test mode.", "live_mode");
      const body: Form = cardNumber ? { type: "card_present", "card_present[number]": cardNumber } : {};
      return readerInfo(await ok("POST", `/test_helpers/terminal/readers/${need("tmr", reader)}/present_payment_method`, { account, body }));
    },
    async createReaderPayment(account, input, idempotencyKey) {
      const r = await ok("POST", "/payment_intents", {
        account,
        idempotencyKey,
        body: {
          amount: input.amountPence,
          currency: "gbp",
          "allowed_payment_method_types[]": "card_present",
          capture_method: "automatic",
          description: input.description.slice(0, 200),
          ...feeField(input.feePence),
          ...metaFields("metadata", input.metadata),
        },
      });
      return intentInfo(r);
    },
    async chargeSavedCard(account, input, idempotencyKey) {
      const r = await call("POST", "/payment_intents", {
        account,
        idempotencyKey,
        body: {
          amount: input.amountPence,
          currency: "gbp",
          customer: input.customer,
          payment_method: input.paymentMethod,
          off_session: true,
          confirm: true,
          "automatic_payment_methods[enabled]": true,
          "automatic_payment_methods[allow_redirects]": "never",
          "expand[]": "latest_charge",
          description: input.description.slice(0, 200),
          ...feeField(input.feePence),
          ...metaFields("metadata", input.metadata),
        },
      });
      if (r.status >= 200 && r.status < 300) {
        const pi = intentInfo(r.json);
        return pi.status === "succeeded" ? { ok: true, intent: pi } : { ok: false, code: pi.status === "requires_action" ? "authentication_required" : pi.status.slice(0, 40) || "not_paid", intent: pi };
      }
      if (r.status === 402 || r.status === 400) {
        const err = o(r.json.error);
        const pi = Object.keys(o(err.payment_intent)).length ? intentInfo(o(err.payment_intent)) : null;
        return { ok: false, code: String(err.decline_code ?? err.code ?? "card_declined").slice(0, 40), intent: pi };
      }
      throw new CardPaymentsError("The card payment service refused the request.", `http_${r.status}`);
    },
    async getPaymentIntent(account, id) {
      return intentInfo(await ok("GET", `/payment_intents/${need("pi", id)}?${expandCharge}`, { account }));
    },
    async cancelPaymentIntent(account, id) {
      return intentInfo(await ok("POST", `/payment_intents/${need("pi", id)}/cancel`, { account }));
    },
    async findPaymentsForIntent(account, cardIntentId) {
      if (!/^[a-z]+_[0-9A-Z]{26}$/.test(cardIntentId)) return [];
      const q = encodeURIComponent(`metadata['card_intent_id']:'${cardIntentId}'`);
      const r = await ok("GET", `/payment_intents/search?query=${q}&limit=10`, { account });
      return (Array.isArray(r.data) ? r.data : []).map((x) => intentInfo(o(x)));
    },
    async createCustomer(account, input, idempotencyKey) {
      // Nothing about the patient but our own ids: no name, no email, no address.
      const r = await ok("POST", "/customers", { account, idempotencyKey, body: { "metadata[tenant_id]": input.tenantId, "metadata[patient_id]": input.patientId, "metadata[app]": "clindesk" } });
      const id = str(r.id);
      if (!id) throw new CardPaymentsError("The card payment service gave no customer.", "no_customer");
      return id;
    },
    async createPaymentCheckout(account, input, idempotencyKey) {
      return checkoutInfo(
        await ok("POST", "/checkout/sessions", {
          account,
          idempotencyKey,
          body: {
            mode: "payment",
            locale: "en-GB",
            "line_items[0][quantity]": 1,
            "line_items[0][price_data][currency]": "gbp",
            "line_items[0][price_data][unit_amount]": input.amountPence,
            "line_items[0][price_data][product_data][name]": input.lineName.slice(0, 200),
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            ...(input.feePence > 0 ? { "payment_intent_data[application_fee_amount]": input.feePence } : {}),
            ...metaFields("metadata", input.metadata),
            ...metaFields("payment_intent_data[metadata]", input.metadata),
          },
        }),
      );
    },
    async createSetupCheckout(account, input, idempotencyKey) {
      need("cus", input.customer);
      return checkoutInfo(
        await ok("POST", "/checkout/sessions", {
          account,
          idempotencyKey,
          body: {
            mode: "setup",
            currency: "gbp",
            locale: "en-GB",
            customer: input.customer,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            ...metaFields("metadata", input.metadata),
            ...metaFields("setup_intent_data[metadata]", input.metadata),
          },
        }),
      );
    },
    async getCheckout(account, id) {
      return checkoutInfo(await ok("GET", `/checkout/sessions/${need("cs", id)}`, { account }));
    },
    async expireCheckout(account, id) {
      const r = await call("POST", `/checkout/sessions/${need("cs", id)}/expire`, { account });
      if (r.status >= 500) throw new CardPaymentsError("The card payment service refused the request.", `http_${r.status}`);
    },
    async getSetupIntent(account, id) {
      return setupInfo(await ok("GET", `/setup_intents/${need("seti", id)}`, { account }));
    },
    async getCard(account, paymentMethod) {
      const pm = await ok("GET", `/payment_methods/${need("pm", paymentMethod)}`, { account });
      const card = o(pm.card);
      if (!str(card.last4)) throw new CardPaymentsError("The card payment service gave no card.", "no_card");
      return { brand: (str(card.brand) ?? "card").slice(0, 20), last4: String(card.last4), expMonth: n(card.exp_month), expYear: n(card.exp_year), customer: idOf(pm.customer) };
    },
    async detachCard(account, paymentMethod) {
      const r = await call("POST", `/payment_methods/${need("pm", paymentMethod)}/detach`, { account });
      if (r.status >= 500) throw new CardPaymentsError("The card payment service refused the request.", `http_${r.status}`);
    },
    async createRefund(account, input, idempotencyKey) {
      need("pi", input.paymentIntent);
      return refundInfo(
        await ok("POST", "/refunds", {
          account,
          idempotencyKey,
          body: { payment_intent: input.paymentIntent, amount: input.amountPence, ...(input.refundPlatformFee ? { refund_application_fee: true } : {}), ...metaFields("metadata", input.metadata) },
        }),
      );
    },
    async getRefund(account, id) {
      return refundInfo(await ok("GET", `/refunds/${need("re", id)}`, { account }));
    },
    async getBalance(account) {
      const b = await ok("GET", "/balance", { account });
      const sum = (list: unknown) => (Array.isArray(list) ? list : []).map(o).filter((x) => x.currency === "gbp").reduce((a, x) => a + (n(x.amount) ?? 0), 0);
      return { available: sum(b.available), pending: sum(b.pending) };
    },
    async listPayouts(account, limit) {
      const r = await ok("GET", `/payouts?limit=${Math.max(1, Math.min(50, limit))}`, { account });
      return (Array.isArray(r.data) ? r.data : []).map(o).map((p) => ({ id: String(p.id ?? ""), amount: n(p.amount) ?? 0, arrivalDate: n(p.arrival_date) ?? 0, status: String(p.status ?? "") }));
    },
    async listBalanceLines(account, input) {
      const q = [`limit=${Math.max(1, Math.min(100, input.limit))}`, "expand[]=data.source"];
      if (input.payout) q.push(`payout=${need("po", input.payout)}`);
      const r = await ok("GET", `/balance_transactions?${q.join("&")}`, { account });
      return (Array.isArray(r.data) ? r.data : []).map(o).map((t) => {
        const details = (Array.isArray(t.fee_details) ? t.fee_details : []).map(o);
        const platformFee = details.filter((d) => d.type === "application_fee").reduce((a, d) => a + (n(d.amount) ?? 0), 0);
        const providerFee = details.filter((d) => d.type !== "application_fee").reduce((a, d) => a + (n(d.amount) ?? 0), 0);
        const source = o(t.source);
        return {
          id: String(t.id ?? ""),
          type: String(t.type ?? ""),
          amount: n(t.amount) ?? 0,
          fee: n(t.fee) ?? 0,
          platformFee,
          providerFee,
          net: n(t.net) ?? 0,
          availableOn: n(t.available_on) ?? 0,
          paymentIntent: idOf(source.payment_intent),
        };
      });
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Configuration
 * ----------------------------------------------------------------------------------------------*/

export interface ConnectConfig {
  api: ConnectApi;
  mode: "test" | "live";
  /** Signing secrets accepted by the connected-accounts webhook (snapshot events, and the accounts' thin events). */
  webhookSecrets: string[];
}

/**
 * The connected-accounts configuration from env, or why card payments are off (plain words, no values). The key is
 * the ClinDesk payment account's own (cardPaymentsConfig); the webhook has its OWN endpoint and secrets:
 *   STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET   events from connected accounts (payments, refunds, disputes, set-ups)
 *   STRIPE_CLINDESK_ACCOUNTS_WEBHOOK_SECRET  optional: the accounts' own thin events (requirements, capabilities)
 */
export function connectConfig(env: Env = process.env, fetchImpl?: Fetch): { ok: true; config: ConnectConfig } | { ok: false; reason: string } {
  const base = cardPaymentsConfig(env);
  if (!base.ok) return { ok: false, reason: base.reason.replace("for text credits ", "") };
  const secrets = [env.STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET, env.STRIPE_CLINDESK_ACCOUNTS_WEBHOOK_SECRET].map((s) => (s ?? "").trim()).filter((s) => s.length >= 16);
  const cfg: CardPaymentsConfig = base.config;
  return { ok: true, config: { api: createConnectApi(cfg, fetchImpl), mode: cfg.mode ?? (cfg.live ? "live" : "test"), webhookSecrets: secrets } };
}
