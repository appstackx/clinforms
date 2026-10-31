/**
 * `clinic_subscription` and `clinic_billing_extras` (migration 0009) – the clinic's subscription as last read from
 * the payment service, and the extra reports billed per UK month. Written ONLY by src/server/billing (sync from the
 * service's own copy; the override by ClinForms staff); read by the clinic's "Plan and billing" page, the account
 * hold check and the platform page. Pure database code (no Next imports); the clock comes from ctx.now.
 *
 * A database before migration 0009 reads as "no subscription" on the app's read paths (readClinicSubscription) –
 * exact: without the table no clinic can have one.
 */
import type { Selectable } from "kysely";
import type { ClinicBillingExtrasTable, ClinicSubscriptionTable } from "../db/schema";
import { SUBSCRIPTION_STATES, type BillingInterval, type SubscriptionState } from "../../lib/billing/plans";
import { RepoInputError, assertTenantId, nowIso, parseJson, toInt, type DbContext } from "./context";

export interface AppliedEntitlements {
  /** What the subscription set the clinic's packages to (null: not touched). */
  clinic: "active" | "cancelled" | null;
  reports: "active" | "paused" | "cancelled" | null;
  reportsIncluded: number | null;
  /** ISO end of the packages (cancel at period end), or null. */
  endsAt: string | null;
}

