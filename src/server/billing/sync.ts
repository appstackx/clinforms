/**
 * The subscription → the clinic's packages (31/10/2026). Every webhook event about a subscription, the checkout's
 * success page and the platform's "Re-read" call syncSubscription(): the subscription is RE-READ from the payment
 * service (never the event body), checked against the clinic (its id in the metadata, its own customer, the key's
 * mode, prices we sell), saved, and – unless ClinForms staff have taken the clinic over by hand (override) – the
 * clinic's packages follow it:
 *
 *   active (first payment cleared)  ClinDesk band → "clinic" package active (plan code = band, practitioner limit);
 *                                   Reports add-on / ClinForms tier → "reports" active + the ClinForms allowance
 *                                   (clinic_package, from the price's reports_included); a ClinDesk plan without
 *                                   the add-on pauses "reports"; a running trial is converted ("paid")
 *   pending_payment                 nothing is switched on (a Direct Debit pays days later – Bacs is activated only
 *                                   by its cleared payment: checkout.session.async_payment_succeeded / invoice.paid)
 *   past_due                        everything keeps working for GRACE_DAYS (the owner is emailed), then the account
 *                                   is on hold (./access.ts: admin settings, invites, imports, marketing and new reports paused – never clinical work) until paid
 *   cancel at period end            the packages get the period's end as their end (they switch off by themselves)
 *   canceled                        the packages the subscription switched on are cancelled (no data deleted)
 *
 * Every change is audited (ids, plan keys and states only) under the clinic as "clinic.subscription_*", and by the
 * package writes themselves ("clinic.package_change", "clinic.package_set"). Idempotent: a re-read that changes
 * nothing writes no audit row.
 */
import "server-only";
import type { Kysely } from "kysely";
import { GRACE_DAYS, clinDeskBand, packageIdForReports, planOfItems, stateOf, type PlanChoice } from "../../lib/billing/plans";
import { EXTRA_REPORT_PENCE } from "../../lib/billing/plans";
import type { PmsActor } from "../../modules/pms/core/types";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { deleteClinicPackage, getClinicPackage, setClinicPackage } from "../repos/clinic-package";
import { endClinicTrial, getClinicPlan, setClinicDraftingLimits } from "../repos/clinic-plan";
import { TRIAL_LIMITS } from "../../lib/trial";
import { getClinicSubscription, saveSubscriptionSnapshot, type AppliedEntitlements, type ClinicSubscription, type SubscriptionSnapshot } from "../repos/clinic-subscription";
import { getSmsCreditAccount } from "../repos/pms/comms/credits";
import { getEntitlement, setEntitlement } from "../repos/pms/entitlements";
import { markTrialConverted, readSelfTrial } from "../repos/self-trial";
import { assertTenantId } from "../repos/context";
import { billingLiveRequired } from "../pms/comms/credits/card-payments";
import type { SubscriptionInfo, SubscriptionPayments } from "./payments";

export const BILLING_ACTOR: PmsActor = { userId: null, sessionId: null };
const DAY_MS = 86_400_000;

export type BillingNoticeKind = "payment_failed" | "read_only" | "payment_received" | "cancelled" | "trial_converted";

export interface SyncDeps {
  db: Kysely<Database>;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  /** Emails the clinic's owner and admins (./notify.ts). Never throws into a sync. */
  notify?: ((tenantId: string, notice: { kind: BillingNoticeKind; graceUntil?: string | null; endsOn?: string | null; product?: "clindesk" | "clinforms" }) => Promise<void>) | null;
  /** A paid subscription that was refused (./payment alerts). */
  alert?: ((info: { why: string; subscriptionId: string; tenantId: string | null }) => Promise<void>) | null;
}

export type SyncResult =
  | { status: "synced"; subscription: ClinicSubscription; changed: boolean }
  | { status: "refused"; why: string; tenantId: string | null }
  | { status: "ignored"; why: string };

function tenantFrom(md: Record<string, string>): string | null {
  const t = md.tenant_id;
  if (!t) return null;
  try {
    return assertTenantId(t);
  } catch {
    return null;
  }
}

/** Re-reads one subscription and applies it (see the file comment). */
export async function syncSubscription(deps: SyncDeps, payments: SubscriptionPayments, subscriptionId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const sub = await payments.getSubscription(subscriptionId);
  return applySubscription(deps, payments, sub, opts);
}

