/**
 * POST /api/billing/connect-webhook – events from the clinics' CONNECTED payment accounts (card payments,
 * docs/clinic-system/card-payments.md). Separate from the platform's own webhook (/api/billing/stripe-webhook –
 * subscriptions and text credits), with its own signing secret(s); that one is untouched.
 *
 * - 404 while the platform switch CLINFORMS_CARD_PAYMENTS is off; 503 until a signing secret is set; 400 unless the
 *   signature is valid (HMAC-SHA256 over "t.payload", 5 minutes) against one of the configured secrets;
 * - the clinic comes from the ACCOUNT the event names (event.account for snapshot events, related_object for the
 *   accounts' thin v2 events) – an account no clinic has is answered 200 "ignored";
 * - the event body is never trusted: every object is RE-READ from that clinic's account with our key, and our own
 *   objects carry the clinic and intent ids in their metadata (checked);
 * - idempotent: a handled event id is noted per clinic and a repeat answers at once; and every payment / refund is
 *   recorded through the one exactly-once path (its provider reference is unique per clinic), so duplicate or
 *   out-of-order deliveries (a refund before its payment, a checkout after its payment intent) never double-count;
 * - 200 for everything handled or not needed; 502 when the provider cannot be reached to re-read (it retries).
 */
import { accountStateOf, cardPaymentsSwitchOn } from "../../../../modules/pms/billing/card-payments";
import { pmsAudit, type RepoContext } from "../../../repos/pms/context";
import { CardPaymentsError, verifyWebhookSignature } from "../../comms/credits/card-payments";
import {
  createRefundIntent,
  eventHandled,
  findIntentByRef,
  findMandateBySetupRef,
  findTenantByAccount,
  getCardSettings,
  getIntent,
  noteEvent,
  setIntentRefs,
  syncAccountState,
} from "../../../repos/pms/billing/card-payments";
import type { ConnectConfig } from "./client";
import { SYSTEM_ACTOR, completeSaveCard, recordIntentRefund, refundFailed, settleIntent } from "./service";

export const CONNECT_WEBHOOK_PATH = "/api/billing/connect-webhook";
const MAX_BODY = 256 * 1024;

/** The connected-account events to register (Workbench → event destination, "Connected accounts", snapshot). */
export const CONNECT_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "setup_intent.succeeded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "account.updated",
] as const;

/** The accounts' own thin events (a second destination, "Your account", thin payload – optional). */
export const ACCOUNT_THIN_EVENTS = ["v2.core.account[requirements].updated", "v2.core.account[configuration.merchant].capability_status_updated", "v2.core.account.closed"] as const;

export interface ConnectWebhookDeps {
  switchOn: boolean;
  config: { ok: true; config: ConnectConfig } | { ok: false; reason: string };
  ctx: () => RepoContext;
  nowSeconds?: () => number;
  log?: (entry: Record<string, string | number | boolean | null>) => void;
}

