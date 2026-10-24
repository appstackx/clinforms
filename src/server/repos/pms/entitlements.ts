/**
 * `clinic_entitlements` – the packages a clinic has ("reports", "clinic") – and `clinic_usage_counters`.
 * No row for a package = its default (reports ON, clinic OFF: src/modules/pms/core/entitlements.ts).
 * Changing a package writes `clinic.package_change` under the clinic in the same atomic batch.
 */
import {
  PACKAGE_DEFAULT_ON,
  USAGE_METRIC_PATTERN,
  isEntitlementStatus,
  isPackageId,
  isPriceSource,
  packageIsOn,
  usagePeriod,
  type EntitlementStatus,
  type PackageId,
  type PriceSource,
} from "../../../modules/pms/core/entitlements";
import type { Entitlement, PmsActor } from "../../../modules/pms/core/types";
import { assertIso, jsonOrNull, optionalText, parseJson } from "../context";
import { RepoInputError, assertTenantId, nowIso, pmsAuditQuery, writeWithAudit, type DbContext } from "./context";

type Row = {
  tenant_id: string;
  package: string;
  status: string;
  plan_code: string | null;
  price_source: string | null;
  limits_json: string | null;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function toEntitlement(row: Row): Entitlement | null {
  if (!isPackageId(row.package) || !isEntitlementStatus(row.status)) return null;
  return {
    tenantId: row.tenant_id,
    package: row.package,
    status: row.status,
    planCode: row.plan_code,
    priceSource: isPriceSource(row.price_source) ? row.price_source : null,
    limits: parseJson<Record<string, number>>(row.limits_json),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    note: row.note,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEntitlements(ctx: DbContext, tenantId: string): Promise<Entitlement[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom("clinic_entitlements").selectAll().where("tenant_id", "=", tenantId).orderBy("package").execute();
  return rows.map(toEntitlement).filter((e): e is Entitlement => e !== null);
}

export async function getEntitlement(ctx: DbContext, tenantId: string, pkg: PackageId): Promise<Entitlement | null> {
  assertTenantId(tenantId);
  if (!isPackageId(pkg)) throw new RepoInputError("Unknown package.");
  const row = await ctx.db.selectFrom("clinic_entitlements").selectAll().where("tenant_id", "=", tenantId).where("package", "=", pkg).executeTakeFirst();
  return row ? toEntitlement(row) : null;
}

/** Whether the package is on for the clinic now (no row = the package's default). */
export async function isPackageOn(ctx: DbContext, tenantId: string, pkg: PackageId): Promise<boolean> {
  const row = await getEntitlement(ctx, tenantId, pkg);
  return packageIsOn(pkg, row, ctx.now ? ctx.now() : new Date());
}

/** Every clinic's packages (platform page only – the one cross-clinic read here). */
export async function listEntitlementsByTenant(ctx: DbContext): Promise<Map<string, Entitlement[]>> {
  const rows = await ctx.db.selectFrom("clinic_entitlements").selectAll().orderBy("tenant_id").orderBy("package").execute();
  const out = new Map<string, Entitlement[]>();
  for (const row of rows) {
    const e = toEntitlement(row);
    if (!e) continue;
    const list = out.get(e.tenantId) ?? [];
    list.push(e);
    out.set(e.tenantId, list);
  }
  return out;
}

export interface SetEntitlementInput {
  status: EntitlementStatus;
  planCode?: string | null;
  priceSource?: PriceSource | null;
  limits?: Record<string, number> | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Short internal note (contract reference, "design partner"), never patient data. */
  note?: string | null;
}

export interface SetEntitlementResult {
  entitlement: Entitlement;
  /** On/off before and after (for the platform audit and messages). */
  wasOn: boolean;
  isOn: boolean;
}

/** Creates or replaces a clinic's package row and audits `clinic.package_change` in the same batch. */
export async function setEntitlement(ctx: DbContext, tenantId: string, pkg: PackageId, input: SetEntitlementInput, actor: PmsActor): Promise<SetEntitlementResult> {
  assertTenantId(tenantId);
  if (!isPackageId(pkg)) throw new RepoInputError("Unknown package.");
  if (!isEntitlementStatus(input.status)) throw new RepoInputError("Status must be active, trial, paused or cancelled.");
  if (input.priceSource !== undefined && input.priceSource !== null && !isPriceSource(input.priceSource)) {
    throw new RepoInputError("Price source must be list, founding or design_partner.");
  }
  if (input.limits) {
    for (const [k, v] of Object.entries(input.limits)) {
      if (!USAGE_METRIC_PATTERN.test(k) || !Number.isInteger(v) || v < 0) throw new RepoInputError("Limits are whole numbers by metric name.");
    }
  }
  const now = ctx.now ? ctx.now() : new Date();
  const before = await getEntitlement(ctx, tenantId, pkg);
  const wasOn = packageIsOn(pkg, before, now);
  const at = nowIso(ctx);
  const values = {
    status: input.status,
    plan_code: optionalText(input.planCode, "planCode", 40),
    price_source: input.priceSource ?? null,
    limits_json: jsonOrNull(input.limits ?? null, "limits", 2048),
    starts_at: input.startsAt ? assertIso(input.startsAt, "startsAt") : (before?.startsAt ?? at),
    ends_at: input.endsAt ? assertIso(input.endsAt, "endsAt") : null,
    note: optionalText(input.note, "note", 500),
    updated_by: actor.userId,
    updated_at: at,
  };
  const isOnAfter = packageIsOn(pkg, { status: values.status, endsAt: values.ends_at }, now);
  await writeWithAudit(ctx, [
    ctx.db
      .insertInto("clinic_entitlements")
      .values({ tenant_id: tenantId, package: pkg, ...values, created_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "package"]).doUpdateSet(values)),
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "clinic.package_change",
      targetType: "clinic",
      targetId: tenantId,
      detail: { package: pkg, status: input.status, from: before?.status ?? (PACKAGE_DEFAULT_ON[pkg] ? "default_on" : "default_off"), on: isOnAfter },
    }),
  ]);
  const saved = await getEntitlement(ctx, tenantId, pkg);
  if (!saved) throw new Error("clinic_entitlements upsert did not persist.");
  return { entitlement: saved, wasOn, isOn: isOnAfter };
}

