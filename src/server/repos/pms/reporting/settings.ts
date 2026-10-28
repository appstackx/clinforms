/**
 * The clinic's report targets (pms_reporting_settings, one row per clinic; no row = the defaults): the utilisation
 * target the dashboard and the utilisation report compare against, and the DNA-rate target of the attendance report.
 * Revisioned: a save names the rev it was opened with. The change and its audit row go in one batch (the audit row
 * only when the change applied).
 */
import { z } from "zod";
import type { ReportTargets } from "../../../../modules/pms/reporting/setup-view";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { runBatch } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { RepoInputError, assertActor, assertTenantId, nowIso, num, parseInput, translateDbError, type DbContext } from "../context";

/** The clinic's report targets (src/modules/pms/reporting/setup-view.ts). */
export type ReportingSettings = ReportTargets;

export const REPORTING_DEFAULTS: ReportingSettings = { rev: 0, utilisationTargetPercent: 80, dnaTargetTenths: 40 };

export const ReportingSettingsInputSchema = z.object({
  utilisationTargetPercent: z.number().int("Whole percent").min(1, "At least 1 %").max(100, "At most 100 %"),
  dnaTargetTenths: z.number().int("Up to one decimal place").min(0, "Not below 0 %").max(500, "At most 50 %"),
});
export type ReportingSettingsInput = z.input<typeof ReportingSettingsInputSchema>;

const T = "pms_reporting_settings" as const;

export async function getReportingSettings(ctx: DbContext, tenantId: string): Promise<ReportingSettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!row) return { ...REPORTING_DEFAULTS };
  return { rev: num(row.rev), utilisationTargetPercent: num(row.utilisation_target_percent), dnaTargetTenths: num(row.dna_target_tenths) };
}

export async function updateReportingSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: ReportingSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const d = parseInput(ReportingSettingsInputSchema, input, "Report targets");
  const at = nowIso(ctx);
  const rev = expectedRev + 1;
  const values = { utilisation_target_percent: d.utilisationTargetPercent, dna_target_tenths: d.dnaTargetTenths, rev, updated_by: who.userId, updated_at: at };
  const write =
    expectedRev === 0
      ? ctx.db.insertInto(T).values({ tenant_id: tenantId, ...values, created_at: at }).onConflict((oc) => oc.column("tenant_id").doNothing())
      : ctx.db.updateTable(T).set(values).where("tenant_id", "=", tenantId).where("rev", "=", expectedRev);
  const audit = auditInsertWhenExists(
    ctx,
    tenantId,
    { action: "pms.report_targets.set", targetType: "pms_reporting_settings", targetId: tenantId, detail: { rev, utilisationTargetPercent: d.utilisationTargetPercent, dnaTargetTenths: d.dnaTargetTenths }, userId: who.userId, sessionId: who.sessionId },
    ctx.db.selectFrom(T).select("tenant_id").where("tenant_id", "=", tenantId).where("rev", "=", rev).where("updated_at", "=", at),
  ).query;
  try {
    await runBatch(ctx.db, [write, audit]);
  } catch (err) {
    throw translateDbError(err);
  }
  // Applied only if the row now carries this save's revision AND time (a stale save changed nothing).
  const row = await ctx.db.selectFrom(T).select(["rev", "updated_at"]).where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!row || num(row.rev) !== rev || String(row.updated_at) !== at) return { ok: false, reason: "conflict", currentRev: row ? num(row.rev) : 0 };
  return { ok: true, rev, updatedAt: at };
}
