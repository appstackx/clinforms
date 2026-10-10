/**
 * The clinic's activity page (/app/settings/activity) and its CSV download: who may see what, cursor paging
 * over the append-only audit_log, display names, and the CSV (ids only).
 *
 *   owner / admin       the whole clinic's trail, filter by action and by person
 *   clinician / staff   only the entries they wrote themselves (the person filter is forced to them)
 *
 * Pure functions over a database handle (no Next imports), so the tests run them on SQLite, Postgres and D1.
 */
import type { Kysely } from "kysely";
import { ACTIVITY_ACTORS, ACTIVITY_TARGETS, activityLabel, describeActivityDetail } from "../../lib/activity-copy";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { listClinicMembers } from "../auth/membership";
import { roleCan, type MemberRole } from "../auth/roles";
import type { Database } from "../db/schema";
import { listAudit, type AuditEntry } from "../repos/audit";
import type { DbContext } from "../repos/context";
import { listPartnerKeys } from "../repos/partner-keys";

export const ACTIVITY_PATH = "/app/settings/activity";
export const ACTIVITY_EXPORT_PATH = "/app/settings/activity/export";
export const ACTIVITY_PAGE_SIZE = 50;

/** The member looking at the page. */
export interface ActivityViewer {
  tenantId: string;
  organizationId: string;
  role: MemberRole;
  userId: string;
}

export interface ActivityScope {
  tenantId: string;
  /** true: the whole clinic's trail (owners, administrators); false: only the viewer's own entries. */
  everyone: boolean;
  viewerId: string;
}

export function activityScope(viewer: ActivityViewer): ActivityScope {
  return { tenantId: viewer.tenantId, everyone: roleCan(viewer.role, { audit: ["read"] }), viewerId: viewer.userId };
}

/** Query-string parameters of the page and the download (unknown or malformed values are dropped). */
export interface ActivityParams {
  action: string | null;
  user: string | null;
  before: string | null;
  after: string | null;
  /** Download only: the newest and the oldest entry shown on the page (inclusive), so it holds exactly those. */
  from: string | null;
  to: string | null;
  /** Fix wave 2: include routine saves (SAVE_ACTIONS), hidden by default so approvals are not buried. */
  saves: boolean;
}

/** Routine saves of a draft or a form mapping: recorded, but left out of the activity page unless asked for. */
export const SAVE_ACTIONS: readonly string[] = ["report.update", "form.update"];

const ACTION = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(source: ParamSource, key: string): string | null {
  const value = source instanceof URLSearchParams ? source.get(key) : source[key];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text !== "" ? text : null;
}

export function parseActivityParams(source: ParamSource): ActivityParams {
  const pick = (key: string, pattern: RegExp) => {
    const value = first(source, key);
    return value && pattern.test(value) ? value : null;
  };
  const before = pick("before", ULID);
  const from = pick("from", ULID);
  const to = pick("to", ULID);
  const range = from && to && from >= to;
  return {
    action: pick("action", ACTION),
    user: pick("user", USER_ID),
    before,
    after: before ? null : pick("after", ULID),
    from: range ? from : null,
    to: range ? to : null,
    saves: first(source, "saves") === "1",
  };
}

/** What is actually queried: the scope decides the person filter, never the request. */
export interface ActivityQuery {
  tenantId: string;
  action: string | null;
  /** Actions left out (routine saves, unless asked for or filtered on). */
  excludeActions: readonly string[];
  userId: string | null;
  before: string | null;
  after: string | null;
}

export function activityQuery(scope: ActivityScope, params: ActivityParams): ActivityQuery {
  return {
    tenantId: scope.tenantId,
    action: params.action,
    excludeActions: params.action || params.saves ? [] : SAVE_ACTIONS,
    userId: scope.everyone ? params.user : scope.viewerId,
    before: params.before,
    after: params.after,
  };
}

export interface ActivityPage {
  /** Newest first. */
  entries: AuditEntry[];
  /** Cursor for the next newer page (`after`), or null on the newest page. */
  newerCursor: string | null;
  /** Cursor for the next older page (`before`), or null on the oldest page. */
  olderCursor: string | null;
}

/**
 * One page of the trail, newest first. `before` pages towards older entries; `after` pages back towards newer
 * ones (when fewer than a page of newer entries is left, the newest page is shown instead, so pages stay full).
 */
