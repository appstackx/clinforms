/**
 * Payment alerts (review fix 31/10/2026, "webhook answers 200 for paid but refused"): a payment the card payment
 * service reports as PAID that the system refused to apply (another clinic's customer, an amount or pack that does
 * not match, an unknown clinic) is answered 200 to the service (retrying would not change the answer) but is never
 * silent: an audit row under the platform ("platform.payment_alert" – ids and reason codes only) and an email to
 * every ClinForms platform administrator (CLINFORMS_PLATFORM_ADMINS). Never throws into the webhook.
 */
import "server-only";
import type { Kysely } from "kysely";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { platformAdmins } from "../auth/config";
import type { Database } from "../db/schema";
import { deliverEmail, paymentAlertEmail } from "../email";
import { appendAudit } from "../repos/audit";
import { commsLinkOrigin } from "../pms/comms/links";

export const PLATFORM_AUDIT_TENANT_ID = "platform";

export interface PaymentAlert {
  /** "text_credits" | "subscription" */
  area: string;
  eventType: string;
  eventId: string | null;
  objectId: string | null;
  /** The clinic the payment named (unchecked – it was refused), if any. */
  tenantId: string | null;
  why: string;
}

export type PaymentAlerter = (alert: PaymentAlert) => Promise<void>;

export function paymentAlerter(db: () => Kysely<Database>, env: Readonly<Record<string, string | undefined>> = process.env): PaymentAlerter {
  return async (alert) => {
    const detail = {
      area: alert.area.slice(0, 30),
      eventType: alert.eventType.slice(0, 60),
      eventId: alert.eventId?.slice(0, 120) ?? null,
      objectId: alert.objectId?.slice(0, 120) ?? null,
      tenantId: alert.tenantId?.slice(0, 64) ?? null,
      why: alert.why.slice(0, 40),
    };
    try {
      await appendAudit({ db: db() }, PLATFORM_AUDIT_TENANT_ID, { userId: PLATFORM_USER_ID, action: "platform.payment_alert", targetType: "payment", targetId: detail.objectId, detail });
    } catch {
      // the email below still goes
    }
    console.warn(JSON.stringify({ event: "payments.alert", ...detail }));
    const platformUrl = `${commsLinkOrigin(env)}/app/platform/billing`;
    for (const email of Array.from(platformAdmins(env)).slice(0, 10)) {
      try {
        await deliverEmail(paymentAlertEmail({ to: { email }, what: alert.area === "subscription" ? "a subscription payment was refused" : "a text credit payment was refused", facts: detail, platformUrl }));
      } catch {
        // never into the webhook
      }
    }
  };
}
