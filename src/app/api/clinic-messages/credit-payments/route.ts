/**
 * POST /api/clinic-messages/credit-payments – the OLD address of the payment account's webhook (text credits, 31/10/
 * 2026). Since subscription billing it is an ALIAS of the one webhook, POST /api/billing/stripe-webhook (subscriptions
 * and text credits, same signing secret): an endpoint registered here keeps working. Register the new address at
 * go-live and delete this one (docs/clinic-system/BILLING.md). Logic: src/server/billing/webhook.ts.
 */
import "server-only";
import { billingWebhookPost } from "@/server/billing/webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return billingWebhookPost(req);
}
