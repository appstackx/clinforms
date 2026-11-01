/**
 * POST /api/billing/stripe-webhook – the ONE webhook of the ClinDesk payment account: subscriptions (ClinDesk and
 * ClinForms plans) and text credits. Sessionless; 503 until STRIPE_CLINDESK_SECRET_KEY and
 * STRIPE_CLINDESK_WEBHOOK_SECRET are set; signed requests only; every object re-read before anything changes.
 * Logic and tests: src/server/billing/webhook.ts. Runbook: docs/clinic-system/BILLING.md.
 */
import "server-only";
import { billingWebhookPost } from "@/server/billing/webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return billingWebhookPost(req);
}
