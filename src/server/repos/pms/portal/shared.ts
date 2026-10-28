/**
 * Shared helpers of the portal repositories: a change and its audit row in ONE batch (as billing §14.1 and comms
 * §15.1). The audit INSERT is written only while `whenExists` finds the row the change just marked (its new
 * revision and time), so the audit row exists exactly when the change does – on D1 too.
 */
import type { Expression } from "kysely";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { assertActor, translateDbError, type ConstraintMessages, type DbContext, type PmsAuditEntry } from "../context";

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
