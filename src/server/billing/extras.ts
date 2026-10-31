/**
 * Extra reports above the plan's allowance (31/10/2026) – the simplest robust way: per completed UK MONTH, exactly the
 * numbers the clinic's "Plan & usage" page shows (clinic_usage: reports counted against the month's allowance), added
 * as ONE invoice item (extra_report × the number of extra reports, £1.50 each) to the subscription's next invoice.
 *
 * When: on the payment service's `invoice.created` for a renewal (billing_reason subscription_cycle) – the invoice
 * is still a draft for about an hour, so the item goes onto it; if it is no longer a draft the item waits for the
 * next invoice. Every completed month since the plan started that has not been billed is billed then (a missed
 * renewal catches up the next month). Once each: a row per clinic and month (clinic_billing_extras, primary key)
 * written BEFORE the item, the item made with the idempotency key extra-<clinic>-<month>, then the row marked billed
 * with the item's id (unique). A month without extras is recorded as "skipped" so it is never looked at again.
 *
 * Not billed: months while ClinForms staff manage the clinic by hand (override), plans without reports, and the last
 * part-month after a subscription ends (no further invoice – BILLING.md "Known limits").
 */
import "server-only";
import type { Kysely } from "kysely";
import { EXTRA_REPORT_PENCE } from "../../lib/billing/plans";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { getBillingExtra, markBillingExtraBilled, recordBillingExtra, type ClinicSubscription } from "../repos/clinic-subscription";
import { getUsageMonths } from "../repos/usage";
import { ukPeriodOf } from "../repos/usage-period";
import type { InvoiceInfo, SubscriptionPayments } from "./payments";

/** The UK months from `from` (YYYY-MM) up to, not including, `to` – at most 12. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (let i = 0; i < 120 && `${y}-${String(m).padStart(2, "0")}` < to; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out.slice(-12);
}

export interface ExtrasResult {
  billed: { period: string; extra: number; itemId: string }[];
  skipped: string[];
}

export async function billExtraReports(
  deps: { db: Kysely<Database>; now?: () => Date },
  payments: Pick<SubscriptionPayments, "addExtraReports">,
  sub: ClinicSubscription,
  invoice: Pick<InvoiceInfo, "id" | "status" | "billingReason"> | null,
): Promise<ExtrasResult> {
  const now = deps.now ? deps.now() : new Date();
  const ctx = { db: deps.db, now: () => now };
  const out: ExtrasResult = { billed: [], skipped: [] };
  if (sub.override || sub.reportsIncluded === null || !sub.activatedAt) return out;
  if (sub.state !== "active" && sub.state !== "past_due") return out;
  if (invoice && invoice.billingReason !== "subscription_cycle") return out;
  const periods = monthsBetween(ukPeriodOf(new Date(sub.activatedAt)), ukPeriodOf(now));
  if (periods.length === 0) return out;
  const months = new Map((await getUsageMonths(ctx, sub.tenantId, periods)).map((m) => [m.period, m]));
  for (const period of periods) {
    const existing = await getBillingExtra(ctx, sub.tenantId, period);
    if (existing && existing.status !== "pending") continue;
    let row = existing;
    if (!row) {
      const m = months.get(period);
      const included = m?.planReportsIncluded ?? null;
      const counted = m?.billableReports ?? 0;
      const extra = included === null ? 0 : Math.max(0, counted - included);
      await recordBillingExtra(ctx, sub.tenantId, {
        period,
        subscriptionRef: sub.subscriptionRef,
        reportsCounted: counted,
        reportsIncluded: included ?? 0,
        extraReports: extra,
        unitPence: EXTRA_REPORT_PENCE,
        status: extra > 0 ? "pending" : "skipped",
      });
      row = await getBillingExtra(ctx, sub.tenantId, period);
      if (!row || row.status !== "pending") {
        out.skipped.push(period);
        continue;
      }
    }
    const item = await payments.addExtraReports({
      customerRef: sub.customerRef,
      subscriptionId: sub.subscriptionRef,
      invoiceId: invoice && invoice.status === "draft" ? invoice.id : null,
      quantity: row.extraReports,
      period,
      tenantId: sub.tenantId,
      idempotencyKey: `extra-${sub.tenantId}-${period}`,
    });
    await markBillingExtraBilled(ctx, sub.tenantId, period, { invoiceItemRef: item.itemId, invoiceRef: item.invoiceId });
    await appendAudit(ctx, sub.tenantId, {
      userId: null,
      action: "clinic.extra_reports_billed",
      targetType: "clinic_subscription",
      targetId: sub.subscriptionRef,
      detail: { period, extraReports: row.extraReports, unitPence: row.unitPence, item: item.itemId, invoice: item.invoiceId },
    });
    out.billed.push({ period, extra: row.extraReports, itemId: item.itemId });
  }
  return out;
}
