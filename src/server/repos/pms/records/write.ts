/**
 * Conditional updates of the records module with their audit row in the SAME atomic batch (runBatch – one D1 batch,
 * a transaction elsewhere). The audit row is an INSERT … SELECT … WHERE EXISTS (src/server/repos/audit.ts
 * auditInsertWhenExists) that looks for the row exactly as the update leaves it (its new revision and timestamp),
 * so the audit row exists exactly when the change does: a stale form, another member or a locked note changes
 * nothing and leaves no audit row.
 *
 * Where the update writes a fresh ciphertext (random IV) the check names it, which makes it exact. Otherwise it names
 * the new revision and timestamp: only a second write that reached the SAME revision in the SAME millisecond could
 * be mistaken for this one (an extra audit row, never a missing one).
 */
import type { Expression } from "kysely";
import type { BatchQuery } from "../../../db/batch";
import { runBatch } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { assertActor, translateDbError, type ConstraintMessages, type PmsActor, type PmsAuditEntry } from "../context";
import type { DbContext } from "../../context";

/** Runs `update` and the audit row for `entry` (written only when `changedRow` finds the updated row). */
export async function updateWithAudit(
  ctx: DbContext,
  tenantId: string,
  actor: PmsActor,
  update: BatchQuery,
  entry: PmsAuditEntry,
  changedRow: Expression<unknown>,
  messages: ConstraintMessages = {},
): Promise<boolean> {
  const who = assertActor(actor);
  const audit = auditInsertWhenExists(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }, changedRow).query;
  let results;
  try {
    results = await runBatch(ctx.db, [update, audit]);
  } catch (err) {
    throw translateDbError(err, messages);
  }
  return Number((results[0] as { numAffectedRows?: bigint | number } | undefined)?.numAffectedRows ?? 0) > 0;
}