/** Applies the payment service's OWN copy of a subscription (exported for tests and the success page). */
export interface SyncOptions {
  eventId?: string | null;
  expectTenantId?: string | null;
  /** Re-apply the packages even when the subscription has not changed (the override was just switched off). */
  forceApply?: boolean;
}

export async function applySubscription(deps: SyncDeps, payments: Pick<SubscriptionPayments, "live" | "mode">, sub: SubscriptionInfo, opts: SyncOptions = {}): Promise<SyncResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : new Date();
  const ctx = { db: deps.db, now: () => now };
  const refuse = async (why: string, tenantId: string | null): Promise<SyncResult> => {
    if (deps.alert) await deps.alert({ why, subscriptionId: sub.id, tenantId }).catch(() => undefined);
    return { status: "refused", why, tenantId };
  };
  if (sub.metadata.kind && sub.metadata.kind !== "clinic_plan") return { status: "ignored", why: "not_a_clinic_plan" };
  if (sub.livemode !== payments.live) return refuse("wrong_mode", null);
  if (!sub.livemode && billingLiveRequired(env)) return refuse("test_mode_while_live", null);
  const tenantId = tenantFrom(sub.metadata);
  if (!tenantId) return refuse("no_clinic", null);
  if (opts.expectTenantId && opts.expectTenantId !== tenantId) return refuse("other_clinic", tenantId);
  const org = await deps.db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org) return refuse("unknown_clinic", tenantId);
  // One customer per clinic: the subscription must be on the clinic's own customer, in this mode.
  const acct = await getSmsCreditAccount(ctx, tenantId);
  if (!acct.customerRef || acct.customerRef !== sub.customer || (acct.customerMode ?? "test") !== payments.mode) return refuse("customer_mismatch", tenantId);
  const plan = planOfItems(sub.items.map((i) => i.lookupKey ?? ""));
  if (!plan.ok) return refuse(plan.why, tenantId);
  // The allowance comes from the price metadata (checked against our list when the price was used to sell).
  const reportsItem = sub.items.find((i) => i.reportsIncluded !== null);
  const reportsIncluded = reportsItem?.reportsIncluded ?? null;

  const before = await getClinicSubscription(ctx, tenantId);
  // A different subscription than the one recorded: only the newer one counts while the old one is still running
  // (a second checkout by mistake is ended by the caller – ./views.ts never starts one while one runs).
  if (before && before.subscriptionRef !== sub.id && before.state !== "canceled" && before.state !== "expired" && stateOf(sub.status, false) === "canceled") {
    return { status: "ignored", why: "older_subscription" };
  }
  const same = before?.subscriptionRef === sub.id;
  const firstPaid = Boolean((same && before?.activatedAt) || sub.latestInvoice?.paid || (sub.latestInvoice && sub.latestInvoice.amountDue === 0 && sub.latestInvoice.status === "paid"));
  const state = stateOf(sub.status, firstPaid);
  const activatedAt = same && before?.activatedAt ? before.activatedAt : firstPaid ? now.toISOString() : null;
  const pastDueSince = state === "past_due" ? (same && before?.pastDueSince ? before.pastDueSince : now.toISOString()) : null;
  const graceUntil = pastDueSince ? new Date(Date.parse(pastDueSince) + GRACE_DAYS * DAY_MS).toISOString() : null;
  const choice = plan.choice;
  const band = choice.product === "clindesk" ? clinDeskBand(choice.band) : null;
  const amount = sub.items.reduce((n, i) => n + (i.unitAmount ?? 0), 0);

  const override = before?.override === true;
  const prevApplied = same || before ? (before?.applied ?? null) : null;
  const applied = override ? prevApplied : appliedFor(state, choice, reportsIncluded, sub, prevApplied);

  const snap: SubscriptionSnapshot = {
    customerRef: sub.customer as string,
    subscriptionRef: sub.id,
    mode: sub.livemode ? "live" : "test",
    status: sub.status,
    state,
    product: choice.product,
    planKey: choice.product === "clindesk" ? choice.band : choice.tier,
    interval: choice.product === "clindesk" ? choice.interval : "month",
    reportsKey: choice.product === "clindesk" ? choice.reports : choice.tier,
    reportsIncluded,
    practitionersMax: band?.max ?? null,
    amountPence: amount,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd || Boolean(sub.cancelAt),
    canceledAt: sub.canceledAt,
    endedAt: sub.endedAt,
    activatedAt,
    pastDueSince,
    graceUntil,
    applied,
    lastEventRef: opts.eventId ?? before?.lastEventRef ?? null,
  };
  const saved = await saveSubscriptionSnapshot(ctx, tenantId, snap);

  const changedState = !before || !same || before.state !== state || before.planKey !== snap.planKey || before.reportsKey !== snap.reportsKey || before.interval !== snap.interval || before.cancelAtPeriodEnd !== snap.cancelAtPeriodEnd;
  const changedApplied = JSON.stringify(prevApplied) !== JSON.stringify(applied) || (opts.forceApply === true && !override);
  if (!override && changedApplied && applied) await applyEntitlements(ctx, tenantId, applied, opts.forceApply ? null : prevApplied, choice, sub, firstPaid && (!before?.activatedAt || !same));
  if (changedState || changedApplied) {
    await appendAudit(ctx, tenantId, {
      userId: null,
      action: `clinic.subscription_${state}`,
      targetType: "clinic_subscription",
      targetId: sub.id,
      detail: {
        plan: snap.planKey,
        product: snap.product,
        interval: snap.interval,
        reports: snap.reportsKey,
        state,
        status: sub.status,
        from: before ? before.state : null,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
        override,
        ...(opts.eventId ? { event: opts.eventId } : {}),
      },
    });
  }
  await sendNotices(deps, tenantId, before, saved, now);
  // 13/11/2026: a self-serve free trial and a paid subscription – converted on EVERY sync until done (idempotent; a crash
  // part-way, or a conversion by hand on the platform page, is finished by the next sync), then "you're on a paid plan"
  // once (the email's own claim).
  if (!override && saved.activatedAt && (state === "active" || state === "past_due")) {
    const newly = await finishSelfServeTrial(ctx, tenantId, { choice, reportsIncluded }).catch(() => false);
    if (newly && deps.notify) await deps.notify(tenantId, { kind: "trial_converted", product: choice.product }).catch(() => undefined);
  }
  return { status: "synced", subscription: saved, changed: changedState || changedApplied };
}

