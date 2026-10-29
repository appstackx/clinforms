/**
 * Search of one clinic's audit trail (audit_log, append-only): by dates, area or action, person, record type and
 * record id. Read-only. Dates become an id range (audit ids are ULIDs: time first), so the search runs on the
 * (tenant_id, id) and (tenant_id, user_id, id) indexes and never scans another clinic's rows. Newest first,
 * keyset pages.
 */
import { sql } from "kysely";
import type { AuditEntry } from "../../audit";
import { RepoInputError, assertTenantId, parseJson, type DbContext } from "../../context";

export interface AuditSearch {
  /** Inclusive lower id bound (from auditIdRange). */
  lowerId?: string | null;
  /** Exclusive upper id bound. */
  upperId?: string | null;
  /** Exactly these actions (≤ 90). */
  actions?: readonly string[] | null;
  /** Actions starting with this prefix ("pms.patient." – compared as a range, so "_" is not a wildcard). */
  actionPrefix?: string | null;
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /**
   * Entries about any of these records (≤ 20): the record itself (target id) or an entry whose detail names it as
   * its patient ("patientId") – e.g. the patients found by a name search. [] = nothing matches.
   */
  relatedIds?: readonly string[] | null;
  /** Older than this id (next page). */
  beforeId?: string | null;
  /** Newer than this id (previous page). */
  afterId?: string | null;
  /** Default 50, at most 200. */
  limit?: number;
}

export interface AuditSearchPage {
  entries: AuditEntry[];
  /** There are older entries (pass the last id as beforeId). */
  hasOlder: boolean;
  /** There are newer entries (pass the first id as afterId). */
  hasNewer: boolean;
}

const PREFIX = /^[a-z0-9][a-z0-9_.:-]{0,62}\.$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

/** A value for LIKE … ESCAPE '\\': the wildcards and the escape character itself taken literally. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The next string after every string that starts with `prefix` ("pms.patient." → "pms.patient/"). */
function prefixEnd(prefix: string): string {
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

export async function searchAudit(ctx: DbContext, tenantId: string, search: AuditSearch): Promise<AuditSearchPage> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(search.limit ?? 50)), 200);
  if (search.actions && search.actions.length > 90) throw new RepoInputError("Too many actions in one search.");
  if (search.actionPrefix && !PREFIX.test(search.actionPrefix)) throw new RepoInputError("Not a valid area.");
  if (search.relatedIds && search.relatedIds.length > 20) throw new RepoInputError("Too many records in one search.");
  if (search.relatedIds && search.relatedIds.some((id) => !RECORD_ID.test(id))) throw new RepoInputError("Not a valid record id.");
  const related = search.relatedIds ? Array.from(new Set(search.relatedIds)) : null;
  const base = () => {
    let q = ctx.db.selectFrom("audit_log").selectAll().where("tenant_id", "=", tenantId);
    if (search.lowerId) q = q.where("id", ">=", search.lowerId);
    if (search.upperId) q = q.where("id", "<", search.upperId);
    if (search.actions && search.actions.length > 0) q = q.where("action", "in", [...search.actions]);
    if (search.actionPrefix) q = q.where("action", ">=", search.actionPrefix).where("action", "<", prefixEnd(search.actionPrefix));
    if (search.userId) q = q.where("user_id", "=", search.userId);
    if (search.targetType) q = q.where("target_type", "=", search.targetType);
    if (search.targetId) q = q.where("target_id", "=", search.targetId);
    if (related && related.length > 0) {
      // The detail is JSON written by pmsAudit: {"patientId":"pat_…"} (LIKE wildcards in the id escaped).
      q = q.where((eb) => eb.or([eb("target_id", "in", related), ...related.map((id) => sql<boolean>`detail_json like ${`%"patientId":"${likeEscape(id)}"%`} escape ${"\\"}`)]));
    }
    return q;
  };
  if (search.actions && search.actions.length === 0) return { entries: [], hasOlder: false, hasNewer: false };
  if (related && related.length === 0) return { entries: [], hasOlder: false, hasNewer: false };
  const backwards = !search.beforeId && Boolean(search.afterId);
  let q = base();
  if (search.beforeId) q = q.where("id", "<", search.beforeId);
  else if (search.afterId) q = q.where("id", ">", search.afterId);
  const rows = await q.orderBy("id", backwards ? "asc" : "desc").limit(limit + 1).execute();
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (backwards) page.reverse();
  const entries: AuditEntry[] = page.map((row) => ({
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
  // Is there anything on the other side of this page?
  let other = false;
  if (entries.length > 0) {
    const edge = backwards ? entries[entries.length - 1].id : entries[0].id;
    if (search.beforeId || search.afterId) {
      const probe = await base()
        .where("id", backwards ? "<" : ">", edge)
        .select("id")
        .limit(1)
        .execute();
      other = probe.length > 0;
    }
  }
  return backwards ? { entries, hasOlder: other, hasNewer: more } : { entries, hasOlder: more, hasNewer: other };
}
