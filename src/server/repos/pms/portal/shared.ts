/**
 * Shared helpers of the portal repositories: a change and its audit row in ONE batch (as billing §14.1 and comms
 * §15.1). The audit INSERT is written only while `whenExists` finds the row the change just marked, so the audit row
 * exists exactly when the change does – on D1 too.
 *
 * Tables with a `write_id` column (pms_intake_responses, pms_portal_shares, pms_portal_sessions, pms_intake_handoffs –
 * migrations 0182–0185) key that mark on a fresh write id per change (`newPortalWriteId` + `portalAuditWhenWritten`),
 * like the diary: two identical writes in the same millisecond cannot both audit – only the one whose conditional
 * UPDATE ran left its write id on the row. The other portal tables still key on the new revision and time.
 */
import type { Expression } from "kysely";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { ulid } from "../../context";
import { assertActor, translateDbError, type ConstraintMessages, type DbContext, type PmsAuditEntry } from "../context";
import { pmsNowMs } from "../../../../modules/pms/core/clock";

/** The portal tables whose rows carry a write id. */
export type PortalWriteTable = "pms_intake_responses" | "pms_portal_shares" | "pms_portal_sessions" | "pms_intake_handoffs";

/** A fresh write id ("w_<ULID>" – unique even within one millisecond). */
export function newPortalWriteId(ctx: DbContext): string {
  return `w_${ulid(ctx.now ? ctx.now().getTime() : pmsNowMs())}`;
}

/** The row `rowId` of `table`, while it carries `writeId` (the change of THIS write ran). */
export function writtenRow(ctx: DbContext, tenantId: string, table: PortalWriteTable, rowId: string, writeId: string): Expression<unknown> {
  return ctx.db.selectFrom(table).select("id").where("tenant_id", "=", tenantId).where("id", "=", rowId).where("write_id", "=", writeId);
}

/** The audit INSERT of a change of a write-id table: written in the same batch only when this write changed the row. */
export function portalAuditWhenWritten(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry, table: PortalWriteTable, rowId: string, writeId: string): BatchQuery {
  return portalAuditWhen(ctx, tenantId, actor, entry, writtenRow(ctx, tenantId, table, rowId, writeId));
}

/** The audit INSERT of a change, written only when `whenExists` finds a row as the batch runs. */
export function portalAuditWhen(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry, whenExists: Expression<unknown>): BatchQuery {
  const who = assertActor(actor);
  return auditInsertWhenExists(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }, whenExists).query;
}

function affected(result: unknown): number {
  const r = result as { numAffectedRows?: bigint; numUpdatedRows?: bigint } | undefined;
  return r ? Number(r.numAffectedRows ?? r.numUpdatedRows ?? 0) : 0;
}

/** Runs the change (index `changeIndex`) and its conditional audit as one batch; answers rows changed. */
export async function changeWithAudit(ctx: DbContext, queries: BatchQuery[], changeIndex = 0, messages: ConstraintMessages = {}): Promise<number> {
  try {
    const results = await runBatch(ctx.db, queries);
    return affected(results[changeIndex]);
  } catch (err) {
    throw translateDbError(err, messages);
  }
}
