/**
 * `pms_portal_shares` – documents a member of staff EXPLICITLY shares with a patient in the portal (a home
 * exercise plan, a letter). The portal shows nothing of the clinical record unless it is shared here. The body is
 * encrypted; the title is plain (lists show it – staff are asked to keep clinical detail out of it). Withdrawing
 * hides a document from the patient; nothing is deleted.
 *
 * A share may hand the patient a FILE attached to the record (`pms_portal_share_files` → the records module's
 * `pms_attachments`, PORTAL-004): the share row keeps the title and an optional message (as its body), the file stays
 * where it is (encrypted, never copied). A withdrawn attachment is never handed out, whatever the share says.
 */
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { PortalFileShareInputSchema, PortalShareInputSchema, type PortalFileShareInput, type PortalShareInput } from "../../../../modules/pms/portal/schemas";
import type { PortalShare, PortalShareSummary } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsPortalSharesTable } from "../../../db/pms-schema/portal";
import { assertId, assertTenantId, decryptField, encryptField, fieldAadTable, nowIso, parseInput, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";
import { changeWithAudit, newPortalWriteId, portalAuditWhenWritten } from "./shared";

const T = "pms_portal_shares";
const TF = "pms_portal_share_files";
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

/**
 * Shares a file attached to the patient's record: the share (title, the message encrypted as its body), the link to
 * the file and the audit row in ONE batch. The caller checks the file is this patient's and not withdrawn; the
 * foreign keys refuse another clinic's patient or file.
 */
export async function shareAttachment(ctx: RepoContext, tenantId: string, input: PortalFileShareInput, actor: PmsActor, extra: BatchQuery[] = []): Promise<PortalShareSummary> {
  assertTenantId(tenantId);
  const d = parseInput(PortalFileShareInputSchema, input, "Shared document");
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
        // No message = an empty body (still encrypted: the column always holds ciphertext).
        body_enc: ctx.cipher.encrypt(d.message ?? "", { tenantId, table: fieldAadTable(T, "body_enc"), rowId: id }),
        shared_by: actor.userId,
        shared_at: at,
        viewed_at: null,
        withdrawn_at: null,
        withdrawn_by: null,
        created_at: at,
        updated_at: at,
      }),
      ctx.db.insertInto(TF).values({ tenant_id: tenantId, share_id: id, attachment_id: d.attachmentId, created_at: at }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_share.create", targetType: "pms_portal_share", targetId: id, detail: { patientId: d.patientId, attachmentId: d.attachmentId } }),
      ...extra,
    ],
    { foreignKey: "That patient or file does not exist in this clinic." },
  );
  return (await listSharesForPatient(ctx, tenantId, d.patientId, { includeWithdrawn: true })).find((s) => s.id === id) as PortalShareSummary;
}

/** share id → attachment id, for the patient's shares that hand out a file. */
export async function shareFilesForPatient(ctx: DbContext, tenantId: string, patientId: string): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(`${TF} as f`)
    .innerJoin(`${T} as s`, (j) => j.onRef("s.tenant_id", "=", "f.tenant_id").onRef("s.id", "=", "f.share_id"))
    .select(["f.share_id", "f.attachment_id"])
    .where("f.tenant_id", "=", tenantId)
    .where("s.tenant_id", "=", tenantId)
    .where("s.patient_id", "=", patientId)
    .limit(200)
    .execute();
  return new Map(rows.map((r) => [r.share_id, r.attachment_id]));
}

/** One shared document, decrypted (for the patient only when it is theirs and not withdrawn – the caller checks). */
export async function getPortalShare(ctx: RepoContext, tenantId: string, id: string): Promise<PortalShare | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const file = await ctx.db.selectFrom(TF).select("attachment_id").where("tenant_id", "=", tenantId).where("share_id", "=", id).executeTakeFirst();
  return { ...toSummary(row), body: decryptField(ctx, tenantId, T, "body_enc", row.id, row.body_enc) ?? "", attachmentId: file?.attachment_id ?? null };
}

/** Records in the clinic's trail that the patient downloaded a shared file (ids only). */
export async function recordShareDownload(ctx: DbContext, tenantId: string, shareId: string, attachmentId: string, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  await pmsAudit(ctx, tenantId, actor, { action: "pms.portal_share.download", targetType: "pms_portal_share", targetId: shareId, detail: { attachmentId, via: "patient" } });
}

/** The patient opened it (first time only). */
export async function markShareViewed(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "share id");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ viewed_at: at, write_id: writeId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("viewed_at", "is", null),
    portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.portal_share.view", targetType: "pms_portal_share", targetId: id, detail: { via: "patient" } }, T, id, writeId),
  ]);
  return changed > 0;
}

/** Hides a shared document from the patient (kept for the record). */
export async function withdrawShare(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "share id");
  const at = nowIso(ctx);
  const writeId = newPortalWriteId(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ withdrawn_at: at, withdrawn_by: actor.userId, write_id: writeId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("withdrawn_at", "is", null),
    portalAuditWhenWritten(ctx, tenantId, actor, { action: "pms.portal_share.withdraw", targetType: "pms_portal_share", targetId: id }, T, id, writeId),
  ]);
  return changed > 0;
}
