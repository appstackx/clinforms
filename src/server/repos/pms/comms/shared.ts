/**
 * Shared helpers of the comms repositories: a change and its audit row in ONE batch (M6 review, as billing's
 * §14.1 fix). The audit INSERT is written only while `whenExists` finds the row the change just marked (its new
 * revision and time), so the audit row exists exactly when the change does – on D1 too, where a batch is the only
 * transaction.
 */
import type { Expression } from "kysely";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { assertActor, translateDbError, type ConstraintMessages, type DbContext, type PmsAuditEntry } from "../context";

/** The audit INSERT of a change, written only when `whenExists` finds a row as the batch runs. */
export function commsAuditWhen(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry, whenExists: Expression<unknown>): BatchQuery {
  const who = assertActor(actor);
  return auditInsertWhenExists(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }, whenExists).query;
}

export function affected(result: { numAffectedRows?: bigint; numUpdatedRows?: bigint } | undefined): number {
  if (!result) return 0;
  return Number(result.numAffectedRows ?? result.numUpdatedRows ?? 0);
}

/**
 * Runs `queries` (the change first, the conditional audit last) as one batch and answers how many rows the query at
 * `changeIndex` changed (default 0). Constraint errors become plain RepoInputErrors.
 */
export async function changeWithAudit(ctx: DbContext, queries: BatchQuery[], changeIndex = 0, messages: ConstraintMessages = {}): Promise<number> {
  try {
    const results = await runBatch(ctx.db, queries);
    return affected(results[changeIndex] as { numAffectedRows?: bigint } | undefined);
  } catch (err) {
    throw translateDbError(err, messages);
  }
}
