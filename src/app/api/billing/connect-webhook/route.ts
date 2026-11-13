/**
 * POST /api/billing/connect-webhook – events from the clinics' own connected payment accounts (card payments:
 * payments, refunds, saved cards, disputes, account status). 404 while CLINFORMS_CARD_PAYMENTS is off; 503 until
 * STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET (and/or STRIPE_CLINDESK_ACCOUNTS_WEBHOOK_SECRET) is set; signed requests
 * only; every object re-read from the clinic's account before anything changes. The platform's own webhook
 * (/api/billing/stripe-webhook) is separate and unchanged. Logic and tests: src/server/pms/billing/connect/webhook.ts.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { connectConfig } from "@/server/pms/billing/connect/client";
import { connectWebhookDeps, handleConnectWebhook } from "@/server/pms/billing/connect/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleConnectWebhook(req, connectWebhookDeps(process.env, () => ({ db: getDb(), cipher: getDataCipher() }), connectConfig(process.env)));
}
