/**
 * `pms_records_settings` – the clinic's record-keeping settings for clinical notes (one row per clinic, id
 * "records"; no row = the defaults). Configuration only, stored plain. Writes are revision-checked and audited in
 * the same batch.
 */
import { DEFAULT_RECORDS_SETTINGS, RecordsSettingsInputSchema, type RecordsSettings, type RecordsSettingsInput } from "../../../../modules/pms/records/settings";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { RepoInputError, assertActor, assertTenantId, nowIso, num, parseInput, pmsAuditQuery, writeWithAudit, type DbContext } from "../context";
import { updateWithAudit } from "./write";

const T = "pms_records_settings";
const ROW_ID = "records";

export async function getRecordsSettings(ctx: DbContext, tenantId: string): Promise<RecordsSettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", ROW_ID).executeTakeFirst();
  if (!row) return { ...DEFAULT_RECORDS_SETTINGS };
  return { unsignedNoteDays: num(row.unsigned_note_days), rev: num(row.rev), updatedAt: row.updated_at };
}

/** Saves the settings with the revision the form saw (0 = no row yet). */
export async function saveRecordsSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: RecordsSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const d = parseInput(RecordsSettingsInputSchema, input, "Settings");
  const at = nowIso(ctx);
  const entry = { action: "pms.records_settings.update", targetType: "pms_records_settings", targetId: ROW_ID, detail: { unsignedNoteDays: d.unsignedNoteDays, rev: expectedRev + 1 } };
  if (expectedRev === 0) {
    try {
      await writeWithAudit(
        ctx,
        [
          ctx.db.insertInto(T).values({ tenant_id: tenantId, id: ROW_ID, rev: 1, unsigned_note_days: d.unsignedNoteDays, updated_by: who.userId, created_at: at, updated_at: at }),
          pmsAuditQuery(ctx, tenantId, who, entry),
        ],
        { unique: "conflict" },
      );
    } catch (err) {
      if (err instanceof RepoInputError && err.message === "conflict") return { ok: false, reason: "conflict", currentRev: (await getRecordsSettings(ctx, tenantId)).rev };
      throw err;
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(T)
      .set({ unsigned_note_days: d.unsignedNoteDays, rev: expectedRev + 1, updated_by: who.userId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", ROW_ID)
      .where("rev", "=", expectedRev),
    entry,
    ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", ROW_ID).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
  );
  if (!changed) return { ok: false, reason: "conflict", currentRev: (await getRecordsSettings(ctx, tenantId)).rev };
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}
