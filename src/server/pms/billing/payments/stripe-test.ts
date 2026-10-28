/**
 * Stripe Payment Links in TEST MODE ONLY, over Stripe's REST API with fetch (no SDK, no new dependency).
 *
 * - The key must be a test key ("sk_test_…" or a restricted "rk_test_…"); anything else is refused before any
 *   request – no live key can be used from this code. Keys come from env (CLINIC_STRIPE_TEST_SECRET_KEY), never git.
 * - Per CLAUDE.md each product has its own Stripe account: the clinic system needs its own (sandbox first); never
 *   the PigeonPro, DutyDesk or Starwrit accounts.
 * - A link: a one-off Price (GBP, the invoice's balance, product name "Invoice RIV00042 – <clinic>") and a Payment
 *   Link for it, limited to one completed payment, with the clinic and invoice ids in its metadata. Nothing
 *   clinical goes to Stripe.
 * - Paid sessions: GET /v1/checkout/sessions?payment_link=… (status complete, payment_status paid).
 */
import { ukToday } from "../../../../modules/pms/core/text";
import { PaymentProviderError, type CardCharge, type CreateLinkInput, type CreatedLink, type PaidSession, type PaymentLinkProvider, type SavedCardRef } from "./provider";
import { pmsNowMs } from "../../../../modules/pms/core/clock";

const API = "https://api.stripe.com/v1";

/**
 * The API base: Stripe's, or – for local end-to-end runs only – a stand-in on THIS machine
 * (CLINIC_STRIPE_TEST_API_BASE=http://127.0.0.1:<port>/v1). Anything that is not Stripe's own host or a loopback
 * address is refused, so the override can never send a key elsewhere.
 */