export async function loadActivityPage(ctx: DbContext, query: ActivityQuery, pageSize = ACTIVITY_PAGE_SIZE): Promise<ActivityPage> {
  const size = Math.min(Math.max(1, Math.floor(pageSize)), 200);
  const filters = { action: query.action ?? undefined, userId: query.userId ?? undefined, excludeActions: query.excludeActions, limit: size + 1 };
  if (query.after) {
    const rows = await listAudit(ctx, query.tenantId, { ...filters, afterId: query.after });
    if (rows.length > size) {
      const entries = rows.slice(1); // the extra row is the newest: more newer entries exist
      return { entries, newerCursor: entries[0].id, olderCursor: entries[entries.length - 1].id };
    }
    return loadActivityPage(ctx, { ...query, after: null, before: null }, size);
  }
  const rows = await listAudit(ctx, query.tenantId, { ...filters, beforeId: query.before ?? undefined });
  const entries = rows.slice(0, size);
  return {
    entries,
    newerCursor: query.before && entries.length > 0 ? entries[0].id : null,
    olderCursor: rows.length > size ? entries[entries.length - 1].id : null,
  };
}

/** The columns the download needs (no details: they are not exported). */
export type ActivityCsvEntry = Pick<AuditEntry, "id" | "at" | "action" | "userId" | "targetType" | "targetId">;

/**
 * The entries between two ids of a page (both inclusive, newest first, at most one page) under the same scope and
 * filters: what the download holds, so entries written after the page was shown never shift it.
 */
export async function loadActivityRange(
  ctx: DbContext,
  query: ActivityQuery,
  range: { newest: string; oldest: string },
  max = ACTIVITY_PAGE_SIZE,
): Promise<ActivityCsvEntry[]> {
  let q = ctx.db
    .selectFrom("audit_log")
    .select(["id", "at", "action", "user_id", "target_type", "target_id"])
    .where("tenant_id", "=", query.tenantId)
    .where("id", "<=", range.newest)
    .where("id", ">=", range.oldest);
  if (query.userId !== null) q = q.where("user_id", "=", query.userId);
  if (query.action !== null) q = q.where("action", "=", query.action);
  if (query.excludeActions.length > 0) q = q.where("action", "not in", [...query.excludeActions]);
  const rows = await q.orderBy("id", "desc").limit(Math.min(Math.max(1, Math.floor(max)), 200)).execute();
  return rows.map((r) => ({ id: r.id, at: r.at, action: r.action, userId: r.user_id, targetType: r.target_type, targetId: r.target_id }));
}