/** What the clinic's packages should be for this subscription state (null: not touched yet). */
export function appliedFor(
  state: ClinicSubscription["state"],
  choice: PlanChoice,
  reportsIncluded: number | null,
  sub: Pick<SubscriptionInfo, "cancelAtPeriodEnd" | "cancelAt" | "currentPeriodEnd">,
  prev: AppliedEntitlements | null,
): AppliedEntitlements | null {
  if (state === "pending_payment" || state === "expired") return prev;
  if (state === "canceled") {
    if (!prev) return null;
    return { clinic: prev.clinic === "active" ? "cancelled" : prev.clinic, reports: prev.reports === "active" ? "cancelled" : prev.reports, reportsIncluded: prev.reportsIncluded, endsAt: null };
  }
  const endsAt = sub.cancelAtPeriodEnd || sub.cancelAt ? (sub.cancelAt ?? sub.currentPeriodEnd) : null;
  const clindesk = choice.product === "clindesk";
  return {
    clinic: clindesk ? "active" : prev?.clinic === "active" ? "cancelled" : null,
    reports: reportsIncluded !== null ? "active" : clindesk ? "paused" : null,
    reportsIncluded,
    endsAt,
  };
}

async function applyEntitlements(
  ctx: { db: Kysely<Database>; now: () => Date },
  tenantId: string,
  applied: AppliedEntitlements,
  prev: AppliedEntitlements | null,
  choice: PlanChoice,
  sub: SubscriptionInfo,
  firstActivation: boolean,
): Promise<void> {
  const note = "subscription";
  // 13/11/2026: a self-serve trial's product still on "trial" is never switched off here – finishSelfServeTrial keeps it
  // readable (read-only) when it holds the trial's data (owner: never lose access to data), or pauses it when empty.
  const keep = async (pkg: "clinic" | "reports", status: string) => status !== "active" && (await keptTrialProduct(ctx, tenantId, pkg));
  if (applied.clinic && !(await keep("clinic", applied.clinic))) {
    await setEntitlement(
      ctx,
      tenantId,
      "clinic",
      {
        status: applied.clinic,
        planCode: choice.product === "clindesk" ? `clindesk-${choice.band}` : null,
        priceSource: "list",
        limits: choice.product === "clindesk" ? { practitioners_max: clinDeskBand(choice.band)?.max ?? 0 } : null,
        endsAt: applied.clinic === "active" ? applied.endsAt : null,
        note,
      },
      BILLING_ACTOR,
    );
  }
  if (applied.reports && !(await keep("reports", applied.reports))) {
    await setEntitlement(
      ctx,
      tenantId,
      "reports",
      { status: applied.reports, planCode: applied.reportsIncluded !== null ? `reports-${applied.reportsIncluded}` : null, priceSource: "list", endsAt: applied.reports === "active" ? applied.endsAt : null, note },
      BILLING_ACTOR,
    );
  }
  // The ClinForms allowance (clinic_package) follows the reports in the plan.
  if (applied.reports === "active" && applied.reportsIncluded !== null && applied.reportsIncluded !== prev?.reportsIncluded) {
    const reportsItem = sub.items.find((i) => i.reportsIncluded !== null);
    const pkg = await setClinicPackage(ctx, tenantId, {
      package: packageIdForReports(applied.reportsIncluded),
      monthlyPricePence: reportsItem?.unitAmount ?? 0,
      reportsIncluded: applied.reportsIncluded,
      extraReportPence: EXTRA_REPORT_PENCE,
      notes: "Set by the clinic's subscription.",
    });
    await appendAudit(ctx, tenantId, { userId: null, action: "clinic.package_set", targetType: "clinic", targetId: tenantId, detail: { package: pkg.package, reportsIncluded: pkg.reportsIncluded, by: "subscription" } });
  } else if (applied.reports !== "active" && prev?.reports === "active" && (await getClinicPackage(ctx, tenantId))) {
    await deleteClinicPackage(ctx, tenantId);
    await appendAudit(ctx, tenantId, { userId: null, action: "clinic.package_removed", targetType: "clinic", targetId: tenantId, detail: { by: "subscription" } });
  }
  if (firstActivation) {
    const plan = await getClinicPlan(ctx, tenantId).catch(() => null);
    if (plan?.status === "trial") {
      await endClinicTrial(ctx, tenantId, "paid");
      await appendAudit(ctx, tenantId, { userId: null, action: "clinic.trial_converted", targetType: "clinic", targetId: tenantId, detail: { by: "subscription" } });
    }
  }
}

