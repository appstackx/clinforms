/**
 * POST /api/clinic-messages/sms – the SMS provider's webhook (patients' replies, delivery receipts). NOT LIVE:
 * 404 unless CLINIC_SMS_PROVIDER=test, 503 without CLINIC_SMS_WEBHOOK_SECRET (32+ characters); signed requests
 * only. In this build it is how a test reply is simulated (scripts/e2e/pms-messages-screens.cjs signs one).
 * Logic and tests: src/server/pms/comms/webhook.ts. Placement: see ../cron/route.ts.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { dispatchDepsFromEnv } from "@/server/pms/comms/dispatch";
import { providerStatus } from "@/server/pms/comms/providers";
import { handleSmsWebhook } from "@/server/pms/comms/webhook";
import { appointmentStatuses } from "@/server/pms/diary/message-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSmsWebhook(req, {
    secret: process.env.CLINIC_SMS_WEBHOOK_SECRET,
    providerMode: providerStatus().sms,
    ctx: () => ({ db: getDb(), cipher: getDataCipher() }),
    dispatch: () => dispatchDepsFromEnv(process.env, appointmentStatuses),
  });
}
