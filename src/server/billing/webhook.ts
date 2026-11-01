/**
 * ONE webhook for the ClinDesk payment account (31/10/2026): POST /api/billing/stripe-webhook – subscriptions AND text
 * credits. The old text-credit address /api/clinic-messages/credit-payments is an alias of this same handler (an
 * endpoint registered there keeps working; register the new one at go-live – BILLING.md).
 *
 * - 503 until card payments and the signing secret (STRIPE_CLINDESK_WEBHOOK_SECRET) are set; 400 unless the signature
 *   is valid (HMAC-SHA256 over "t.payload", 5 minutes);
 * - the event body is never trusted: the checkout, subscription, invoice or payment is RE-READ with our own key;
 * - subscriptions: customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed,
 *   checkout.session.completed / async_payment_succeeded / async_payment_failed (mode subscription) → ./sync.ts
 *   (idempotent – it applies the subscription's current state); invoice.created (a renewal) → extra reports
 *   (./extras.ts, once per month);
 * - text credits: checkout.session.completed / async_payment_succeeded (mode payment / setup) and
 *   payment_intent.succeeded → src/server/pms/comms/credits/service.ts (credited once by event and payment);
 * - 200 for everything handled or not needed; 502 when the payment service cannot be reached to re-read (it retries);
 *   a PAID payment that is refused is answered 200 but raises a payment alert (src/server/billing/payment-alerts.ts).
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import type { DbContext } from "../repos/pms/context";
import { findSubscriptionByRef } from "../repos/clinic-subscription";
import { CardPaymentsError, verifyWebhookSignature, type CardPayments, type CardPaymentsConfig } from "../pms/comms/credits/card-payments";
import { fulfilCheckout, fulfilPaymentIntent, type FulfilResult } from "../pms/comms/credits/service";
import type { PaymentAlerter } from "./payment-alerts";
import { billExtraReports } from "./extras";
import type { SubscriptionPayments } from "./payments";
import { syncSubscription, type SyncDeps, type SyncResult } from "./sync";

export const BILLING_WEBHOOK_PATH = "/api/billing/stripe-webhook";
const MAX_BODY = 256 * 1024;

/** The events to register on the endpoint (BILLING.md). */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
] as const;

export interface BillingWebhookDeps {
  config: () => { ok: true; config: CardPaymentsConfig } | { ok: false; reason: string };
  credits: (config: CardPaymentsConfig) => CardPayments;
  subscriptions: (config: CardPaymentsConfig) => SubscriptionPayments;
  /** Text credits' repositories (database + clock). */
  ctx: () => DbContext;
  db: () => Kysely<Database>;
  notify?: SyncDeps["notify"];
  alert?: PaymentAlerter;
  now?: () => Date;
  /** Wall-clock seconds for the signature (never a test clock). */
  nowSeconds?: () => number;
  log?: (entry: Record<string, string | number | boolean | null>) => void;
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const SUBSCRIPTION_EVENTS = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);
const INVOICE_SYNC_EVENTS = new Set(["invoice.paid", "invoice.payment_failed"]);
const CHECKOUT_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"]);

export async function handleBillingWebhook(req: Request, deps: BillingWebhookDeps): Promise<Response> {
  const log = deps.log ?? ((e) => console.info(JSON.stringify({ event: "billing.webhook", ...e })));
  const cfg = deps.config();
  if (!cfg.ok || !cfg.config.webhookSecret) return json(503, { error: "not_configured" });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json(413, { error: "too_large" });
  const payload = await req.text();
  if (payload.length > MAX_BODY) return json(413, { error: "too_large" });
  const nowS = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  if (!verifyWebhookSignature(payload, req.headers.get("stripe-signature"), cfg.config.webhookSecret, nowS)) {
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
  const subs = deps.subscriptions(cfg.config);
  const syncDeps: SyncDeps = {
    db: deps.db(),
    now: deps.now,
    notify: deps.notify ?? null,
    alert: deps.alert ? (a) => deps.alert!({ area: "subscription", eventType: type, eventId, objectId: a.subscriptionId, tenantId: a.tenantId, why: a.why }) : null,
  };
  const md = (event.data?.object?.metadata && typeof event.data.object.metadata === "object" ? event.data.object.metadata : {}) as Record<string, unknown>;
  const creditAlert = async (r: FulfilResult) => {
    if (r.status === "refused" && deps.alert) {
      await deps.alert({ area: "text_credits", eventType: type, eventId, objectId, tenantId: typeof md.tenant_id === "string" ? md.tenant_id : null, why: r.why }).catch(() => undefined);
    }
  };
  let result: string;
  try {
    if (SUBSCRIPTION_EVENTS.has(type)) {
      result = outcomeOf(await syncSubscription(syncDeps, subs, objectId, { eventId }));
    } else if (INVOICE_SYNC_EVENTS.has(type) || type === "invoice.created") {
      const invoice = await subs.getInvoice(objectId);
      if (!invoice.subscription) {
        result = "ignored";
      } else if (type === "invoice.created") {
        const sub = await findSubscriptionByRef({ db: syncDeps.db }, invoice.subscription);
        if (!sub || sub.customerRef !== invoice.customer) result = "ignored";
        else {
          const r = await billExtraReports(syncDeps, subs, sub, invoice);
          result = r.billed.length ? `extras_billed_${r.billed.length}` : "no_extras";
        }
      } else {
        result = outcomeOf(await syncSubscription(syncDeps, subs, invoice.subscription, { eventId }));
      }
    } else if (CHECKOUT_EVENTS.has(type)) {
      const session = await subs.getCheckout(objectId);
      if (session.mode === "subscription") {
        if (session.metadata.kind !== "subscription" || !session.subscription) result = "ignored";
        else result = outcomeOf(await syncSubscription(syncDeps, subs, session.subscription, { eventId, expectTenantId: session.clientReferenceId }));
      } else if (type === "checkout.session.async_payment_failed") {
        result = "ignored";
      } else {
        const credits = deps.credits(cfg.config);
        const r = await fulfilCheckout(deps.ctx(), credits, await credits.getCheckoutSession(objectId), { eventId, eventType: type });
        await creditAlert(r);
        result = r.status;
      }
    } else if (type === "payment_intent.succeeded") {
      const credits = deps.credits(cfg.config);
      const r = await fulfilPaymentIntent(deps.ctx(), credits, await credits.getPaymentIntent(objectId), { eventId, eventType: type });
      // A subscription's payment is not a text credit: "ignored" is right, no alert.
      if (r.status === "refused") await creditAlert(r);
      result = r.status;
    } else {
      result = "ignored";
    }
  } catch (err) {
    if (err instanceof CardPaymentsError) {
      log({ outcome: "provider_error", type, code: err.code });
      return json(502, { error: "provider_unavailable" });
    }
    log({ outcome: "error", type, error: err instanceof Error ? err.name : "error" });
    return json(500, { error: "failed" });
  }
  log({ outcome: result, type });
  return json(200, { received: true, result });
}

function outcomeOf(r: SyncResult): string {
  return r.status === "synced" ? `synced_${r.subscription.state}` : r.status === "refused" ? `refused_${r.why}` : "ignored";
}
