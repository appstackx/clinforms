/**
 * `pms_intake_handoffs` – a patient completes a form IN THE CLINIC on a clinic device ("Hand to patient", FORM-007):
 *
 * - a member of staff (patients.edit) starts a hand-off for one unanswered copy: the device gets a one-time secret
 *   (an httpOnly cookie limited to the clinic's device page) – only its SHA-256 is stored; the hand-off lasts
 *   PORTAL_TIMINGS.handoffMinutes and starting another one for the same copy ends the earlier one;
 * - the device shows ONLY that form; the patient's completion is the ordinary sealed submit of the copy, and the
 *   hand-off is marked "completed" in the SAME batch (only while this submit's write id is on the copy);
 * - the device then shows "Hand back to staff"; a member of staff confirms with their password → "verified"
 *   (who and when are kept here and in the audit; the signed copy shows "Completed in the clinic, verified by …").
 *
 * Every change carries a fresh write id and its conditional audit row keys on it. Never deleted.
 */
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsIntakeHandoffsTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, nowIso, pmsId, type DbContext } from "../context";
import { changeWithAudit, newPortalWriteId, portalAuditWhen, portalAuditWhenWritten, writtenRow } from "./shared";

const H = "pms_intake_handoffs";
const TR = "pms_intake_responses";
const HASH = /^[0-9a-f]{64}$/;

export type HandoffStatus = "open" | "completed" | "verified" | "ended";

export interface IntakeHandoff {
  tenantId: string;
  id: string;
  responseId: string;
  patientId: string;
  status: HandoffStatus;
  startedBy: string;
  expiresAt: string;
  completedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
  createdAt: string;
}

/** Postgres hands timestamptz back as a Date; D1 as text – always ISO text here. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

function toHandoff(r: Selectable<PmsIntakeHandoffsTable>): IntakeHandoff {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    responseId: r.response_id,
    patientId: r.patient_id,
    status: r.status as HandoffStatus,
    startedBy: r.started_by,
    expiresAt: iso(r.expires_at) as string,
    completedAt: iso(r.completed_at),
    verifiedAt: iso(r.verified_at),
    verifiedBy: r.verified_by,
    endedAt: iso(r.ended_at),
    endedBy: r.ended_by,
    createdAt: iso(r.created_at) as string,
  };
}

/** Whether an open hand-off can still be used at `nowMs`. */
export function handoffUsable(h: Pick<IntakeHandoff, "status" | "expiresAt">, nowMs: number): boolean {
  return h.status === "open" && Date.parse(h.expiresAt) > nowMs;
}

/**
 * Starts a hand-off of one unanswered copy (status "requested", of this patient) – refused otherwise. Any earlier
 * open hand-off of the same copy is ended in the same batch. Answers the new hand-off.
 */
export async function startHandoff(
  ctx: DbContext,
  tenantId: string,
  input: { responseId: string; patientId: string; tokenHash: string; expiresAt: string },
  actor: PmsActor,
): Promise<IntakeHandoff> {
  assertTenantId(tenantId);
  assertId(input.responseId, "form copy id");
  assertId(input.patientId, "patient id");
  if (!HASH.test(input.tokenHash)) throw new RepoInputError("The device secret must be a SHA-256 hash.");
  if (!actor.userId) throw new RepoInputError("Only a member of staff can hand a form to a patient.");
  const id = pmsId(P.handoff, ctx);
  const at = nowIso(ctx);
  const endWrite = newPortalWriteId(ctx);
  const startWrite = newPortalWriteId(ctx);
  const copyOpen = ctx.db
    .selectFrom(TR)
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", input.responseId)
    .where("patient_id", "=", input.patientId)
    .where("status", "=", "requested")
    .where("kind", "!=", "outcome");
  const row = {
    tenant_id: tenantId,
    id,
    response_id: input.responseId,
    patient_id: input.patientId,
    token_hash: input.tokenHash,
    status: "open",
    started_by: actor.userId,
    expires_at: input.expiresAt,
    write_id: startWrite,
    created_at: at,
    updated_at: at,
  };
  const columns = Object.keys(row) as (keyof typeof row)[];
  const queries: BatchQuery[] = [
    ctx.db
      .updateTable(H)
      .set({ status: "ended", ended_at: at, ended_by: actor.userId, write_id: endWrite, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("response_id", "=", input.responseId)
      .where("status", "=", "open"),
    portalAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.intake_handoff.end", targetType: "pms_intake_response", targetId: input.responseId, detail: { reason: "replaced" } },
      ctx.db.selectFrom(H).select("id").where("tenant_id", "=", tenantId).where("response_id", "=", input.responseId).where("write_id", "=", endWrite),
    ),
    ctx.db
      .insertInto(H)
      .columns(columns)
      .expression(ctx.db.selectNoFrom((eb) => columns.map((c) => eb.val(row[c]).as(c)) as never).where((eb) => eb.exists(copyOpen)) as never),
    portalAuditWhenWritten(
      ctx,
      tenantId,
      actor,
      { action: "pms.intake_handoff.start", targetType: "pms_intake_response", targetId: input.responseId, detail: { handoff: id, patientId: input.patientId } },
      H,
      id,
      startWrite,
    ),
  ];
  await changeWithAudit(ctx, queries, 2, { foreignKey: "That patient or form does not exist in this clinic." });
  const made = await getHandoff(ctx, tenantId, id);
  if (!made) throw new RepoInputError("This form can no longer be completed in the clinic (it was completed, withdrawn, or is a questionnaire).");
  return made;
}

export async function getHandoff(ctx: DbContext, tenantId: string, id: string): Promise<IntakeHandoff | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(H).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toHandoff(row) : null;
}

