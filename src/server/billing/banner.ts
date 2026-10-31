/**
 * The billing banner of the clinic area, the clinic system's shell and the Studio (31/10/2026): read-only (everyone –
 * they need to know why nothing can be saved), payment overdue during the grace period and too many practitioners
 * for the plan (owners and admins, with the way to fix it). Never throws (no banner on any error).
 */
import "server-only";
import type { Kysely } from "kysely";
import { seatWarning, ukDate, type BillingBanner } from "../../lib/billing/plans";
import type { Database } from "../db/schema";
import { readClinicSubscription } from "../repos/clinic-subscription";
import { holdOf } from "./access";
import { BILLING_PAGE_PATH } from "./notify";
import { activePractitioners, choiceOf } from "./views";

export type { BillingBanner } from "../../lib/billing/plans";

export async function billingBannerFor(db: Kysely<Database>, tenantId: string, manager: boolean, now: Date = new Date()): Promise<BillingBanner | null> {
  try {
    const sub = await readClinicSubscription({ db }, tenantId);
    if (!sub || sub.override) return null;
    const href = manager ? BILLING_PAGE_PATH : null;
    if (holdOf(sub, now).held) {
      return { tone: "error", text: manager ? "Your account is read-only: a payment for your plan is overdue. Records can still be opened. Pay under Plan and billing to carry on." : "The account is read-only: a payment for the clinic's plan is overdue. Records can still be opened. Ask the clinic owner.", href };
    }
    if (!manager) return null;
    if (sub.state === "past_due") return { tone: "warning", text: `A payment for your plan did not go through. Everything works until ${ukDate(sub.graceUntil)} – update your payment details before then.`, href };
    if (sub.state === "active") {
      const seat = seatWarning(choiceOf(sub), await activePractitioners(db, tenantId));
      if (seat?.over) return { tone: "warning", text: `More practitioners are active than your plan includes (${seat.max}). Nothing stops working – please move to a larger plan.`, href };
    }
    return null;
  } catch {
    return null;
  }
}
