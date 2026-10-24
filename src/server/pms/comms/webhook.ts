/**
 * POST /api/clinic-messages/sms – the SMS provider's webhook: replies from patients and delivery receipts.
 *
 * NOT LIVE: only the test provider has a webhook format in this build, so the endpoint answers 404 unless
 * CLINIC_SMS_PROVIDER=test, and 503 unless CLINIC_SMS_WEBHOOK_SECRET (32+ characters) is set. A real provider's
 * adapter adds its own signature check and payload mapping here later.
 *
 * Test format (JSON, at most 16 KB), signed: header x-clinic-timestamp = Unix seconds, header
 * x-clinic-signature = "v1=" + hex(HMAC-SHA256(secret, `${timestamp}.${raw body}`)); at most 5 minutes old.
 *   {"type":"reply","clinic":"<clinic id>","from":"+447700900123","text":"YES","id":"<provider id>","receivedAt":"…"}
 *   {"type":"status","clinic":"<clinic id>","id":"<provider id of the sent text>","status":"delivered"|"failed","error":"…"}
 * Answers carry no detail about patients; errors are logged by name only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DeliveryReceiptSchema } from "../../../modules/pms/comms/schemas";
import { logAuthEvent } from "../../email/log";
import { RepoInputError, parseInput, type RepoContext } from "../../repos/pms/context";
import { recordDeliveryReceipt } from "../../repos/pms/comms/messages";
import { isPackageOn } from "../../repos/pms/entitlements";
import { SYSTEM_ACTOR } from "./dispatch";
import { recordInboundSms } from "./replies";
import { TEST_PROVIDER_ID } from "./providers/test";

export const WEBHOOK_SECRET_MIN_LENGTH = 32;
export const TIMESTAMP_HEADER = "x-clinic-timestamp";
export const SIGNATURE_HEADER = "x-clinic-signature";
const MAX_BODY = 16 * 1024;
const MAX_SKEW_SECONDS = 300;

export interface WebhookDeps {
  secret: string | undefined;
  /** The SMS provider's mode: the webhook exists only for "test". */
  providerMode: "outbox" | "test" | "misconfigured";
  ctx: () => RepoContext;
  nowMs?: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function webhookSignatureValid(secret: string, timestamp: string | null, signature: string | null, rawBody: string, nowMs: number): boolean {
  if (!timestamp || !signature || !/^\d{9,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function handleSmsWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (deps.providerMode !== "test") return json(404, { ok: false, error: "Not enabled." });
  if (!deps.secret || deps.secret.length < WEBHOOK_SECRET_MIN_LENGTH) return json(503, { ok: false, error: "Not configured." });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json(413, { ok: false, error: "Too large." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "Too large." });
  const now = deps.nowMs ? deps.nowMs() : Date.now();
  if (!webhookSignatureValid(deps.secret, req.headers.get(TIMESTAMP_HEADER), req.headers.get(SIGNATURE_HEADER), raw, now)) {
    return json(401, { ok: false, error: "Signature not valid." });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "Not JSON." });
  }
  const clinic = typeof body.clinic === "string" ? body.clinic : "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clinic)) return json(400, { ok: false, error: "Unknown clinic." });
  try {
    const ctx = deps.ctx();
    if (!(await isPackageOn(ctx, clinic, "clinic"))) return json(404, { ok: false, error: "Unknown clinic." });
    if (body.type === "reply") {
      const r = await recordInboundSms(
        ctx,
        clinic,
        { from: String(body.from ?? ""), text: String(body.text ?? ""), providerMessageId: typeof body.id === "string" ? body.id : null, receivedAt: typeof body.receivedAt === "string" ? body.receivedAt : null },
        TEST_PROVIDER_ID,
        SYSTEM_ACTOR,
      );
      return json(200, { ok: true, duplicate: r.duplicate });
    }
    if (body.type === "status") {
      const receipt = parseInput(DeliveryReceiptSchema, { providerMessageId: body.id, status: body.status, errorCode: typeof body.error === "string" ? body.error : null }, "Receipt");
      const updated = await recordDeliveryReceipt(ctx, clinic, TEST_PROVIDER_ID, receipt, SYSTEM_ACTOR);
      return json(200, { ok: true, updated });
    }
    return json(400, { ok: false, error: "Unknown type." });
  } catch (err) {
    if (err instanceof RepoInputError) return json(400, { ok: false, error: "Not valid." });
    logAuthEvent("pms.comms_webhook_failed", { error: err instanceof Error ? err.name : "error" });
    return json(500, { ok: false, error: "Something went wrong." });
  }
}
