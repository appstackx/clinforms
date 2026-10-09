/**
 * `audit_log` – append-only (the database refuses UPDATE and DELETE). Insert and list only.
 * Never put patient data in an audit row: ids, actions and counts only.
 */
import {
  RepoInputError,
  assertTenantId,
  jsonOrNull,
  nowIso,
  optionalText,
  parseJson,
  ulid,
  type DbContext,
} from "./context";

export interface AuditEntryInput {
  userId?: string | null;
  sessionId?: string | null;
  /** e.g. "report.sign", "member.role_change" – [a-z0-9_.:-], ≤ 64. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Small JSON detail (≤ 4 KB). No patient data. */
  detail?: Record<string, unknown> | null;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  sessionId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

const ACTION = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export async function appendAudit(ctx: DbContext, tenantId: string, input: AuditEntryInput): Promise<AuditEntry> {
  assertTenantId(tenantId);
  if (typeof input.action !== "string" || !ACTION.test(input.action)) {
    throw new RepoInputError("Audit action must match [a-z0-9_.:-] (≤ 64 characters).");
  }
  const at = nowIso(ctx);
  const entry: AuditEntry = {
    id: ulid(Date.parse(at)),
    tenantId,
    userId: optionalText(input.userId, "userId", 128),
    sessionId: optionalText(input.sessionId, "sessionId", 128),
    action: input.action,
    targetType: optionalText(input.targetType, "targetType", 64),
    targetId: optionalText(input.targetId, "targetId", 160),
    detail: input.detail ?? null,
    at,
  };
  await ctx.db
    .insertInto("audit_log")
    .values({
      id: entry.id,
      tenant_id: tenantId,
      user_id: entry.userId,
      session_id: entry.sessionId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      detail_json: jsonOrNull(entry.detail, "Audit detail", 4096),
      at,
    })
    .execute();
  return entry;
}

export interface ListAuditOptions {
  /** Default 100, at most 500. */
  limit?: number;
  /** Return entries older than this id (paging, newest first). */
  beforeId?: string;
  /**
   * Return entries newer than this id (paging back): the `limit` entries closest to it, still returned newest
   * first. Ignored when `beforeId` is set.
   */
  afterId?: string;
  /** Only entries with exactly this action. */
  action?: string;
  /** Only entries written by this user. */
  userId?: string;
}

/** The tenant's audit trail, newest first (ids are ULIDs: time-ordered). */
export async function listAudit(ctx: DbContext, tenantId: string, options: ListAuditOptions = {}): Promise<AuditEntry[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  let query = ctx.db.selectFrom("audit_log").selectAll().where("tenant_id", "=", tenantId);
  if (options.userId !== undefined) query = query.where("user_id", "=", options.userId);
  if (options.action !== undefined) query = query.where("action", "=", options.action);
  const ascending = !options.beforeId && Boolean(options.afterId);
  if (options.beforeId) query = query.where("id", "<", options.beforeId);
  else if (options.afterId) query = query.where("id", ">", options.afterId);
  const fetched = await query.orderBy("id", ascending ? "asc" : "desc").limit(limit).execute();
  const rows = ascending ? fetched.reverse() : fetched;
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseJson<Record<string, unknown>>(row.detail_json),
    at: row.at,
  }));
}
