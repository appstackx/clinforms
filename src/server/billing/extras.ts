/**
 * Extra reports above the plan's allowance (31/10/2026) – the simplest robust way: per completed UK MONTH, exactly the
 * numbers the clinic's "Plan & usage" page shows (clinic_usage: reports counted against the month's allowance), added
 * as ONE invoice item (extra_report × the number of extra reports, £1.50 each) to the subscription's next invoice.
 *
 * When: on the payment service's `invoice.created` for a monthly renewal (billing_reason subscription_cycle) – the
 * invoice is still a draft for about an hour, so the item goes onto it; if it is no longer a draft the item waits for
 * the next invoice. And every day from the cron (billExtrasFromCron): a month a webhook missed is added as a pending
 * item (the next renewal takes it); a YEARLY plan (01/11/2026: the Reports add-on can be yearly) gets its extras on an
 * invoice of their own straight away, charged automatically – a year is too long to wait. Every completed month since the plan started that has not been billed is billed then (a missed
 * renewal catches up the next month). Once each: a row per clinic and month (clinic_billing_extras, primary key)
 * written BEFORE the item, the item made with the idempotency key extra-<clinic>-<month>, then the row marked billed
 * with the item's id (unique). A month without extras is recorded as "skipped" so it is never looked at again.
 *
 * Not billed: a self-serve free trial's reports (counted before it converted – 13/11/2026), months while ClinForms staff manage the clinic by hand (override), plans without reports, and the last
 * part-month after a subscription ends (no further invoice – BILLING.md "Known limits").
 */
import "server-only";
import type { Kysely } from "kysely";
import { EXTRA_REPORT_PENCE } from "../../lib/billing/plans";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { getBillingExtra, markBillingExtraBilled, recordBillingExtra, type ClinicSubscription } from "../repos/clinic-subscription";
import { countBillableBefore, getUsageMonths } from "../repos/usage";
import { readSelfTrial } from "../repos/self-trial";
import { ukPeriodOf } from "../repos/usage-period";
import { readClinicSubscriptions } from "../repos/clinic-subscription";
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
  // 13/11/2026: a self-serve free trial's reports are free – never extras of the plan's first month.
  const trial = await readSelfTrial(ctx, sub.tenantId).catch(() => null);
  const freeBefore = trial && !trial.sampleOf ? (trial.convertedAt ?? sub.activatedAt) : null;
  for (const period of periods) {
    const existing = await getBillingExtra(ctx, sub.tenantId, period);
    if (existing && existing.status !== "pending") continue;
    let row = existing;
    if (!row) {
      const m = months.get(period);
      const included = m?.planReportsIncluded ?? null;
      const trialReports = freeBefore ? await countBillableBefore(ctx, sub.tenantId, period, freeBefore) : 0;
      const counted = Math.max(0, (m?.billableReports ?? 0) - trialReports);
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

/**
 * The daily catch-up (the retention cron calls it): every running subscription with reports, not managed by hand, in
 * the payment key's mode. Monthly plans: pending items for months a webhook missed. Yearly plans: their extras
 * invoiced at once. Never throws (each clinic on its own; errors counted).
 */
export async function billExtrasFromCron(
  deps: { db: Kysely<Database>; now?: () => Date },
  payments: Pick<SubscriptionPayments, "addExtraReports" | "invoicePendingItems" | "mode">,
): Promise<{ clinics: number; billed: number; invoices: number; errors: number }> {
  const out = { clinics: 0, billed: 0, invoices: 0, errors: 0 };
  const { rows } = await readClinicSubscriptions({ db: deps.db });
  for (const sub of rows) {
    if (sub.override || sub.reportsIncluded === null || sub.mode !== payments.mode) continue;
    if (sub.state !== "active" && sub.state !== "past_due") continue;
    out.clinics++;
    try {
      const r = await billExtraReports(deps, payments, sub, null);
      out.billed += r.billed.length;
      if (r.billed.length && sub.interval === "year") {
        await payments.invoicePendingItems({ customerRef: sub.customerRef, subscriptionId: sub.subscriptionRef, idempotencyKey: `extra-invoice-${sub.tenantId}-${r.billed.map((b) => b.period).join("_")}` });
        out.invoices++;
      }
    } catch {
      out.errors++;
    }
  }
  return out;
}
