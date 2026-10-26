/**
 * `audit_log` – append-only (the database refuses UPDATE and DELETE). Insert and list only.
 * Never put patient data in an audit row: ids, actions and counts only.
 */
import { sql, type Expression, type RawBuilder, type SqlBool } from "kysely";
import type { BatchQuery } from "../db/batch";
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

function auditRow(ctx: DbContext, tenantId: string, input: AuditEntryInput) {
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
  const row = {
    id: entry.id,
    tenant_id: tenantId,
    user_id: entry.userId,
    session_id: entry.sessionId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    detail_json: jsonOrNull(entry.detail, "Audit detail", 4096),
    at,
  };
  return { entry, row };
}

export async function appendAudit(ctx: DbContext, tenantId: string, input: AuditEntryInput): Promise<AuditEntry> {
  const { entry, row } = auditRow(ctx, tenantId, input);
  await ctx.db.insertInto("audit_log").values(row).execute();
  return entry;
}

/**
 * (10/2026) One audit row as a statement for an atomic batch (db/batch.ts runBatch), written only while the
 * `whenExists` subquery finds a row when the statement runs (INSERT … SELECT … WHERE EXISTS): the audit row exists
 * exactly when the change it records does. Still insert-only (the log stays append-only).
 */
export function auditInsertWhenExists(
  ctx: DbContext,
  tenantId: string,
  input: AuditEntryInput,
  whenExists: Expression<unknown>,
): { entry: AuditEntry; query: BatchQuery } {
  const { entry, row } = auditRow(ctx, tenantId, input);
  const query = ctx.db
    .insertInto("audit_log")
    .columns(["id", "tenant_id", "user_id", "session_id", "action", "target_type", "target_id", "detail_json", "at"])
    .expression(
      ctx.db
        .selectNoFrom((eb) => [
          eb.val(row.id).as("id"),
          eb.val(row.tenant_id).as("tenant_id"),
          eb.val(row.user_id).as("user_id"),
          eb.val(row.session_id).as("session_id"),
          eb.val(row.action).as("action"),
          eb.val(row.target_type).as("target_type"),
          eb.val(row.target_id).as("target_id"),
          eb.val(row.detail_json).as("detail_json"),
          eb.val(row.at).as("at"),
        ])
        .where((eb) => eb.exists(whenExists)),
    );
  return { entry, query };
}

/**
 * `<column> LIKE '%"<id>"%'`: the id as a whole JSON string inside a JSON text column, never as a part of another
 * id. LIKE's wildcards in the id (an id may hold "_") are escaped; ESCAPE is spelled out (SQLite has no default).
 * Like LIKE itself, ASCII case is ignored on SQLite (never fewer matches than the exact id).
 */
export function jsonTextNamesId(column: string, id: string): RawBuilder<SqlBool> {
  const pattern = `%${JSON.stringify(id).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql<SqlBool>`${sql.ref(column)} like ${pattern} escape '\\'`;
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
  /** Leave out entries with these actions (fix wave 2: routine saves hidden by default on the activity page). */
  excludeActions?: readonly string[];
  /** Only entries written by this user. */
  userId?: string;
}

/**
 * (10/2026, admin:load-forms --replace-proposed) Everything the tenant's audit trail records about one id: the
 * entries targeting it and the entries whose detail names it (e.g. a report's approval, drafting or final document
 * names its form as detail.formId – rows that outlive the report itself). Oldest first, at most `limit` (default
 * 100, at most 500). The id is matched as a whole JSON string ("<id>"), never as a part of another id.
 */
export async function listAuditAbout(ctx: DbContext, tenantId: string, id: string, options: { limit?: number } = {}): Promise<AuditEntry[]> {
  assertTenantId(tenantId);
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(id)) throw new RepoInputError("Audit target id is not a valid id.");
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  const rows = await ctx.db
    .selectFrom("audit_log")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where((eb) => eb.or([eb("target_id", "=", id), jsonTextNamesId("detail_json", id)]))
    .orderBy("id", "asc")
    .limit(limit)
    .execute();
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

/** The tenant's audit trail, newest first (ids are ULIDs: time-ordered). */
export async function listAudit(ctx: DbContext, tenantId: string, options: ListAuditOptions = {}): Promise<AuditEntry[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  let query = ctx.db.selectFrom("audit_log").selectAll().where("tenant_id", "=", tenantId);
  if (options.userId !== undefined) query = query.where("user_id", "=", options.userId);
  if (options.action !== undefined) query = query.where("action", "=", options.action);
  if (options.excludeActions && options.excludeActions.length > 0) query = query.where("action", "not in", [...options.excludeActions]);
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
