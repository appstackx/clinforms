/**
 * Subscription notices by email to the clinic's owner and admins (the account email service, the clinic's brand):
 * a failed payment (with the grace date), on hold (settings and new reports paused), payment received, cancelled. No payment details. Server only.
 */
import "server-only";
import type { Kysely } from "kysely";
import { clinicLinkBrand } from "../auth/brand-links";
import type { Database } from "../db/schema";
import { billingNoticeEmail, deliverEmail, type BillingNotice } from "../email";
import { clinicManagers } from "../pms/comms/credits/notify";
import { commsLinkOrigin } from "../pms/comms/links";
import { baseUrlSetting, linkTarget } from "../auth/config";
import type { BrandId } from "../../lib/brand";
import { ukDate } from "../../lib/billing/plans";
import type { SyncDeps } from "./sync";

export const BILLING_PAGE_PATH = "/app/settings/billing";

/** Where a billing link for a clinic of `brand` goes, and the brand the email then speaks for. */
export function billingLinkTarget(env: Readonly<Record<string, string | undefined>>, brand: BrandId): { origin: string; brand: BrandId } {
  if (env.APP_ORIGIN) {
    try {
      return { origin: new URL(env.APP_ORIGIN).origin, brand };
    } catch {
      // fall through
    }
  }
  try {
    return linkTarget(baseUrlSetting(env), brand);
  } catch {
    return { origin: commsLinkOrigin(env), brand: "clinforms" };
  }
}

export function emailBillingNotifier(db: () => Kysely<Database>, env: Readonly<Record<string, string | undefined>> = process.env): NonNullable<SyncDeps["notify"]> {
  return async (tenantId, n) => {
    const ctx = { db: db() };
    const managers = await clinicManagers(ctx, tenantId);
    // 01/11/2026 (R3): the button goes to the host of the brand the email speaks for (a ClinForms clinic → ClinForms'
    // host, where its members are signed in); APP_ORIGIN still overrides, as for every other link.
    const { origin, brand } = billingLinkTarget(env, await clinicLinkBrand(ctx.db, tenantId));
    const url = `${origin}${BILLING_PAGE_PATH}`;
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
