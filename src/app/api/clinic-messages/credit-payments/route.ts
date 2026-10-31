/**
 * POST /api/clinic-messages/credit-payments – the card payment service's webhook for text credits (the clinic
 * system's own payment account). Sessionless; 503 until STRIPE_CLINDESK_SECRET_KEY and STRIPE_CLINDESK_WEBHOOK_SECRET
 * are set; signed requests only; every payment re-read from the service and checked against the clinic before it is
 * credited (once). Logic and tests: src/server/pms/comms/credits/webhook.ts. Runbook: docs/clinic-system/SMS-CREDITS.md.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { cardPaymentsConfig, createCardPayments } from "@/server/pms/comms/credits/card-payments";
import { handleCreditWebhook } from "@/server/pms/comms/credits/webhook";
import { pmsNow } from "@/modules/pms/core/clock";
import { paymentAlerter } from "@/server/billing/payment-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleCreditWebhook(req, {
    config: () => cardPaymentsConfig(process.env),
    payments: (config) => createCardPayments(config),
    ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }),
    alert: paymentAlerter(getDb),
  });
}
