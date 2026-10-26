/**
 * POST /api/clinic-messages/sms – the SMS provider's webhook (patients' replies, delivery receipts). NOT LIVE:
 * 404 unless CLINIC_SMS_PROVIDER=test, 503 without CLINIC_SMS_WEBHOOK_SECRET; signed requests only.
 * Logic and tests: src/server/pms/comms/webhook.ts.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { providerStatus } from "@/server/pms/comms/providers";
import { handleSmsWebhook } from "@/server/pms/comms/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSmsWebhook(req, { secret: process.env.CLINIC_SMS_WEBHOOK_SECRET, providerMode: providerStatus().sms, ctx: () => ({ db: getDb(), cipher: getDataCipher() }) });
}
