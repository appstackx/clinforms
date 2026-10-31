/**
 * Subscription notices by email to the clinic's owner and admins (the account email service, the clinic's brand):
 * a failed payment (with the grace date), read-only, payment received, cancelled. No payment details. Server only.
 */
import "server-only";
import type { Kysely } from "kysely";
import { clinicLinkBrand } from "../auth/brand-links";
import type { Database } from "../db/schema";
import { billingNoticeEmail, deliverEmail, type BillingNotice } from "../email";
import { clinicManagers } from "../pms/comms/credits/notify";
import { commsLinkOrigin } from "../pms/comms/links";
import { ukDate } from "../../lib/billing/plans";
import type { SyncDeps } from "./sync";

export const BILLING_PAGE_PATH = "/app/settings/billing";

export function emailBillingNotifier(db: () => Kysely<Database>, env: Readonly<Record<string, string | undefined>> = process.env): NonNullable<SyncDeps["notify"]> {
  return async (tenantId, n) => {
    const ctx = { db: db() };
    const managers = await clinicManagers(ctx, tenantId);
    const brand = await clinicLinkBrand(ctx.db, tenantId);
    const url = `${commsLinkOrigin(env)}${BILLING_PAGE_PATH}`;
    const notice: BillingNotice =
      n.kind === "payment_failed"
        ? { kind: "payment_failed", graceUntil: ukDate(n.graceUntil) }
        : n.kind === "cancelled"
          ? { kind: "cancelled", endsOn: ukDate(n.endsOn) }
          : { kind: n.kind };
    for (const m of managers) {
      await deliverEmail(billingNoticeEmail({ to: { email: m.email, name: m.name }, brand, clinicName: m.clinicName, notice, billingUrl: url }));
    }
  };
}