export function connectWebhookDeps(env: Readonly<Record<string, string | undefined>>, ctx: () => RepoContext, config: ConnectWebhookDeps["config"]): ConnectWebhookDeps {
  return { switchOn: cardPaymentsSwitchOn(env), config, ctx };
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function handleConnectWebhook(req: Request, deps: ConnectWebhookDeps): Promise<Response> {
  const log = deps.log ?? ((e) => console.info(JSON.stringify({ event: "billing.connect_webhook", ...e })));
  if (!deps.switchOn) return json(404, { error: "not_found" });
  if (!deps.config.ok || deps.config.config.webhookSecrets.length === 0) return json(503, { error: "not_configured" });
  const cfg = deps.config.config;
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json(413, { error: "too_large" });
  const payload = await req.text();
  if (payload.length > MAX_BODY) return json(413, { error: "too_large" });
  const nowS = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  const sig = req.headers.get("stripe-signature");
  if (!cfg.webhookSecrets.some((secret) => verifyWebhookSignature(payload, sig, secret, nowS))) {
    log({ outcome: "bad_signature" });
    return json(400, { error: "bad_signature" });
  }
  let event: Record<string, unknown>;
  try {
    event = o(JSON.parse(payload));
  } catch {
    return json(400, { error: "bad_payload" });
  }
  const eventId = s(event.id);
  const type = s(event.type) ?? "";
  if (!eventId || !/^evt_[A-Za-z0-9_]{1,120}$/.test(eventId) || !type) return json(400, { error: "bad_payload" });
  if (event.livemode !== (cfg.mode === "live")) {
    log({ outcome: "wrong_mode", type });
    return json(200, { received: true, result: "ignored" });
  }
  const thin = event.object === "v2.core.event";
  const accountRef = thin ? s(o(event.related_object).id) : s(event.account);
  const objectId = thin ? accountRef : s(o(o(event.data).object).id);
  if (!accountRef || !objectId) {
    log({ outcome: "no_account", type });
    return json(200, { received: true, result: "ignored" });
  }
  const ctx = deps.ctx();
  const tenantId = await findTenantByAccount(ctx, accountRef);
  if (!tenantId) {
    log({ outcome: "unknown_account", type });
    return json(200, { received: true, result: "ignored" });
  }
  if (await eventHandled(ctx, tenantId, eventId)) return json(200, { received: true, result: "duplicate" });
  let result: string;
  try {
    result = await dispatch(ctx, tenantId, accountRef, type, objectId, thin, cfg);
  } catch (err) {
    if (err instanceof CardPaymentsError) {
      log({ outcome: "provider_error", type, code: err.code });
      return json(502, { error: "provider_unavailable" });
    }
    log({ outcome: "error", type, error: err instanceof Error ? err.name : "error" });
    return json(500, { error: "failed" });
  }
  await noteEvent(ctx, tenantId, { eventId, type, objectRef: objectId, outcome: result }).catch(() => undefined);
  log({ outcome: result, type });
  return json(200, { received: true, result });
}

async function dispatch(ctx: RepoContext, tenantId: string, account: string, type: string, objectId: string, thin: boolean, cfg: ConnectConfig): Promise<string> {
  const api = cfg.api;
  const settings = await getCardSettings(ctx, tenantId);
  if (settings.accountRef !== account) return "ignored";

  if (thin || type === "account.updated") {
    const state = accountStateOf(await api.getAccount(account));
    const r = await syncAccountState(ctx, tenantId, account, state);
    return r.changed ? `account_${state.status}` : "account_synced";
  }

  if (type.startsWith("payment_intent.")) {
    const pi = await api.getPaymentIntent(account, objectId);
    const intentId = pi.metadata.card_intent_id;
    if (pi.metadata.tenant_id !== tenantId || !intentId) return "ignored";
    const intent = await getIntent(ctx, tenantId, intentId);
    if (!intent || intent.kind !== "payment") return "ignored";
    if (!intent.intentRef) await setIntentRefs(ctx, tenantId, intent.id, { intentRef: pi.id });
    const r = await settleIntent(ctx, tenantId, api, account, { ...intent, intentRef: pi.id });
    return r.outcome ? r.outcome.status : `intent_${r.intent.status}`;
  }

  if (type.startsWith("checkout.session.")) {
    const cs = await api.getCheckout(account, objectId);
    if (cs.metadata.tenant_id !== tenantId) return "ignored";
    if (cs.mode === "setup") {
      const m = cs.metadata.mandate_id ? await findMandateBySetupRef(ctx, tenantId, cs.id) : null;
      if (!m || m.id !== cs.metadata.mandate_id) return "ignored";
      return `card_${await completeSaveCard(ctx, tenantId, api, account, m.id)}`;
    }
    const intent = cs.metadata.card_intent_id ? await getIntent(ctx, tenantId, cs.metadata.card_intent_id) : null;
    if (!intent || intent.checkoutRef !== cs.id) return "ignored";
    const r = await settleIntent(ctx, tenantId, api, account, intent);
    return r.outcome ? r.outcome.status : `intent_${r.intent.status}`;
  }

  if (type === "setup_intent.succeeded") {
    const si = await api.getSetupIntent(account, objectId);
    if (si.metadata.tenant_id !== tenantId || !si.metadata.mandate_id) return "ignored";
    return `card_${await completeSaveCard(ctx, tenantId, api, account, si.metadata.mandate_id, SYSTEM_ACTOR, si.id)}`;
  }

  if (type.startsWith("refund.")) {
    const refund = await api.getRefund(account, objectId);
    if (refund.status === "failed" || refund.status === "canceled") return (await refundFailed(ctx, tenantId, refund.id)) ? "refund_reversed" : "refund_failed";
    if (!refund.paymentIntent) return "ignored";
    // Our refund (from the invoice screen): its intent row is named in the metadata.
    let intent = refund.metadata.card_intent_id && refund.metadata.tenant_id === tenantId ? await getIntent(ctx, tenantId, refund.metadata.card_intent_id) : null;
    if (intent && (intent.kind !== "refund" || intent.parentRef !== refund.paymentIntent)) return "ignored";
    if (!intent) {
      // A refund made outside the clinic system (the clinic's own payment dashboard) of a payment we recorded:
      // recorded too (so takings stay true), on the patient's account – the invoice screen shows it to credit.
      intent = await findIntentByRef(ctx, tenantId, refund.id);
      if (!intent) {
        const parent = await findIntentByRef(ctx, tenantId, refund.paymentIntent);
        if (!parent || parent.kind !== "payment" || !parent.invoiceId) return "ignored";
        if (parent.status !== "succeeded") {
          // Out of order: the payment's own event has not arrived yet – record the payment first.
          await settleIntent(ctx, tenantId, api, account, parent);
          if ((await getIntent(ctx, tenantId, parent.id))?.status !== "succeeded") return "ignored";
        }
        const pi = await api.getPaymentIntent(account, refund.paymentIntent);
        intent = await createRefundIntent(ctx, tenantId, { parentRef: refund.paymentIntent, paymentAmountPence: pi.amountReceived, amountPence: refund.amount, invoiceId: parent.invoiceId, patientId: parent.patientId, feePence: 0 }, SYSTEM_ACTOR);
        await setIntentRefs(ctx, tenantId, intent.id, { intentRef: refund.id });
        await pmsAudit(ctx, tenantId, SYSTEM_ACTOR, { action: "pms.card_refund.outside", targetType: "pms_invoice", targetId: parent.invoiceId ?? tenantId, detail: { amountPence: refund.amount } });
      }
    } else if (!intent.intentRef) {
      await setIntentRefs(ctx, tenantId, intent.id, { intentRef: refund.id });
    }
    // A refund's payment must be on the books before the refund (out-of-order delivery).
    const parent = await findIntentByRef(ctx, tenantId, refund.paymentIntent);
    if (parent && parent.status !== "succeeded") await settleIntent(ctx, tenantId, api, account, parent);
    const r = await recordIntentRefund(ctx, tenantId, { ...intent, intentRef: refund.id }, refund, null);
    return r.status;
  }

  if (type.startsWith("charge.dispute.")) {
    await pmsAudit(ctx, tenantId, SYSTEM_ACTOR, { action: type === "charge.dispute.created" ? "pms.card_dispute.open" : "pms.card_dispute.closed", targetType: "pms_card_settings", targetId: tenantId, detail: { ref: objectId.slice(0, 60) } });
    return "dispute_noted";
  }

  return "ignored";
}
