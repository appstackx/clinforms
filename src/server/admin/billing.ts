/**
 * Subscriptions on the platform page and in the admin scripts (31/10/2026) – ClinForms staff only.
 *
 * PLATFORM OVERRIDES WIN: a clinic whose packages ClinForms staff manage by hand (`override` on its subscription row)
 * keeps whatever the admin scripts / the platform page set – the subscription is still recorded (state, next payment)
 * but changes no package and puts no hold on the account. The override is switched on
 *   - explicitly (platform page → Subscriptions, or npm run admin:set-billing-override -- --slug … --on), or
 *   - automatically when a package, allowance or trial is changed by hand (admin:set-entitlement, admin:set-package,
 *     the platform page's package forms) for a clinic with a running subscription – so a manual change is never
 *     undone by the next payment event;
 * and switched off only explicitly (… --off), which re-applies the subscription at once when payments are set up.
 * Audited twice like every plan change ("clinic.billing_override_on|off", "platform.billing_override_on|off").
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { getClinicSubscription, readClinicSubscriptions, setSubscriptionOverride, type ClinicSubscription } from "../repos/clinic-subscription";
import { RepoInputError } from "../repos/context";
import { auditPlanChange, requireOpenClinic, type PlanActor } from "./clinic-plan";

export interface PlatformBillingRow {
  tenantId: string;
  name: string;
  subscription: ClinicSubscription | null;
  practitioners: number;
}

export async function listBillingForPlatform(db: Kysely<Database>, clinics: readonly { tenantId: string; name: string }[]): Promise<{ available: boolean; rows: PlatformBillingRow[] }> {
  const subs = await readClinicSubscriptions({ db });
  const byTenant = new Map(subs.rows.map((s) => [s.tenantId, s]));
  let counts = new Map<string, number>();
  try {
    const rows = await db.selectFrom("pms_practitioners").select(["tenant_id", (eb) => eb.fn.countAll<number>().as("n")]).where("active", "=", 1).groupBy("tenant_id").execute();
    counts = new Map(rows.map((r) => [r.tenant_id, Number(r.n)]));
  } catch {
    // no clinic-system tables on this database: no counts
  }
  return { available: subs.available, rows: clinics.map((c) => ({ ...c, subscription: byTenant.get(c.tenantId) ?? null, practitioners: counts.get(c.tenantId) ?? 0 })) };
}

/** The override on / off (explicit). Off re-applies nothing by itself – the caller re-syncs (platform action). */
export async function setBillingOverride(db: Kysely<Database>, actor: PlanActor, tenantId: string, on: boolean, note: string | null): Promise<{ changed: boolean }> {
  await requireOpenClinic(db, tenantId);
  const sub = await getClinicSubscription({ db }, tenantId);
  if (!sub) throw new RepoInputError(`The clinic "${tenantId}" has no subscription – its packages are set by hand already.`);
  const r = await setSubscriptionOverride({ db }, tenantId, on, note);
  if (r.changed) await auditPlanChange(db, actor, tenantId, on ? "billing_override_on" : "billing_override_off", { subscription: sub.subscriptionRef, state: sub.state, noteGiven: Boolean(note) });
  return r;
}

/**
 * Called by every MANUAL package / allowance / trial change: with a running subscription (pending, active or past
 * due) and no override yet, the override goes on (platform overrides win). True = it was switched on now.
 */
export async function overrideForManualChange(db: Kysely<Database>, actor: PlanActor, tenantId: string, what: string): Promise<boolean> {
  let sub: ClinicSubscription | null;
  try {
    sub = await getClinicSubscription({ db }, tenantId);
  } catch {
    return false; // a database before migration 0009: no subscriptions
  }
  if (!sub || sub.override || sub.state === "canceled" || sub.state === "expired") return false;
  const r = await setSubscriptionOverride({ db }, tenantId, true, `Manual change: ${what}`.slice(0, 200));
  if (r.changed) await auditPlanChange(db, actor, tenantId, "billing_override_on", { subscription: sub.subscriptionRef, state: sub.state, because: what.slice(0, 40) });
  return r.changed;
}