/* ------------------------------------------------------------------------------------------------
 * Usage counters (monthly, per clinic and metric)
 * ----------------------------------------------------------------------------------------------*/

/** Adds `amount` to this month's counter and returns the new count (one atomic upsert). */
export async function incrementUsage(ctx: DbContext, tenantId: string, metric: string, amount = 1): Promise<number> {
  assertTenantId(tenantId);
  if (!USAGE_METRIC_PATTERN.test(metric)) throw new RepoInputError("Usage metrics are lower_snake_case.");
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) throw new RepoInputError("amount must be a positive whole number.");
  const at = nowIso(ctx);
  const period = usagePeriod(ctx.now ? ctx.now() : new Date());
  const row = await ctx.db
    .insertInto("clinic_usage_counters")
    .values({ tenant_id: tenantId, period, metric, count: amount, updated_at: at })
    .onConflict((oc) => oc.columns(["tenant_id", "period", "metric"]).doUpdateSet((eb) => ({ count: eb("clinic_usage_counters.count", "+", amount), updated_at: at })))
    .returning("count")
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** A clinic's counters for one month ("YYYY-MM"). */
export async function getUsage(ctx: DbContext, tenantId: string, period: string): Promise<Record<string, number>> {
  assertTenantId(tenantId);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new RepoInputError("period must be YYYY-MM.");
  const rows = await ctx.db.selectFrom("clinic_usage_counters").select(["metric", "count"]).where("tenant_id", "=", tenantId).where("period", "=", period).execute();
  return Object.fromEntries(rows.map((r) => [r.metric, Number(r.count)]));
}