/** A self-serve trial's product still on "trial" (the sync must not switch it off – finishSelfServeTrial decides). */
async function keptTrialProduct(ctx: { db: Kysely<Database>; now: () => Date }, tenantId: string, pkg: "clinic" | "reports"): Promise<boolean> {
  const e = await getEntitlement(ctx, tenantId, pkg).catch(() => null);
  if (e?.status !== "trial") return false;
  const trial = await readSelfTrial(ctx, tenantId).catch(() => null);
  return Boolean(trial && !trial.sampleOf);
}

/** Whether the trial left data in a product (kept readable after converting): patients for ClinDesk, reports for Reports. */
async function productHasData(db: Kysely<Database>, tenantId: string, pkg: "clinic" | "reports"): Promise<boolean> {
  try {
    const table = pkg === "clinic" ? "pms_patients" : "reports";
    const row = await db.selectFrom(table).select("tenant_id").where("tenant_id", "=", tenantId).limit(1).executeTakeFirst();
    return Boolean(row);
  } catch {
    return true; // cannot tell: keep it readable (never lose access)
  }
}

/**
 * 13/11/2026 – a self-serve free trial with a paid subscription (docs/clinic-system/trial.md §3). Run on EVERY sync of
 * an active subscription until done, each step idempotent, so a crash part-way or a conversion by hand (platform page)
 * is finished by the next sync. Returns true only the first time the trial is marked converted (for the email).
 *
 *   1. the plan "paid" (if still a trial) and self_trial.converted_at;
 *   2. the trial's drafting limits (5/min, 60/day) back to the defaults – unless staff changed them;
 *   3. the free "Trial" package goes unless Reports is in the plan (then the plan's own package replaced it);
 *   4. each product: in the plan → active (also repairs a crash before the packages were written); not in the plan
 *      → kept "trial" = READ-ONLY when it holds the trial's data (never lose access – "add <product> to keep working on
 *      these"), else paused. Every record is kept either way.
 */
