/**
 * The card payment webhook for text credits (POST /api/clinic-messages/credit-payments – a thin route over this):
 *
 * - 503 when card payments or the endpoint's signing secret are not set up (closed, never open);
 * - 400 unless the request carries a valid signature (HMAC-SHA256 over "t.payload" with the signing secret,
 *   within 5 minutes – ./card-payments.ts verifyWebhookSignature);
 * - the event body is never trusted on its own: the checkout session or payment is RE-READ from the provider with
 *   the clinic system's own key, then checked against the clinic (./service.ts) and credited once – idempotent by
 *   the event id (recorded in the credit's own batch) and by the payment reference;
 * - 200 for every event it has handled or does not need (so the provider stops sending it); 502 when the provider
 *   could not be reached to re-read (the provider retries the event later).
 *
 * - a payment REFUSED after the re-read (another clinic's customer, an amount or pack that does not match, an unknown
 *   clinic) is still answered 200 (a retry would give the same answer), but it raises a payment alert: an audit row
 *   under the platform and an email to the platform administrators (src/server/billing/payment-alerts.ts).
 *
 * Handled: checkout.session.completed, checkout.session.async_payment_succeeded (a pack bought or a card saved),
 * payment_intent.succeeded (a pack bought through checkout or an automatic top-up).
 */
import { CardPaymentsError, verifyWebhookSignature, type CardPayments, type CardPaymentsConfig } from "./card-payments";
import { fulfilCheckout, fulfilPaymentIntent, type FulfilResult } from "./service";
import type { DbContext } from "../../../repos/pms/context";
import type { PaymentAlerter } from "../../../billing/payment-alerts";

export const CREDIT_WEBHOOK_PATH = "/api/clinic-messages/credit-payments";
const MAX_BODY = 256 * 1024;

export interface CreditWebhookDeps {
  config: () => { ok: true; config: CardPaymentsConfig } | { ok: false; reason: string };
  payments: (config: CardPaymentsConfig) => CardPayments;
  ctx: () => DbContext;
  /** Wall-clock seconds (the provider signs with real time – never the clinic system's test clock). */
  nowSeconds?: () => number;
  log?: (entry: Record<string, string | number | boolean | null>) => void;
  /** A paid payment that was refused (review fix 31/10/2026). */
  alert?: PaymentAlerter;
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleCreditWebhook(req: Request, deps: CreditWebhookDeps): Promise<Response> {
  const log = deps.log ?? ((e) => console.info(JSON.stringify({ event: "sms_credits.webhook", ...e })));
  const cfg = deps.config();
  if (!cfg.ok || !cfg.config.webhookSecret) return json(503, { error: "not_configured" });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json(413, { error: "too_large" });
  const payload = await req.text();
  if (payload.length > MAX_BODY) return json(413, { error: "too_large" });
  const now = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  if (!verifyWebhookSignature(payload, req.headers.get("stripe-signature"), cfg.config.webhookSecret, now)) {
    log({ outcome: "bad_signature" });
    return json(400, { error: "bad_signature" });
  }
  let event: { id?: unknown; type?: unknown; livemode?: unknown; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json(400, { error: "bad_payload" });
  }
  const eventId = typeof event.id === "string" && /^evt_[A-Za-z0-9_]{1,120}$/.test(event.id) ? event.id : null;
  const type = typeof event.type === "string" ? event.type : "";
  const objectId = typeof event.data?.object?.id === "string" ? (event.data.object.id as string) : null;
  if (!eventId || !objectId) return json(400, { error: "bad_payload" });
  if (event.livemode !== cfg.config.live) {
    log({ outcome: "wrong_mode", type });
    return json(200, { received: true, result: "ignored" });
  }
  const payments = deps.payments(cfg.config);
  const ctx = deps.ctx();
  let result: FulfilResult;
  try {
    if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      result = await fulfilCheckout(ctx, payments, await payments.getCheckoutSession(objectId), { eventId, eventType: type });
    } else if (type === "payment_intent.succeeded") {
      result = await fulfilPaymentIntent(ctx, payments, await payments.getPaymentIntent(objectId), { eventId, eventType: type });
    } else {
      return json(200, { received: true, result: "ignored" });
    }
  } catch (err) {
    if (err instanceof CardPaymentsError) {
      log({ outcome: "provider_error", type, code: err.code });
      return json(502, { error: "provider_unavailable" });
    }
    log({ outcome: "error", type });
    return json(500, { error: "failed" });
  }
  log({ outcome: result.status, type, why: "why" in result ? result.why : null });
  if (result.status === "refused" && deps.alert) {
    const o = event.data?.object ?? {};
    const md = (o.metadata && typeof o.metadata === "object" ? o.metadata : {}) as Record<string, unknown>;
    await deps
      .alert({ area: "text_credits", eventType: type, eventId, objectId, tenantId: typeof md.tenant_id === "string" ? md.tenant_id : null, why: result.why })
      .catch(() => undefined);
  }
  return json(200, { received: true, result: result.status });
}
