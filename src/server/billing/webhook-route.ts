/** The unified webhook's production wiring (both routes use it): env config, the database, emails and alerts. */
import "server-only";
import { getDataCipher } from "../crypto";
import { getDb } from "../db";
import { pmsNow } from "../../modules/pms/core/clock";
import { cardPaymentsConfig, createCardPayments } from "../pms/comms/credits/card-payments";
import { paymentAlerter } from "./payment-alerts";
import { emailBillingNotifier } from "./notify";
import { createSubscriptionPayments } from "./payments";
import { handleBillingWebhook } from "./webhook";

export function billingWebhookPost(req: Request): Promise<Response> {
  return handleBillingWebhook(req, {
    config: () => cardPaymentsConfig(process.env),
    credits: (config) => createCardPayments(config),
    subscriptions: (config) => createSubscriptionPayments(config),
    ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }),
    db: getDb,
    notify: emailBillingNotifier(getDb),
    alert: paymentAlerter(getDb),
  });
}