export async function finishSelfServeTrial(
  ctx: { db: Kysely<Database>; now: () => Date },
  tenantId: string,
  plan: { choice: PlanChoice; reportsIncluded: number | null },
): Promise<boolean> {
  const trial = await readSelfTrial(ctx, tenantId);
  if (!trial || trial.sampleOf) return false;
  const current = await getClinicPlan(ctx, tenantId);
  if (current?.status === "trial") {
    await endClinicTrial(ctx, tenantId, "paid");
    await appendAudit(ctx, tenantId, { userId: null, action: "clinic.trial_converted", targetType: "clinic", targetId: tenantId, detail: { by: "subscription" } });
  }
  const newly = await markTrialConverted(ctx, tenantId);
  const limits = await getClinicPlan(ctx, tenantId);
  if (limits && limits.livePerMinute === TRIAL_LIMITS.draftingPerMinute && limits.livePerDay === TRIAL_LIMITS.draftingPerDay) {
    await setClinicDraftingLimits(ctx, tenantId, { perMinute: null, perDay: null });
  }
  const reportsInPlan = plan.reportsIncluded !== null;
  const pkg = await getClinicPackage(ctx, tenantId);
  if (pkg?.package === "trial" && !reportsInPlan) {
    await deleteClinicPackage(ctx, tenantId);
    await appendAudit(ctx, tenantId, { userId: null, action: "clinic.package_removed", targetType: "clinic", targetId: tenantId, detail: { by: "subscription", trial: true } });
  }
  const clinDesk = plan.choice.product === "clindesk";
  const band = plan.choice.product === "clindesk" ? clinDeskBand(plan.choice.band) : null;
  const clinic = await getEntitlement(ctx, tenantId, "clinic");
  if (clinic?.status === "trial") {
    if (clinDesk) {
      await setEntitlement(ctx, tenantId, "clinic", { status: "active", planCode: band ? `clindesk-${band.key}` : null, priceSource: "list", limits: band ? { practitioners_max: band.max } : null, note: "subscription" }, BILLING_ACTOR);
    } else if (!(await productHasData(ctx.db, tenantId, "clinic"))) {
      await setEntitlement(ctx, tenantId, "clinic", { status: "paused", note: "Trial ended: ClinDesk not in the paid plan (no data)" }, BILLING_ACTOR);
    }
  }
  const reports = await getEntitlement(ctx, tenantId, "reports");
  if (reports?.status === "trial") {
    if (reportsInPlan) {
      await setEntitlement(ctx, tenantId, "reports", { status: "active", planCode: `reports-${plan.reportsIncluded}`, priceSource: "list", note: "subscription" }, BILLING_ACTOR);
    } else if (!(await productHasData(ctx.db, tenantId, "reports"))) {
      await setEntitlement(ctx, tenantId, "reports", { status: "paused", note: "Trial ended: Reports not in the paid plan (no data)" }, BILLING_ACTOR);
    }
  }
  return newly;
}

async function sendNotices(deps: SyncDeps, tenantId: string, before: ClinicSubscription | null, after: ClinicSubscription, now: Date): Promise<void> {
  if (!deps.notify || after.override) return;
  const { claimSubscriptionNotice } = await import("../repos/clinic-subscription");
  const ctx = { db: deps.db, now: () => now };
  const send = async (n: Parameters<NonNullable<SyncDeps["notify"]>>[1]) => {
    try {
      await deps.notify!(tenantId, n);
    } catch {
      // an email that fails never stops a sync
    }
  };
  if (after.state === "past_due") {
    if (await claimSubscriptionNotice(ctx, tenantId, "grace")) await send({ kind: "payment_failed", graceUntil: after.graceUntil });
    if (after.graceUntil && Date.parse(after.graceUntil) <= now.getTime() && (await claimSubscriptionNotice(ctx, tenantId, "read_only"))) await send({ kind: "read_only" });
    return;
  }
  if (before?.state === "past_due" && after.state === "active" && before.subscriptionRef === after.subscriptionRef) await send({ kind: "payment_received" });
  const newlyCancelling = after.cancelAtPeriodEnd && !(before?.subscriptionRef === after.subscriptionRef && before.cancelAtPeriodEnd);
  if (after.state === "active" && newlyCancelling) await send({ kind: "cancelled", endsOn: after.currentPeriodEnd });
}
