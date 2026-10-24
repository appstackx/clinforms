/**
 * `pms_portal_messages` – the portal's outbox. In test mode (the only mode in this build) a message is STORED and
 * shown to the clinic's administrators, never sent. Recipient and body are encrypted (a body can carry a sign-in
 * or booking link); the subject is plain and never holds clinical detail (src/modules/pms/portal/messages.ts).
 */
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import type { PortalMessage, PortalMessageKind, PortalMessageSummary } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsPortalMessagesTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertTenantId, decryptField, encryptField, nowIso, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";

const T = "pms_portal_messages";

export interface NewPortalMessage {
  patientId: string | null;
  kind: PortalMessageKind;
  subject: string;
  recipient: string;
  body: string;
  status: "outbox" | "sent" | "failed";
  provider: string;
}

/** The INSERT and audit row for a message (send them in the batch of the write that caused it). */
export function portalMessageQueries(ctx: RepoContext, tenantId: string, m: NewPortalMessage, actor: PmsActor): { id: string; queries: BatchQuery[] } {
  assertTenantId(tenantId);
  if (!m.subject || m.subject.length > 200) throw new RepoInputError("A message subject needs 1–200 characters.");
  const id = pmsId(P.message, ctx);
  const at = nowIso(ctx);
  return {
    id,
    queries: [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        patient_id: m.patientId,
        kind: m.kind,
        channel: "email",
        subject: m.subject,
        recipient_enc: encryptField(ctx, tenantId, T, "recipient_enc", id, m.recipient),
        body_enc: encryptField(ctx, tenantId, T, "body_enc", id, m.body),
        status: m.status,
        provider: m.provider,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_message.queue", targetType: "pms_portal_message", targetId: id, detail: { kind: m.kind, status: m.status, patientId: m.patientId } }),
    ],
  };
}

export async function recordPortalMessage(ctx: RepoContext, tenantId: string, m: NewPortalMessage, actor: PmsActor): Promise<string> {
  const { id, queries } = portalMessageQueries(ctx, tenantId, m, actor);
  await writeWithAudit(ctx, queries, { foreignKey: "That patient does not exist in this clinic." });
  return id;
}

function toSummary(r: Pick<Selectable<PmsPortalMessagesTable>, "tenant_id" | "id" | "patient_id" | "kind" | "subject" | "status" | "provider" | "created_at">): PortalMessageSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    kind: r.kind as PortalMessageKind,
    channel: "email",
    subject: r.subject,
    status: r.status as PortalMessageSummary["status"],
    provider: r.provider,
    createdAt: r.created_at,
  };
}

/** The outbox, newest first (nothing decrypted). */
export async function listPortalMessages(ctx: DbContext, tenantId: string, options: { patientId?: string; limit?: number; before?: string } = {}): Promise<PortalMessageSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select(["tenant_id", "id", "patient_id", "kind", "subject", "status", "provider", "created_at"]).where("tenant_id", "=", tenantId);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.before) q = q.where("id", "<", options.before);
  const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(Math.min(Math.max(1, options.limit ?? 50), 500)).execute();
  return rows.map(toSummary);
}

/** One message with its recipient and body decrypted. */
export async function getPortalMessage(ctx: RepoContext, tenantId: string, id: string): Promise<PortalMessage | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  return {
    ...toSummary(row),
    recipient: decryptField(ctx, tenantId, T, "recipient_enc", row.id, row.recipient_enc),
    body: decryptField(ctx, tenantId, T, "body_enc", row.id, row.body_enc),
  };
}
