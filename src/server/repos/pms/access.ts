/**
 * Configurable access (migration 0103, foundation): the clinic's overrides of a role's permissions, a member's own
 * exceptions and sites, whether their clinic-system access is on, and the change history. Rules and wording:
 * src/modules/pms/core/{permissions,access}.ts.
 *
 * - Only choices are stored; the locks (owner always, only the owner changes the owner, reception never clinical)
 *   are applied again whenever permissions are read (effectivePermissions), so no row can unlock a locked cell.
 *   A request to change a locked cell is refused as a whole and audited ("pms.access.refused") – nothing else
 *   is written.
 * - A role override row exists only while the cell differs from the design's default; a member exception only
 *   while it differs from what the role grants at this clinic.
 * - Every save writes its rows, one history row (pms_access_changes: ids and permission ids, never patient data)
 *   and the audit row in ONE atomic batch.
 * - Member access is revisioned: the access row's rev must still be the one the form was loaded with. The check
 *   is inside the batch's first statement (a stale rev makes it violate CHECK (rev >= 1), so the whole batch
 *   fails on every backend, D1 included) – no read-then-write race.
 */
import { sql, type ExpressionBuilder } from "kysely";
import {
  normaliseExceptions,
  lockedExceptions,
  lockedRoleChanges,
  overridesFor,
  MemberAccessInputSchema,
  RolePermissionChangesSchema,
  defaultMemberAccess,
  type AccessChange,
  type AccessChangeItem,
  type MemberAccess,
  type MemberAccessInput,
  type MemberSite,
  type RoleOverride,
  type RolePermissionChange,
} from "../../../modules/pms/core/access";
import { isAccessPermission, isPmsRole, roleDefault, rolePermission, type AccessPermission, type PermissionChoices, type PmsRole } from "../../../modules/pms/core/permissions";
import { classifyDbError } from "../../db/errors";
import type { BatchQuery } from "../../db/batch";
import type { Database } from "../../db/schema";
import {
  assertId,
  assertTenantId,
  b01,
  isOn,
  nowIso,
  num,
  parseInput,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
  type PmsActor,
} from "./context";

const IN_GROUP = 90;

/* ------------------------------------------------------------------------------------------------
 * Site scope of patients (K2-SITE-004)
 * ----------------------------------------------------------------------------------------------*/

/**
 * A WHERE condition on pms_patients for a site scope (null scope = no condition): the patient has a case or an
 * appointment at a site in scope, or no case with a site and no appointment at all.
 */
export function patientSiteFilter(tenantId: string, siteIds: ReadonlySet<string> | null) {
  return (eb: ExpressionBuilder<Database, "pms_patients">) => {
    const ids = siteIds ? Array.from(siteIds) : [];
    const caseAt = (inScope: boolean) => {
      let q = eb
        .selectFrom("pms_cases as sc")
        .select("sc.id")
        .whereRef("sc.tenant_id", "=", "pms_patients.tenant_id")
        .whereRef("sc.patient_id", "=", "pms_patients.id")
        .where("sc.tenant_id", "=", tenantId)
        .where("sc.site_id", "is not", null);
      if (inScope) q = q.where("sc.site_id", "in", ids);
      return q;
    };
    const apptAt = (inScope: boolean) => {
      let q = eb
        .selectFrom("pms_appointments as sa")
        .select("sa.id")
        .whereRef("sa.tenant_id", "=", "pms_patients.tenant_id")
        .whereRef("sa.patient_id", "=", "pms_patients.id")
        .where("sa.tenant_id", "=", tenantId);
      if (inScope) q = q.where("sa.site_id", "in", ids);
      return q;
    };
    const unlinked = eb.and([eb.not(eb.exists(caseAt(false))), eb.not(eb.exists(apptAt(false)))]);
    if (ids.length === 0) return unlinked;
    return eb.or([eb.exists(caseAt(true)), eb.exists(apptAt(true)), unlinked]);
  };
}



/* ------------------------------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------------------------------*/

/** Every role override of the clinic. */
export async function listRoleOverrides(ctx: DbContext, tenantId: string): Promise<RoleOverride[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("pms_role_permissions")
    .select(["role", "permission", "allowed"])
    .where("tenant_id", "=", tenantId)
    .orderBy("role")
    .orderBy("permission")
    .execute();
  return rows.filter((r) => isPmsRole(r.role) && isAccessPermission(r.permission)).map((r) => ({ role: r.role as PmsRole, permission: r.permission as AccessPermission, allowed: isOn(r.allowed) }));
}