export function stripeApiBase(override: string | undefined): string {
  if (!override) return API;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new PaymentProviderError("Refused: the payment provider address is not a web address.");
  }
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  const stripe = url.protocol === "https:" && url.hostname === "api.stripe.com";
  if (!loopback && !stripe) throw new PaymentProviderError("Refused: the payment provider address must be Stripe's or this machine's.");
  return override.replace(/\/+$/, "");
}
export const TEST_KEY_PATTERN = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function form(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export function createStripeTestProvider(secretKey: string, fetchImpl: Fetch = (url, init) => fetch(url, init), apiBase: string = API): PaymentLinkProvider {
  if (!TEST_KEY_PATTERN.test(secretKey)) {
    throw new PaymentProviderError("Refused: the payment provider key is not a TEST key. Only test mode is allowed.");
  }
  const base = stripeApiBase(apiBase === API ? undefined : apiBase);
  const call = async (method: "GET" | "POST", path: string, body?: Record<string, string | number>, idempotencyKey?: string): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { authorization: `Bearer ${secretKey}` };
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body: body ? form(body) : undefined, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new PaymentProviderError("The payment provider could not be reached. Try again.");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new PaymentProviderError("The payment provider refused the request.");
    if (json.livemode === true) throw new PaymentProviderError("Refused: the payment provider answered in live mode.");
    return json;
  };

  return {
    id: "stripe",
    mode: "test",
    configured: true,
    unavailableReason: null,
    async createLink(input: CreateLinkInput): Promise<CreatedLink> {
      if (!Number.isInteger(input.amountPence) || input.amountPence < 30) throw new PaymentProviderError("The amount is too small for a card payment.");
      const name = `Invoice ${input.invoiceNumber} – ${input.clinicName}`.slice(0, 250);
      const price = await call("POST", "/prices", { currency: "gbp", unit_amount: input.amountPence, "product_data[name]": name }, `${input.idempotencyKey}-price`);
      if (typeof price.id !== "string") throw new PaymentProviderError("The payment provider gave no price.");
      const link = await call(
        "POST",
        "/payment_links",
        {
          "line_items[0][price]": price.id,
          "line_items[0][quantity]": 1,
          "restrictions[completed_sessions][limit]": 1,
          "metadata[tenant_id]": input.tenantId,
          "metadata[invoice_id]": input.invoiceId,
          "payment_intent_data[metadata][invoice_id]": input.invoiceId,
        },
        `${input.idempotencyKey}-link`,
      );
      if (typeof link.id !== "string" || typeof link.url !== "string" || !/^https:\/\//.test(link.url)) throw new PaymentProviderError("The payment provider gave no link.");
      return { providerLinkId: link.id, url: link.url };
    },
    async listPaidSessions(providerLinkId: string): Promise<PaidSession[]> {
      const list = await call("GET", `/checkout/sessions?payment_link=${encodeURIComponent(providerLinkId)}&status=complete&limit=20`);
      const data = Array.isArray(list.data) ? (list.data as Record<string, unknown>[]) : [];
      return data
        .filter((s) => s.payment_status === "paid" && typeof s.id === "string" && typeof s.amount_total === "number")
        .map((s) => ({ sessionId: s.id as string, amountPence: s.amount_total as number, paidOn: ukToday(new Date(typeof s.created === "number" ? s.created * 1000 : pmsNowMs())) }));
    },
    async deactivate(providerLinkId: string): Promise<void> {
      await call("POST", `/payment_links/${encodeURIComponent(providerLinkId)}`, { active: "false" });
    },
    async saveTestCard(input): Promise<SavedCardRef> {
      // Test mode: a customer with the provider's own test card "pm_card_visa" (no card number ever passes here).
      const customer = await call("POST", "/customers", { "metadata[tenant_id]": input.tenantId, "metadata[patient_id]": input.patientId }, `${input.idempotencyKey}-customer`);
      if (typeof customer.id !== "string") throw new PaymentProviderError("The payment provider gave no customer.");
      const pm = await call("POST", "/payment_methods/pm_card_visa/attach", { customer: customer.id }, `${input.idempotencyKey}-attach`);
      const card = (pm.card ?? {}) as Record<string, unknown>;
      if (typeof pm.id !== "string" || typeof card.last4 !== "string") throw new PaymentProviderError("The payment provider gave no card.");
      return {
        customerRef: customer.id,
        methodRef: pm.id,
        brand: typeof card.brand === "string" ? card.brand.slice(0, 20) : "card",
        last4: card.last4,
        expMonth: typeof card.exp_month === "number" ? card.exp_month : 12,
        expYear: typeof card.exp_year === "number" ? card.exp_year : 2030,
      };
    },
    async chargeSavedCard(input): Promise<CardCharge> {
      if (!Number.isInteger(input.amountPence) || input.amountPence < 30) throw new PaymentProviderError("The amount is too small for a card payment.");
      const pi = await call(
        "POST",
        "/payment_intents",
        { amount: input.amountPence, currency: "gbp", customer: input.customerRef, payment_method: input.methodRef, confirm: "true", off_session: "true", description: input.description.slice(0, 200) },
        input.idempotencyKey,
      );
      if (typeof pi.id !== "string" || pi.status !== "succeeded") throw new PaymentProviderError("The card was declined. Nothing was taken.");
      return { chargeRef: pi.id, amountPence: typeof pi.amount === "number" ? pi.amount : input.amountPence };
    },
    async refund(input): Promise<{ refundRef: string }> {
      // A payment link's reference is its checkout session: refund the payment behind it.
      let intent = input.chargeRef;
      if (intent.startsWith("cs_")) {
        const session = await call("GET", `/checkout/sessions/${encodeURIComponent(intent)}`);
        if (typeof session.payment_intent !== "string") throw new PaymentProviderError("The payment provider has no payment for that reference.");
        intent = session.payment_intent;
      }
      const r = await call("POST", "/refunds", { payment_intent: intent, amount: input.amountPence }, input.idempotencyKey);
      if (typeof r.id !== "string") throw new PaymentProviderError("The payment provider gave no refund.");
      return { refundRef: r.id };
    },
  };
}