export interface ClinicSubscription {
  tenantId: string;
  customerRef: string;
  subscriptionRef: string;
  mode: "test" | "live";
  status: string;
  state: Exclude<SubscriptionState, "none">;
  product: "clindesk" | "clinforms" | null;
  planKey: string | null;
  interval: BillingInterval | null;
  reportsKey: string | null;
  reportsIncluded: number | null;
  practitionersMax: number | null;
  amountPence: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  activatedAt: string | null;
  pastDueSince: string | null;
  graceUntil: string | null;
  graceNotifiedAt: string | null;
  readOnlyNotifiedAt: string | null;
  override: boolean;
  overrideNote: string | null;
  applied: AppliedEntitlements | null;
  lastEventRef: string | null;
  lastSyncedAt: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

type Row = Selectable<ClinicSubscriptionTable>;

const intOrNull = (v: unknown) => (v === null || v === undefined ? null : toInt(v));

function toSubscription(r: Row): ClinicSubscription {
  const state = (SUBSCRIPTION_STATES as readonly string[]).includes(r.state) && r.state !== "none" ? (r.state as ClinicSubscription["state"]) : "pending_payment";
  return {
    tenantId: r.tenant_id,
    customerRef: r.customer_ref,
    subscriptionRef: r.subscription_ref,
    mode: r.mode === "live" ? "live" : "test",
    status: r.status,
    state,
    product: r.product === "clindesk" || r.product === "clinforms" ? r.product : null,
    planKey: r.plan_key,
    interval: r.billing_interval === "month" || r.billing_interval === "year" ? r.billing_interval : null,
    reportsKey: r.reports_key,
    reportsIncluded: intOrNull(r.reports_included),
    practitionersMax: intOrNull(r.practitioners_max),
    amountPence: intOrNull(r.amount_pence),
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: toInt(r.cancel_at_period_end) === 1,
    canceledAt: r.canceled_at,
    endedAt: r.ended_at,
    activatedAt: r.activated_at,
    pastDueSince: r.past_due_since,
    graceUntil: r.grace_until,
    graceNotifiedAt: r.grace_notified_at,
    readOnlyNotifiedAt: r.read_only_notified_at,
    override: toInt(r.override) === 1,
    overrideNote: r.override_note,
    applied: parseJson<AppliedEntitlements>(r.applied_json),
    lastEventRef: r.last_event_ref,
    lastSyncedAt: r.last_synced_at,
    rev: toInt(r.rev),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getClinicSubscription(ctx: DbContext, tenantId: string): Promise<ClinicSubscription | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom("clinic_subscription").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return r ? toSubscription(r) : null;
}

export async function findSubscriptionByRef(ctx: DbContext, subscriptionRef: string): Promise<ClinicSubscription | null> {
  const r = await ctx.db.selectFrom("clinic_subscription").selectAll().where("subscription_ref", "=", subscriptionRef).executeTakeFirst();
  return r ? toSubscription(r) : null;
}

export async function listClinicSubscriptions(ctx: DbContext): Promise<ClinicSubscription[]> {
  return (await ctx.db.selectFrom("clinic_subscription").selectAll().orderBy("tenant_id").execute()).map(toSubscription);
}

/** Whether `err` says the 0009 tables do not exist yet. */
export function isMissingBillingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (/no such table: (?:main\.)?clinic_(subscription|billing_extras)\b|relation "(?:public\.)?clinic_(subscription|billing_extras)" does not exist/i.test(message)) return true;
  if (e.code === "42P01" && /clinic_(subscription|billing_extras)/.test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isMissingBillingTable(e.cause) : false;
}

/** getClinicSubscription for the app's read paths: a database before 0009 reads as "no subscription". */
export async function readClinicSubscription(ctx: DbContext, tenantId: string): Promise<ClinicSubscription | null> {
  try {
    return await getClinicSubscription(ctx, tenantId);
  } catch (err) {
    if (isMissingBillingTable(err)) return null;
    throw err;
  }
}

export async function readClinicSubscriptions(ctx: DbContext): Promise<{ available: boolean; rows: ClinicSubscription[] }> {
  try {
    return { available: true, rows: await listClinicSubscriptions(ctx) };
  } catch (err) {
    if (isMissingBillingTable(err)) return { available: false, rows: [] };
    throw err;
  }
}

/** The subscription as read from the payment service (the sync writes it whole). */
export interface SubscriptionSnapshot {
  customerRef: string;
  subscriptionRef: string;
  mode: "test" | "live";
  status: string;
  state: ClinicSubscription["state"];
  product: "clindesk" | "clinforms" | null;
  planKey: string | null;
  interval: BillingInterval | null;
  reportsKey: string | null;
  reportsIncluded: number | null;
  practitionersMax: number | null;
  amountPence: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  activatedAt: string | null;
  pastDueSince: string | null;
  graceUntil: string | null;
  applied: AppliedEntitlements | null;
  lastEventRef: string | null;
}

/**
 * Saves the snapshot (insert or replace by clinic). A clinic has ONE subscription row: a new subscription replaces the
 * old one's row (the old one is ended at the payment service by the caller, or already ended). The override and the
 * notification times are kept, except that a new subscription starts its notices afresh.
 */
export async function saveSubscriptionSnapshot(ctx: DbContext, tenantId: string, snap: SubscriptionSnapshot): Promise<ClinicSubscription> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const before = await getClinicSubscription(ctx, tenantId);
  const sameSub = before?.subscriptionRef === snap.subscriptionRef;
  const values = {
    customer_ref: snap.customerRef,
    subscription_ref: snap.subscriptionRef,
    mode: snap.mode,
    status: snap.status.slice(0, 30) || "unknown",
    state: snap.state,
    product: snap.product,
    plan_key: snap.planKey,
    billing_interval: snap.interval,
    reports_key: snap.reportsKey,
    reports_included: snap.reportsIncluded,
    practitioners_max: snap.practitionersMax,
    amount_pence: snap.amountPence,
    current_period_start: snap.currentPeriodStart,
    current_period_end: snap.currentPeriodEnd,
    cancel_at_period_end: snap.cancelAtPeriodEnd ? 1 : 0,
    canceled_at: snap.canceledAt,
    ended_at: snap.endedAt,
    activated_at: snap.activatedAt,
    past_due_since: snap.pastDueSince,
    grace_until: snap.graceUntil,
    applied_json: snap.applied ? JSON.stringify(snap.applied) : null,
    last_event_ref: snap.lastEventRef,
    last_synced_at: at,
    // Notices start afresh for a new subscription or once a payment has cleared.
    ...(sameSub && snap.state === "past_due" ? {} : { grace_notified_at: null, read_only_notified_at: null }),
    updated_at: at,
  };
  try {
    await ctx.db
      .insertInto("clinic_subscription")
      .values({ tenant_id: tenantId, ...values, grace_notified_at: null, read_only_notified_at: null, override: 0, override_note: null, rev: 0, created_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet((eb) => ({ ...values, rev: eb("clinic_subscription.rev", "+", 1) })))
      .execute();
  } catch (err) {
    if (/unique|duplicate/i.test(err instanceof Error ? err.message : "")) throw new RepoInputError("That subscription already belongs to another clinic.");
    throw err;
  }
  const saved = await getClinicSubscription(ctx, tenantId);
  if (!saved) throw new Error("clinic_subscription write did not persist.");
  return saved;
}

/** Claims a notice (once): true = this caller sends the email. */
export async function claimSubscriptionNotice(ctx: DbContext, tenantId: string, notice: "grace" | "read_only"): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const col = notice === "grace" ? "grace_notified_at" : "read_only_notified_at";
  const r = await ctx.db.updateTable("clinic_subscription").set({ [col]: at, updated_at: at }).where("tenant_id", "=", tenantId).where(col, "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** ClinForms staff: manage the clinic's packages by hand (on) or let the subscription drive them again (off). */
export async function setSubscriptionOverride(ctx: DbContext, tenantId: string, on: boolean, note: string | null): Promise<{ changed: boolean }> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const clean = note && note.trim() ? note.trim().slice(0, 200) : null;
  const r = await ctx.db
    .updateTable("clinic_subscription")
    .set({ override: on ? 1 : 0, override_note: on ? clean : null, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("override", "=", on ? 0 : 1)
    .executeTakeFirst();
  return { changed: Number(r.numUpdatedRows) > 0 };
}

/* ------------------------------------------------------------------------------------------------
 * Extra reports
 * ----------------------------------------------------------------------------------------------*/

export interface BillingExtra {
  tenantId: string;
  period: string;
  subscriptionRef: string;
  reportsCounted: number;
  reportsIncluded: number;
  extraReports: number;
  unitPence: number;
  status: "pending" | "billed" | "skipped";
  invoiceItemRef: string | null;
  invoiceRef: string | null;
  createdAt: string;
}

function toExtra(r: Selectable<ClinicBillingExtrasTable>): BillingExtra {
  return {
    tenantId: r.tenant_id,
    period: r.period,
    subscriptionRef: r.subscription_ref,
    reportsCounted: toInt(r.reports_counted),
    reportsIncluded: toInt(r.reports_included),
    extraReports: toInt(r.extra_reports),
    unitPence: toInt(r.unit_pence),
    status: r.status === "billed" || r.status === "skipped" ? r.status : "pending",
    invoiceItemRef: r.invoice_item_ref,
    invoiceRef: r.invoice_ref,
    createdAt: r.created_at,
  };
}

export async function listBillingExtras(ctx: DbContext, tenantId: string): Promise<BillingExtra[]> {
  assertTenantId(tenantId);
  return (await ctx.db.selectFrom("clinic_billing_extras").selectAll().where("tenant_id", "=", tenantId).orderBy("period", "desc").execute()).map(toExtra);
}

/** Records a month's extra reports once (true = recorded now; false = the month was recorded before). */
export async function recordBillingExtra(
  ctx: DbContext,
  tenantId: string,
  input: { period: string; subscriptionRef: string; reportsCounted: number; reportsIncluded: number; extraReports: number; unitPence: number; status: "pending" | "skipped" },
): Promise<boolean> {
  assertTenantId(tenantId);
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new RepoInputError("period must be YYYY-MM.");
  const at = nowIso(ctx);
  const r = await ctx.db
    .insertInto("clinic_billing_extras")
    .values({
      tenant_id: tenantId,
      period: input.period,
      subscription_ref: input.subscriptionRef,
      reports_counted: input.reportsCounted,
      reports_included: input.reportsIncluded,
      extra_reports: input.extraReports,
      unit_pence: input.unitPence,
      status: input.status,
      invoice_item_ref: null,
      invoice_ref: null,
      created_at: at,
      updated_at: at,
    })
    .onConflict((oc) => oc.columns(["tenant_id", "period"]).doNothing())
    .executeTakeFirst();
  return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function markBillingExtraBilled(ctx: DbContext, tenantId: string, period: string, ref: { invoiceItemRef: string; invoiceRef: string | null }): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await ctx.db
    .updateTable("clinic_billing_extras")
    .set({ status: "billed", invoice_item_ref: ref.invoiceItemRef, invoice_ref: ref.invoiceRef, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("period", "=", period)
    .where("status", "=", "pending")
    .execute();
}

export async function getBillingExtra(ctx: DbContext, tenantId: string, period: string): Promise<BillingExtra | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom("clinic_billing_extras").selectAll().where("tenant_id", "=", tenantId).where("period", "=", period).executeTakeFirst();
  return r ? toExtra(r) : null;
}