type AccessRow = { user_id: string; active: number; all_sites: number; rev: number; updated_at: string; updated_by: string | null };

function assemble(row: AccessRow, sites: MemberSite[], exceptions: Partial<Record<AccessPermission, boolean>>): MemberAccess {
  return {
    userId: row.user_id,
    active: isOn(row.active),
    allSites: isOn(row.all_sites),
    sites,
    exceptions,
    rev: num(row.rev),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** The stored access of members (all of the clinic's, or the ones listed): rows, sites and exceptions. */
export async function listMemberAccess(ctx: DbContext, tenantId: string, userIds?: readonly string[]): Promise<MemberAccess[]> {
  assertTenantId(tenantId);
  const groups: (readonly string[] | null)[] = [];
  if (userIds === undefined) groups.push(null);
  else {
    const ids = Array.from(new Set(userIds.map((u) => assertId(u, "userId"))));
    for (let i = 0; i < ids.length; i += IN_GROUP) groups.push(ids.slice(i, i + IN_GROUP));
  }
  const out: MemberAccess[] = [];
  for (const group of groups) {
    if (group && group.length === 0) continue;
    let rowsQ = ctx.db.selectFrom("pms_member_access").select(["user_id", "active", "all_sites", "rev", "updated_at", "updated_by"]).where("tenant_id", "=", tenantId);
    let sitesQ = ctx.db.selectFrom("pms_member_sites").select(["user_id", "site_id", "works_at", "can_see"]).where("tenant_id", "=", tenantId);
    let exQ = ctx.db.selectFrom("pms_member_permissions").select(["user_id", "permission", "allowed"]).where("tenant_id", "=", tenantId);
    if (group) {
      rowsQ = rowsQ.where("user_id", "in", group);
      sitesQ = sitesQ.where("user_id", "in", group);
      exQ = exQ.where("user_id", "in", group);
    }
    const [rows, sites, exceptions] = await Promise.all([
      rowsQ.orderBy("user_id").limit(500).execute(),
      sitesQ.orderBy("user_id").orderBy("site_id").execute(),
      exQ.orderBy("user_id").orderBy("permission").execute(),
    ]);
    for (const row of rows) {
      const mySites = sites.filter((s) => s.user_id === row.user_id).map((s) => ({ siteId: s.site_id, worksAt: isOn(s.works_at), canSee: isOn(s.can_see) }));
      const myEx: Partial<Record<AccessPermission, boolean>> = {};
      for (const e of exceptions) if (e.user_id === row.user_id && isAccessPermission(e.permission)) myEx[e.permission] = isOn(e.allowed);
      out.push(assemble(row as AccessRow, mySites, myEx));
    }
  }
  return out;
}

/** One member's access (the default – active, every site, no exceptions, rev 0 – when nothing is stored). */
export async function getMemberAccess(ctx: DbContext, tenantId: string, userId: string): Promise<MemberAccess> {
  const [found] = await listMemberAccess(ctx, tenantId, [userId]);
  return found ?? defaultMemberAccess(userId);
}

/**
 * What the actor check needs on every request: the clinic's overrides for the member's role and the member's own
 * access (null = nothing stored). Three small reads by primary-key prefix.
 */
export async function loadAccessInputs(ctx: DbContext, tenantId: string, userId: string, role: string): Promise<{ overrides: PermissionChoices; access: MemberAccess | null }> {
  assertTenantId(tenantId);
  assertId(userId, "userId");
  const [overrideRows, accessList] = await Promise.all([
    isPmsRole(role)
      ? ctx.db.selectFrom("pms_role_permissions").select(["permission", "allowed"]).where("tenant_id", "=", tenantId).where("role", "=", role).execute()
      : Promise.resolve([] as { permission: string; allowed: number }[]),
    listMemberAccess(ctx, tenantId, [userId]),
  ]);
  const overrides: Record<string, boolean> = {};
  for (const r of overrideRows) if (isAccessPermission(r.permission)) overrides[r.permission] = isOn(r.allowed);
  return { overrides, access: accessList[0] ?? null };
}

function toChange(r: { id: string; kind: string; subject_role: string | null; subject_user_id: string | null; items_json: string; changed_by: string | null; created_at: string | Date }): AccessChange {
  let items: AccessChangeItem[] = [];
  try {
    const parsed = JSON.parse(r.items_json) as unknown;
    if (Array.isArray(parsed)) items = parsed as AccessChangeItem[];
  } catch {
    items = [];
  }
  return {
    id: r.id,
    at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    byUserId: r.changed_by,
    kind: r.kind === "member" ? "member" : "role",
    subjectRole: isPmsRole(r.subject_role) ? r.subject_role : null,
    subjectUserId: r.subject_user_id,
    items,
  };
}

/** The change history, newest first (all of it, or the role grid's, or one member's). */
export async function listAccessChanges(ctx: DbContext, tenantId: string, options: { kind?: "role" | "member"; subjectUserId?: string; limit?: number } = {}): Promise<AccessChange[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 500);
  let q = ctx.db.selectFrom("pms_access_changes").select(["id", "kind", "subject_role", "subject_user_id", "items_json", "changed_by", "created_at"]).where("tenant_id", "=", tenantId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.subjectUserId) q = q.where("subject_user_id", "=", assertId(options.subjectUserId, "userId"));
  const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
  return rows.map(toChange);
}

/* ------------------------------------------------------------------------------------------------
 * Writes
 * ----------------------------------------------------------------------------------------------*/

export type AccessSaveResult =
  | { ok: true; changed: number; rev: number }
  | { ok: false; reason: "locked"; locked: AccessPermission[] }
  | { ok: false; reason: "conflict"; currentRev: number };

function historyInsert(ctx: DbContext, tenantId: string, actor: PmsActor, at: string, entry: { kind: "role" | "member"; subjectRole?: PmsRole | null; subjectUserId?: string | null; items: AccessChangeItem[] }): { id: string; query: BatchQuery } {
  const id = pmsId("acc", ctx);
  return {
    id,
    query: ctx.db.insertInto("pms_access_changes").values({
      tenant_id: tenantId,
      id,
      kind: entry.kind,
      subject_role: entry.subjectRole ?? null,
      subject_user_id: entry.subjectUserId ?? null,
      items_json: JSON.stringify(entry.items),
      changed_by: actor.userId,
      created_at: at,
    }),
  };
}

/** Writes only the refusal's audit row (a locked cell was asked for). */
async function auditRefusal(ctx: DbContext, tenantId: string, actor: PmsActor, targetId: string, detail: Record<string, unknown>): Promise<void> {
  await writeWithAudit(ctx, [pmsAuditQuery(ctx, tenantId, actor, { action: "pms.access.refused", targetType: "pms_access", targetId, detail })]);
}

/**
 * Saves changed cells of the role grid. Cells that end up equal to the current value are skipped; a cell back at
 * the design's default loses its override row. Refused as a whole (and audited) when any cell is locked.
 */
export async function saveRolePermissions(ctx: DbContext, tenantId: string, input: RolePermissionChange[], actor: PmsActor): Promise<AccessSaveResult> {
  assertTenantId(tenantId);
  const changes = parseInput(RolePermissionChangesSchema, input, "Role permissions") as RolePermissionChange[];
  const locked = lockedRoleChanges(changes);
  if (locked.length > 0) {
    await auditRefusal(ctx, tenantId, actor, "roles", { cells: locked.map((c) => `${c.role}:${c.permission}`) });
    return { ok: false, reason: "locked", locked: locked.map((c) => c.permission) };
  }
  const current = await listRoleOverrides(ctx, tenantId);
  const at = nowIso(ctx);
  const items: AccessChangeItem[] = [];
  const queries: BatchQuery[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const key = `${c.role}:${c.permission}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = rolePermission(c.role, c.permission, overridesFor(c.role, current));
    if (from === c.allowed) continue;
    items.push({ type: "role_permission", role: c.role, permission: c.permission, from, to: c.allowed });
    if (c.allowed === roleDefault(c.role, c.permission)) {
      queries.push(ctx.db.deleteFrom("pms_role_permissions").where("tenant_id", "=", tenantId).where("role", "=", c.role).where("permission", "=", c.permission));
    } else {
      queries.push(
        ctx.db
          .insertInto("pms_role_permissions")
          .values({ tenant_id: tenantId, role: c.role, permission: c.permission, allowed: b01(c.allowed), updated_by: actor.userId, updated_at: at })
          .onConflict((oc) => oc.columns(["tenant_id", "role", "permission"]).doUpdateSet({ allowed: b01(c.allowed), updated_by: actor.userId, updated_at: at })),
      );
    }
  }
  if (items.length === 0) return { ok: true, changed: 0, rev: 0 };
  const history = historyInsert(ctx, tenantId, actor, at, { kind: "role", items });
  queries.push(history.query);
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.access.roles_update",
      targetType: "pms_access",
      targetId: history.id,
      detail: { changes: items.length, cells: items.map((i) => (i.type === "role_permission" ? `${i.role}:${i.permission}:${i.to ? "on" : "off"}` : i.type)) },
    }),
  );
  await writeWithAudit(ctx, queries);
  return { ok: true, changed: items.length, rev: 0 };
}

/** The access row's revision bump, failing the batch (CHECK rev >= 1) when the stored rev is not `expectedRev`. */
function upsertAccessRow(ctx: DbContext, tenantId: string, userId: string, actor: PmsActor, at: string, values: { active?: boolean; allSites?: boolean }, expectedRev: number | null): BatchQuery {
  const rev = expectedRev === null ? sql<number>`pms_member_access.rev + 1` : sql<number>`case when pms_member_access.rev = ${expectedRev} then pms_member_access.rev + 1 else -1 end`;
  const set: Record<string, unknown> = { rev, updated_by: actor.userId, updated_at: at };
  if (values.active !== undefined) set.active = b01(values.active);
  if (values.allSites !== undefined) set.all_sites = b01(values.allSites);
  return ctx.db
    .insertInto("pms_member_access")
    .values({
      tenant_id: tenantId,
      user_id: userId,
      active: b01(values.active ?? true),
      all_sites: b01(values.allSites ?? true),
      // A new row starts at 1 (rows are never deleted, so a form that expected a row always finds it: the
      // conflict branch below then checks the revision).
      rev: 1,
      updated_by: actor.userId,
      created_at: at,
      updated_at: at,
    })
    .onConflict((oc) => oc.columns(["tenant_id", "user_id"]).doUpdateSet(set as never));
}

function siteItem(input: { allSites: boolean; sites: MemberSite[] }): AccessChangeItem {
  return { type: "sites", allSites: input.allSites, worksAt: input.sites.filter((s) => s.worksAt).length, canSee: input.sites.filter((s) => s.worksAt || s.canSee).length };
}

/**
 * Saves one member's access as the form shows it: their exceptions (relative to `role`, their role at this clinic),
 * "can see all sites" and the works-at / can-see table. `extraItems` adds lines to the history (a role change made
 * by the caller). Refused and audited when an exception is locked for the role; "conflict" when someone saved
 * this member's access since `expectedRev` was read.
 */
export async function saveMemberAccess(
  ctx: DbContext,
  tenantId: string,
  userId: string,
  role: PmsRole,
  input: MemberAccessInput,
  expectedRev: number,
  actor: PmsActor,
  extraItems: AccessChangeItem[] = [],
): Promise<AccessSaveResult> {
  assertTenantId(tenantId);
  assertId(userId, "userId");
  const data = parseInput(MemberAccessInputSchema, input, "Member access") as MemberAccessInput;
  const locked = lockedExceptions(role, data.exceptions);
  if (locked.length > 0) {
    await auditRefusal(ctx, tenantId, actor, userId, { role, permissions: locked });
    return { ok: false, reason: "locked", locked };
  }
  const [overrides, before] = await Promise.all([listRoleOverrides(ctx, tenantId), getMemberAccess(ctx, tenantId, userId)]);
  if (before.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: before.rev };
  const exceptions = normaliseExceptions(role, data.exceptions, overridesFor(role, overrides));
  const sites = new Map<string, MemberSite>();
  for (const s of data.sites) {
    const prev = sites.get(s.siteId);
    sites.set(s.siteId, { siteId: s.siteId, worksAt: s.worksAt || Boolean(prev?.worksAt), canSee: s.canSee || s.worksAt || Boolean(prev?.canSee) });
  }
  const siteRows = Array.from(sites.values()).filter((s) => s.worksAt || s.canSee);
  const at = nowIso(ctx);

  const items: AccessChangeItem[] = [...extraItems];
  for (const p of Array.from(new Set([...Object.keys(before.exceptions), ...Object.keys(exceptions)])) as AccessPermission[]) {
    const was = before.exceptions[p];
    const now = exceptions[p];
    if (was === now) continue;
    items.push({ type: "exception", permission: p, to: typeof now === "boolean" ? now : null });
  }
  const sameSites =
    before.allSites === data.allSites &&
    JSON.stringify(before.sites.filter((s) => s.worksAt || s.canSee).map((s) => [s.siteId, s.worksAt, s.canSee || s.worksAt]).sort()) ===
      JSON.stringify(siteRows.map((s) => [s.siteId, s.worksAt, s.canSee]).sort());
  if (!sameSites) items.push(siteItem({ allSites: data.allSites, sites: siteRows }));
  if (items.length === 0) return { ok: true, changed: 0, rev: before.rev };

  const queries: BatchQuery[] = [
    upsertAccessRow(ctx, tenantId, userId, actor, at, { allSites: data.allSites }, expectedRev),
    ctx.db.deleteFrom("pms_member_permissions").where("tenant_id", "=", tenantId).where("user_id", "=", userId),
    ctx.db.deleteFrom("pms_member_sites").where("tenant_id", "=", tenantId).where("user_id", "=", userId),
  ];
  const exRows = (Object.entries(exceptions) as [AccessPermission, boolean][]).map(([permission, allowed]) => ({
    tenant_id: tenantId,
    user_id: userId,
    permission,
    allowed: b01(allowed),
    updated_by: actor.userId,
    updated_at: at,
  }));
  if (exRows.length > 0) queries.push(ctx.db.insertInto("pms_member_permissions").values(exRows));
  for (let i = 0; i < siteRows.length; i += 40) {
    queries.push(
      ctx.db.insertInto("pms_member_sites").values(
        siteRows.slice(i, i + 40).map((s) => ({ tenant_id: tenantId, user_id: userId, site_id: s.siteId, works_at: b01(s.worksAt), can_see: b01(s.canSee), updated_at: at })),
      ),
    );
  }
  const history = historyInsert(ctx, tenantId, actor, at, { kind: "member", subjectRole: role, subjectUserId: userId, items });
  queries.push(history.query);
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.access.member_update",
      targetType: "pms_access",
      targetId: userId,
      detail: {
        role,
        exceptions: Object.entries(exceptions).map(([p, v]) => `${p}:${v ? "on" : "off"}`),
        allSites: data.allSites,
        worksAt: siteRows.filter((s) => s.worksAt).length,
        canSee: siteRows.length,
        changes: items.map((i) => i.type),
      },
    }),
  );
  try {
    await writeWithAudit(ctx, queries, { foreignKey: "A site does not exist in this clinic." });
  } catch (err) {
    if (isStaleRev(err)) return { ok: false, reason: "conflict", currentRev: (await getMemberAccess(ctx, tenantId, userId)).rev };
    throw err;
  }
  return { ok: true, changed: items.length, rev: expectedRev + 1 };
}

function isStaleRev(err: unknown): boolean {
  const e = err as { message?: string; cause?: unknown };
  return classifyDbError(err) === "CONSTRAINT_CHECK" || classifyDbError(e?.cause) === "CONSTRAINT_CHECK" || /value is outside what is allowed/i.test(e?.message ?? "");
}

/**
 * Switches a member's clinic-system access off (Deactivate) or back on. Their ClinForms membership, exceptions and
 * sites stay as they are. The caller refuses the owner and the member themself.
 */
export async function setMemberActive(ctx: DbContext, tenantId: string, userId: string, role: PmsRole, active: boolean, actor: PmsActor): Promise<{ changed: boolean }> {
  assertTenantId(tenantId);
  assertId(userId, "userId");
  const before = await getMemberAccess(ctx, tenantId, userId);
  if (before.active === active) return { changed: false };
  const at = nowIso(ctx);
  const history = historyInsert(ctx, tenantId, actor, at, { kind: "member", subjectRole: role, subjectUserId: userId, items: [{ type: "active", to: active }] });
  await writeWithAudit(ctx, [
    upsertAccessRow(ctx, tenantId, userId, actor, at, { active }, null),
    history.query,
    pmsAuditQuery(ctx, tenantId, actor, { action: active ? "pms.access.member_reactivate" : "pms.access.member_deactivate", targetType: "pms_access", targetId: userId, detail: { role } }),
  ]);
  return { changed: true };
}