/** A link to the page (or the download) with the given filters and cursor; empty values are left out. */
export function activityHref(path: string, params: Partial<ActivityParams>): string {
  const search = new URLSearchParams();
  for (const key of ["action", "user", "before", "after", "from", "to"] as const) {
    const value = params[key];
    if (value) search.set(key, value);
  }
  if (params.saves) search.set("saves", "1");
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/* ------------------------------------------------------------------------------------------------
 * Display
 * ----------------------------------------------------------------------------------------------*/

export interface ActivityLookups {
  /** userId → name; `current` = still a member of this clinic. */
  users: Map<string, { name: string; current: boolean }>;
  /** member id → name and account (current members). */
  members: Map<string, { name: string; userId: string }>;
  /** partner key id → key name. */
  keys: Map<string, string>;
}

export interface PersonOption {
  userId: string;
  label: string;
}

/** Names for the entries on a page: current members, former members still on record, the clinic's API keys. */
export async function loadActivityLookups(db: Kysely<Database>, viewer: ActivityViewer, entries: AuditEntry[]): Promise<ActivityLookups> {
  const clinicMembers = await listClinicMembers(db, viewer.organizationId);
  const users = new Map<string, { name: string; current: boolean }>();
  const members = new Map<string, { name: string; userId: string }>();
  for (const m of clinicMembers) {
    users.set(m.userId, { name: m.name, current: true });
    members.set(m.memberId, { name: m.name, userId: m.userId });
  }
  const wanted = new Set<string>();
  for (const e of entries) {
    if (e.userId) wanted.add(e.userId);
    if (e.targetType === "user" && e.targetId) wanted.add(e.targetId);
  }
  const missing = Array.from(wanted).filter((id) => id !== PLATFORM_USER_ID && !users.has(id));
  for (let i = 0; i < missing.length; i += 90) {
    // D1 allows at most 100 bound parameters per statement
    const rows = await db.selectFrom("user").select(["id", "name"]).where("id", "in", missing.slice(i, i + 90)).execute();
    for (const row of rows) users.set(row.id, { name: row.name, current: false });
  }
  const keys = new Map<string, string>();
  if (entries.some((e) => e.targetType === "partner_key")) {
    for (const k of await listPartnerKeys({ db }, viewer.tenantId)) keys.set(k.id, k.name);
  }
  return { users, members, keys };
}

/** The person filter's choices (owners and administrators only): current members, then ClinForms support. */
export async function activityPeople(db: Kysely<Database>, organizationId: string): Promise<PersonOption[]> {
  const members = await listClinicMembers(db, organizationId);
  return [...members.map((m) => ({ userId: m.userId, label: m.name })), { userId: PLATFORM_USER_ID, label: ACTIVITY_ACTORS.platform }];
}

export interface ActivityRow {
  id: string;
  at: string;
  action: string;
  label: string;
  who: string;
  target: string | null;
  /** Fix wave 2: where the report or form mapping opens in the clinic's Studio (null for anything else). */
  targetHref: string | null;
  detail: string | null;
}

/** The Studio page of an entry's report or form mapping. */
export function activityTargetHref(entry: Pick<AuditEntry, "targetType" | "targetId">): string | null {
  if (!entry.targetId) return null;
  if (entry.targetType === "report") return `/app/studio/${encodeURIComponent(entry.targetId)}`;
  if (entry.targetType === "form") return `/app/studio/forms/${encodeURIComponent(entry.targetId)}`;
  return null;
}

function personName(userId: string | null, lookups: ActivityLookups): string {
  if (!userId) return ACTIVITY_ACTORS.system;
  if (userId === PLATFORM_USER_ID) return ACTIVITY_ACTORS.platform;
  const user = lookups.users.get(userId);
  if (!user) return ACTIVITY_ACTORS.deletedAccount;
  return user.current ? user.name : `${user.name} (${ACTIVITY_ACTORS.formerMember.toLowerCase()})`;
}

function shortId(id: string): string {
  return id.length > 14 ? `…${id.slice(-8)}` : id;
}

function targetText(entry: AuditEntry, lookups: ActivityLookups): string | null {
  const { targetType: type, targetId: id } = entry;
  if (!type) return null;
  const noun = ACTIVITY_TARGETS[type] ?? type.replace(/_/g, " ");
  if (!id) return noun;
  switch (type) {
    case "user":
      return id === entry.userId ? null : personName(id, lookups);
    case "member": {
      const member = lookups.members.get(id);
      if (!member) return ACTIVITY_ACTORS.formerMember;
      return member.userId === entry.userId ? null : member.name;
    }
    case "partner_key": {
      const name = lookups.keys.get(id);
      return name ? `${noun} “${name}”` : noun;
    }
    case "invitation":
    case "organization":
    case "clinic":
      return noun;
    default:
      return `${noun} ${shortId(id)}`;
  }
}

export function presentActivity(entries: AuditEntry[], lookups: ActivityLookups): ActivityRow[] {
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    label: activityLabel(e.action),
    who: personName(e.userId, lookups),
    target: targetText(e, lookups),
    targetHref: activityTargetHref(e),
    detail: describeActivityDetail(e.action, e.detail),
  }));
}

const UK_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "9 Oct 2026, 14:05" (UK time). */
export function activityTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : UK_TIME.format(date);
}

/* ------------------------------------------------------------------------------------------------
 * CSV download – ids and codes only (never names, emails or details)
 * ----------------------------------------------------------------------------------------------*/

export const ACTIVITY_CSV_COLUMNS = ["id", "at", "action", "user_id", "target_type", "target_id"] as const;

/** One CSV cell: quoted when needed, and never read as a spreadsheet formula. */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function activityCsv(entries: ActivityCsvEntry[]): string {
  const lines = [ACTIVITY_CSV_COLUMNS.join(",")];
  for (const e of entries) {
    lines.push([e.id, e.at, e.action, e.userId, e.targetType, e.targetId].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function activityCsvFileName(tenantId: string, now = new Date()): string {
  return `clinforms-activity-${tenantId}-${now.toISOString().slice(0, 10)}.csv`;
}
