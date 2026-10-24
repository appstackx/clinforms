/**
 * `pms_settings` – per clinic: how long clinical records are kept (never shorter than the defaults) and whether
 * the clinic is a demonstration clinic (fictional data only). No row = the defaults.
 */
import { DEFAULT_RETENTION } from "../../../modules/pms/core/retention";
import { PmsSettingsInputSchema, type PmsSettingsInput } from "../../../modules/pms/core/schemas";
import type { PmsActor, PmsSettings } from "../../../modules/pms/core/types";
import { assertTenantId, b01, isOn, nowIso, num, parseInput, pmsAuditQuery, writeWithAudit, type DbContext } from "./context";

export async function getPmsSettings(ctx: DbContext, tenantId: string): Promise<PmsSettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_settings").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!row) {
    return {
      tenantId,
      retentionAdultYears: DEFAULT_RETENTION.adultYears,
      retentionChildUntilAge: DEFAULT_RETENTION.childUntilAge,
      isDemo: false,
      createdAt: "",
      updatedAt: "",
    };
  }
  return {
    tenantId: row.tenant_id,
    retentionAdultYears: num(row.retention_adult_years),
    retentionChildUntilAge: num(row.retention_child_until_age),
    isDemo: isOn(row.is_demo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updatePmsSettings(ctx: DbContext, tenantId: string, input: PmsSettingsInput, actor: PmsActor): Promise<PmsSettings> {
  assertTenantId(tenantId);
  const data = parseInput(PmsSettingsInputSchema, input, "Settings");
  const current = await getPmsSettings(ctx, tenantId);
  const at = nowIso(ctx);
  const values = {
    retention_adult_years: data.retentionAdultYears ?? current.retentionAdultYears,
    retention_child_until_age: data.retentionChildUntilAge ?? current.retentionChildUntilAge,
    updated_by: actor.userId,
    updated_at: at,
  };
  const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);
  await writeWithAudit(ctx, [
    ctx.db
      .insertInto("pms_settings")
      .values({ tenant_id: tenantId, ...values, is_demo: b01(current.isDemo), created_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet(values)),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.settings.update", targetType: "pms_settings", targetId: tenantId, detail: { fields } }),
  ]);
  return getPmsSettings(ctx, tenantId);
}

/** Marks a clinic as a demonstration clinic (platform scripts only: scripts/pms/seed-demo.ts). */
export async function setDemoClinic(ctx: DbContext, tenantId: string, isDemo: boolean, actor: PmsActor): Promise<PmsSettings> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ctx.db
      .insertInto("pms_settings")
      .values({ tenant_id: tenantId, is_demo: b01(isDemo), updated_by: actor.userId, created_at: at, updated_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ is_demo: b01(isDemo), updated_by: actor.userId, updated_at: at })),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.settings.update", targetType: "pms_settings", targetId: tenantId, detail: { fields: ["isDemo"], isDemo } }),
  ]);
  return getPmsSettings(ctx, tenantId);
}
