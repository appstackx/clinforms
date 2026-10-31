/**
 * Delivery receipts from The SMS Works (POST /api/clinic-messages/sms-receipts?token=…, 31/10/2026) – they settle the
 * credits reserved for a text: The SMS Works charges only for DELIVERED texts, so
 *
 *   DELIVERED                          → the debit stands (the message becomes "delivered");
 *   UNDELIVERABLE / EXPIRED / REJECTED → the credits come back once (a reversal naming the debit) and the message
 *                                        becomes "failed" with the provider's reason code;
 *   SCHEDULED / SENT                   → nothing yet.
 *
 * A text whose send never answered (a timeout – recorded "failed" with provider_unknown and its credits kept, review
 * fix 6) is found by the clinic and message ids sent as metadata, and is settled the same way.
 *
 * Authentication: the receipts are not signed by the provider, so (1) the URL carries a token
 * (SMSWORKS_RECEIPT_SECRET, 32+ characters, compared in constant time; 401 otherwise), and (2) the body is never
 * trusted: the report is RE-READ from the provider's API with our own key (GET /message/{id}) and only that copy
 * counts. 404 while the live provider is off, 503 without the secret, 502 when the provider cannot be reached (it
 * retries the receipt), 200 for everything handled or ignored. No patient data in answers or logs.
 */
import { timingSafeEqual } from "node:crypto";
import { logAuthEvent } from "../../email/log";
import type { PmsActor } from "../../../modules/pms/core/types";
import { nowIso, pmsAuditQuery, writeWithAudit, type RepoContext } from "../../repos/pms/context";
import { recordDeliveryReceipt } from "../../repos/pms/comms/messages";
import { releaseSmsCredits } from "../../repos/pms/comms/credits";
import { isPackageOn } from "../../repos/pms/entitlements";
import { PROVIDER_UNKNOWN, SYSTEM_ACTOR } from "./dispatch";
import { RECEIPT_SECRET_MIN_LENGTH, SMSWORKS_PROVIDER_ID, parseReport, reportOutcome, type SmsWorksClient, type SmsWorksReport } from "./providers/smsworks";

const MAX_BODY = 32 * 1024;

export interface ReceiptDeps {
  secret: string | undefined;
  /** The live provider's API (null: the live provider is off – 404). */
  client: () => SmsWorksClient | null;
  ctx: () => RepoContext;
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function tokenOk(given: string | null, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleSmsWorksReceipt(req: Request, deps: ReceiptDeps): Promise<Response> {
  const client = deps.client();
  if (!client) return json(404, { ok: false, error: "Not enabled." });
  if (!deps.secret || deps.secret.length < RECEIPT_SECRET_MIN_LENGTH) return json(503, { ok: false, error: "Not configured." });
  const url = new URL(req.url);
  if (!tokenOk(url.searchParams.get("token") ?? req.headers.get("x-receipt-token"), deps.secret)) return json(401, { ok: false, error: "Not authorised." });
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return json(413, { ok: false, error: "Too large." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "Too large." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Not JSON." });
  }
  const hinted = body && typeof body === "object" ? parseReport(body as Record<string, unknown>) : null;
  if (!hinted) return json(400, { ok: false, error: "No message id." });
  let report: SmsWorksReport | null;
  try {
    report = await client.getReport(hinted.messageId);
  } catch {
    logAuthEvent("pms.sms_receipt_unconfirmed", { error: "provider_unreachable" });
    return json(502, { ok: false, error: "Could not confirm." });
  }
  if (!report) return json(200, { ok: true, result: "unknown_message" });
  try {
    const result = await applySmsReceipt(deps.ctx(), report);
    return json(200, { ok: true, result });
  } catch (err) {
    logAuthEvent("pms.sms_receipt_failed", { error: err instanceof Error ? err.name : "error" });
    return json(500, { ok: false, error: "Something went wrong." });
  }
}

export type ReceiptResult = "pending" | "delivered" | "refunded" | "failed" | "not_found" | "already";

/**
 * Applies one CONFIRMED report (re-read from the provider) to the clinic it names: the message's status and, for a
 * text that was not delivered, its credits back (once). Idempotent.
 */
export async function applySmsReceipt(ctx: RepoContext, report: SmsWorksReport, actor: PmsActor = SYSTEM_ACTOR): Promise<ReceiptResult> {
  const outcome = reportOutcome(report.status);
  if (outcome === "pending") return "pending";
  const tenantId = report.tenantId;
  if (!tenantId || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantId)) return "not_found";
  if (!(await isPackageOn(ctx, tenantId, "clinic"))) return "not_found";
  let row = await ctx.db
    .selectFrom("pms_messages")
    .select(["id", "status", "error_code"])
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", SMSWORKS_PROVIDER_ID)
    .where("provider_message_id", "=", report.messageId)
    .where("direction", "=", "outbound")
    .executeTakeFirst();
  if (!row && report.ourMessageId) {
    // A send that never answered: found by our own id, then given the provider's id.
    const unknown = await ctx.db
      .selectFrom("pms_messages")
      .select(["id", "status", "error_code"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", report.ourMessageId)
      .where("provider", "=", SMSWORKS_PROVIDER_ID)
      .where("direction", "=", "outbound")
      .where("channel", "=", "sms")
      .executeTakeFirst();
    if (unknown && unknown.status === "failed" && unknown.error_code === PROVIDER_UNKNOWN) {
      const at = nowIso(ctx);
      await writeWithAudit(ctx, [
        ctx.db
          .updateTable("pms_messages")
          .set({ status: "sent", provider_message_id: report.messageId, error_code: null, updated_at: at })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", unknown.id)
          .where("status", "=", "failed")
          .where("error_code", "=", PROVIDER_UNKNOWN),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.message.status", targetType: "pms_message", targetId: unknown.id, detail: { status: "sent", source: "receipt", wasUnknown: true } }),
      ]);
      row = { id: unknown.id, status: "sent", error_code: null };
    } else if (unknown) {
      row = unknown;
    }
  }
  if (!row) return "not_found";
  if (row.status === "sent" || row.status === "delivered") {
    await recordDeliveryReceipt(ctx, tenantId, SMSWORKS_PROVIDER_ID, { providerMessageId: report.messageId, status: outcome, errorCode: report.failureCode }, actor);
  }
  if (outcome === "delivered") return "delivered";
  // Not delivered: the provider charges nothing, so neither do we – the text's debit back, once.
  const debit = await ctx.db
    .selectFrom("pms_sms_credit_entries")
    .select(["id", "credits"])
    .where("tenant_id", "=", tenantId)
    .where("message_id", "=", row.id)
    .where("kind", "=", "debit")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!debit) return "failed";
  const r = await releaseSmsCredits(ctx, tenantId, { debitId: debit.id, credits: Math.abs(Number(debit.credits)), messageId: row.id, why: "undelivered" }, actor);
  return r.ok ? "refunded" : "already";
}
