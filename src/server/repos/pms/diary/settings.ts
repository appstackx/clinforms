/**
 * `pms_diary_settings` – the diary's own settings, one row per clinic (migration 0116). No row = every default:
 * dates of birth are NOT printed on the day sheet. Every change is audited in the same batch.
 */
import type { PmsActor } from "../../../../modules/pms/core/types";
import { assertTenantId, b01, isOn, nowIso, num, pmsAuditQuery, writeWithAudit, type DbContext } from "../context";

export interface DiarySettings {
  tenantId: string;
  rev: number;
  /** Print patients' dates of birth on the paper day sheet (default off). */
  showDobOnDaySheet: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const DEFAULT_DIARY_SETTINGS = { showDobOnDaySheet: false } as const;

export async function getDiarySettings(ctx: DbContext, tenantId: string): Promise<DiarySettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_diary_settings").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!row) return { tenantId, rev: 0, showDobOnDaySheet: DEFAULT_DIARY_SETTINGS.showDobOnDaySheet, updatedBy: null, updatedAt: null };
  return { tenantId: row.tenant_id, rev: num(row.rev), showDobOnDaySheet: isOn(row.show_dob_on_day_sheet), updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/** Switches "Show date of birth on the printed day sheet" on or off (the caller checks settings.manage). */
export async function setDaySheetDob(ctx: DbContext, tenantId: string, on: boolean, actor: PmsActor): Promise<DiarySettings> {
  assertTenantId(tenantId);
  if (typeof on !== "boolean") throw new TypeError("on must be a boolean");
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ctx.db
      .insertInto("pms_diary_settings")
      .values({ tenant_id: tenantId, rev: 1, show_dob_on_day_sheet: b01(on), updated_by: actor.userId, created_at: at, updated_at: at })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet((eb) => ({ show_dob_on_day_sheet: b01(on), updated_by: actor.userId, updated_at: at, rev: eb("pms_diary_settings.rev", "+", 1) }))),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.diary_settings.update", targetType: "pms_diary_settings", targetId: tenantId, detail: { fields: ["showDobOnDaySheet"], showDobOnDaySheet: on } }),
  ]);
  return getDiarySettings(ctx, tenantId);
}
