/**
 * `pms_portal_shares` – documents a member of staff EXPLICITLY shares with a patient in the portal (a home
 * exercise plan, a letter). The portal shows nothing of the clinical record unless it is shared here. The body is
 * encrypted; the title is plain (lists show it – staff are asked to keep clinical detail out of it). Withdrawing
 * hides a document from the patient; nothing is deleted.
 */
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { PortalShareInputSchema, type PortalShareInput } from "../../../../modules/pms/portal/schemas";
import type { PortalShare, PortalShareSummary } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsPortalSharesTable } from "../../../db/pms-schema/portal";
import { assertId, assertTenantId, decryptField, encryptField, nowIso, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";
import { changeWithAudit, portalAuditWhen } from "./shared";

const T = "pms_portal_shares";
const SUMMARY = ["tenant_id", "id", "patient_id", "title", "shared_by", "shared_at", "viewed_at", "withdrawn_at"] as const;

function toSummary(r: Pick<Selectable<PmsPortalSharesTable>, (typeof SUMMARY)[number]>): PortalShareSummary {
  return { tenantId: r.tenant_id, id: r.id, patientId: r.patient_id, title: r.title, sharedBy: r.shared_by, sharedAt: r.shared_at, viewedAt: r.viewed_at, withdrawnAt: r.withdrawn_at };
}

export async function sharePortalDocument(ctx: RepoContext, tenantId: string, input: PortalShareInput, actor: PmsActor, extra: BatchQuery[] = []): Promise<PortalShareSummary> {
  assertTenantId(tenantId);
  const d = parseInput(PortalShareInputSchema, input, "Shared document");
  const id = pmsId(P.share, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        patient_id: d.patientId,
        title: d.title,
        body_enc: encryptField(ctx, tenantId, T, "body_enc", id, d.body) as string,
        shared_by: actor.userId,
        shared_at: at,
        viewed_at: null,
        withdrawn_at: null,
        withdrawn_by: null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_share.create", targetType: "pms_portal_share", targetId: id, detail: { patientId: d.patientId } }),
      ...extra,
    ],
    { foreignKey: "That patient does not exist in this clinic." },
  );
  return (await listSharesForPatient(ctx, tenantId, d.patientId, { includeWithdrawn: true })).find((s) => s.id === id) as PortalShareSummary;
}

export async function listSharesForPatient(ctx: DbContext, tenantId: string, patientId: string, options: { includeWithdrawn?: boolean } = {}): Promise<PortalShareSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select(SUMMARY).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeWithdrawn) q = q.where("withdrawn_at", "is", null);
  const rows = await q.orderBy("shared_at", "desc").limit(200).execute();
  return rows.map(toSummary);
}

/** One shared document, decrypted (for the patient only when it is theirs and not withdrawn – the caller checks). */
export async function getPortalShare(ctx: RepoContext, tenantId: string, id: string): Promise<PortalShare | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  return { ...toSummary(row), body: decryptField(ctx, tenantId, T, "body_enc", row.id, row.body_enc) ?? "" };
}

/** The patient opened it (first time only). */
export async function markShareViewed(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "share id");
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ viewed_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("viewed_at", "is", null),
    portalAuditWhen(ctx, tenantId, actor, { action: "pms.portal_share.view", targetType: "pms_portal_share", targetId: id, detail: { via: "patient" } }, ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("viewed_at", "=", at)),
  ]);
  return changed > 0;
}

/** Hides a shared document from the patient (kept for the record). */
export async function withdrawShare(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "share id");
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ withdrawn_at: at, withdrawn_by: actor.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("withdrawn_at", "is", null),
    portalAuditWhen(ctx, tenantId, actor, { action: "pms.portal_share.withdraw", targetType: "pms_portal_share", targetId: id }, ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("withdrawn_at", "=", at)),
  ]);
  return changed > 0;
}
