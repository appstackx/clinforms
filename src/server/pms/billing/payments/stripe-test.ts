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
import { PaymentProviderError, type CreateLinkInput, type CreatedLink, type PaidSession, type PaymentLinkProvider } from "./provider";

const API = "https://api.stripe.com/v1";
export const TEST_KEY_PATTERN = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function form(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export function createStripeTestProvider(secretKey: string, fetchImpl: Fetch = (url, init) => fetch(url, init)): PaymentLinkProvider {
  if (!TEST_KEY_PATTERN.test(secretKey)) {
    throw new PaymentProviderError("Refused: the payment provider key is not a TEST key. Only test mode is allowed.");
  }
  const call = async (method: "GET" | "POST", path: string, body?: Record<string, string | number>, idempotencyKey?: string): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { authorization: `Bearer ${secretKey}` };
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${API}${path}`, { method, headers, body: body ? form(body) : undefined, signal: AbortSignal.timeout(15_000) });
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
        .map((s) => ({ sessionId: s.id as string, amountPence: s.amount_total as number, paidOn: ukToday(new Date(typeof s.created === "number" ? s.created * 1000 : Date.now())) }));
    },
    async deactivate(providerLinkId: string): Promise<void> {
      await call("POST", `/payment_links/${encodeURIComponent(providerLinkId)}`, { active: "false" });
    },
  };
}