/** The hand-off a device's secret belongs to (by its hash), or null. */
export async function findHandoffByToken(ctx: DbContext, tenantId: string, tokenHash: string): Promise<IntakeHandoff | null> {
  assertTenantId(tenantId);
  if (!HASH.test(tokenHash)) return null;
  const row = await ctx.db.selectFrom(H).selectAll().where("tenant_id", "=", tenantId).where("token_hash", "=", tokenHash).executeTakeFirst();
  return row ? toHandoff(row) : null;
}

/** The hand-off that completed a copy (completed or verified), if it was completed in the clinic. */
export async function handoffForResponse(ctx: DbContext, tenantId: string, responseId: string): Promise<IntakeHandoff | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(H)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("response_id", "=", responseId)
    .where("completed_at", "is not", null)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? toHandoff(row) : null;
}

/** Hand-offs completed in the clinic for several copies (the Forms tab list) – response id → hand-off. */
export async function handoffsForResponses(ctx: DbContext, tenantId: string, patientId: string): Promise<Map<string, IntakeHandoff>> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(H).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).orderBy("created_at", "desc").limit(200).execute();
  const out = new Map<string, IntakeHandoff>();
  for (const r of rows) {
    const h = toHandoff(r);
    if (!out.has(h.responseId) || (h.completedAt && !out.get(h.responseId)!.completedAt)) out.set(h.responseId, h);
  }
  return out;
}

/**
 * The statement (for the submit's batch) that marks an open, unexpired hand-off "completed" – only while the copy
 * carries the submit's write id, so it runs exactly when the seal did.
 */
export function handoffCompletedQuery(ctx: DbContext, tenantId: string, handoffId: string, responseId: string, submitWriteId: string): BatchQuery {
  const at = nowIso(ctx);
  return ctx.db
    .updateTable(H)
    .set({ status: "completed", completed_at: at, write_id: submitWriteId, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", handoffId)
    .where("response_id", "=", responseId)
    .where("status", "=", "open")
    .where("expires_at", ">", at)
    .where((eb) => eb.exists(writtenRow(ctx, tenantId, TR, responseId, submitWriteId)));
}

/** A member of staff confirmed (with their password) a copy completed on the device. Audited in the batch. */
export async function verifyHandoff(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "hand-off id");
  if (!actor.userId) throw new RepoInputError("Only a member of staff can verify a form completed in the clinic.");
  const h = await getHandoff(ctx, tenantId, id);
  if (!h) return false;
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(H)
      .set({ status: "verified", verified_at: at, verified_by: actor.userId, write_id: writeId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "completed"),
    portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_response.verify", targetType: "pms_intake_response", targetId: h.responseId, detail: { handoff: id, via: "clinic_device" } }, H, id, writeId),
  ]);
  return changed > 0;
}

/** Ends a hand-off without verifying it (the device stops showing the form; a completed copy stays unverified). */
export async function endHandoff(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "hand-off id");
  const h = await getHandoff(ctx, tenantId, id);
  if (!h) return false;
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(H)
      .set({ status: "ended", ended_at: at, ended_by: actor.userId, write_id: writeId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "in", ["open", "completed"]),
    portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.intake_handoff.end", targetType: "pms_intake_response", targetId: h.responseId, detail: { handoff: id, reason: h.status === "completed" ? "not_verified" : "stopped" } }, H, id, writeId),
  ]);
  return changed > 0;
}
