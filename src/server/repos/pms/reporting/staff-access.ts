/**
 * Which sites a member works at (pms_staff_access + pms_staff_sites). No row = every site. Owners are never
 * limited (src/modules/pms/reporting/staff.ts effectiveSiteScope). Revisioned: a change names the revision it
 * was made on and is refused when someone else changed it first.
 *
 * D1 has no interactive transactions, so the replace is ONE batch whose later statements only act when the
 * first one won: the revisioned UPDATE stamps a fresh write token, and the site rows are deleted and inserted
 * only where the access row carries that token. Concurrent writers cannot interleave inside a batch, and a
 * writer whose UPDATE matched no row (stale revision) changes nothing at all.
 */
import { sql } from "kysely";
import { StaffAccessInputSchema, type StaffAccessInput } from "../../../../modules/pms/reporting/schemas";
import { effectiveSiteScope, type SiteScope } from "../../../../modules/pms/reporting/staff";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { ulid } from "../../context";
import { RepoInputError, assertId, assertTenantId, b01, isOn, nowIso, num, parseInput, pmsAudit, writeWithAudit, type DbContext } from "../context";

export interface StaffAccess {
  tenantId: string;
  userId: string;
  allSites: boolean;
  /** Sorted; empty when allSites. */
  siteIds: string[];
  rev: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** A member with no stored access: every site, revision 0. */
export function defaultStaffAccess(tenantId: string, userId: string): StaffAccess {
  return { tenantId, userId, allSites: true, siteIds: [], rev: 0, updatedBy: null, updatedAt: null };
}

export async function getStaffAccess(ctx: DbContext, tenantId: string, userId: string): Promise<StaffAccess> {
  assertTenantId(tenantId);
  assertId(userId, "user id");
  const row = await ctx.db.selectFrom("pms_staff_access").selectAll().where("tenant_id", "=", tenantId).where("user_id", "=", userId).executeTakeFirst();
  if (!row) return defaultStaffAccess(tenantId, userId);
  const sites = isOn(row.all_sites)
    ? []
    : (await ctx.db.selectFrom("pms_staff_sites").select("site_id").where("tenant_id", "=", tenantId).where("user_id", "=", userId).orderBy("site_id").limit(500).execute()).map((r) => r.site_id);
  return { tenantId, userId, allSites: isOn(row.all_sites), siteIds: sites, rev: num(row.rev), updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/** Stored access of every member of the clinic who has a row (members without one: every site). */
export async function listStaffAccess(ctx: DbContext, tenantId: string): Promise<Map<string, StaffAccess>> {
  assertTenantId(tenantId);
  const [rows, sites] = await Promise.all([
    ctx.db.selectFrom("pms_staff_access").selectAll().where("tenant_id", "=", tenantId).orderBy("user_id").limit(2000).execute(),
    ctx.db.selectFrom("pms_staff_sites").select(["user_id", "site_id"]).where("tenant_id", "=", tenantId).orderBy("user_id").orderBy("site_id").limit(20_000).execute(),
  ]);
  const byUser = new Map<string, string[]>();
  for (const s of sites) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s.site_id]);
  const out = new Map<string, StaffAccess>();
  for (const r of rows) {
    const all = isOn(r.all_sites);
    out.set(r.user_id, { tenantId, userId: r.user_id, allSites: all, siteIds: all ? [] : (byUser.get(r.user_id) ?? []), rev: num(r.rev), updatedBy: r.updated_by, updatedAt: r.updated_at });
  }
  return out;
}

/**
 * Sets a member's site access, made on revision `expectedRev` (0 = never set). The sites must exist in this
 * clinic (inactive ones may stay chosen). Audited (ids and counts only).
 */
export async function setStaffAccess(ctx: DbContext, tenantId: string, userId: string, expectedRev: number, input: StaffAccessInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(userId, "user id");
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("Revision must be a whole number.");
  const d = parseInput(StaffAccessInputSchema, input, "Site access");
  if (d.siteIds.length > 0) {
    const found = await ctx.db.selectFrom("pms_sites").select("id").where("tenant_id", "=", tenantId).where("id", "in", d.siteIds).execute();
    if (found.length !== d.siteIds.length) throw new RepoInputError("A chosen site does not exist in this clinic.");
  }
  const at = nowIso(ctx);
  const token = ulid(Date.parse(at));
  const tokenRow = () => ctx.db.selectFrom("pms_staff_access").select(sql<number>`1`.as("one")).where("tenant_id", "=", tenantId).where("user_id", "=", userId).where("write_token", "=", token);
  await writeWithAudit(
    ctx,
    [
      // A first change creates the row (revision 0) so the revisioned update below has something to match.
      ctx.db
        .insertInto("pms_staff_access")
        .values({ tenant_id: tenantId, user_id: userId, all_sites: 1, rev: 0, write_token: null, updated_by: null, created_at: at, updated_at: at })
        .onConflict((oc) => oc.columns(["tenant_id", "user_id"]).doNothing()),
      ctx.db
        .updateTable("pms_staff_access")
        .set({ all_sites: b01(d.allSites), rev: sql<number>`rev + 1`, write_token: token, updated_by: actor.userId, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("user_id", "=", userId)
        .where("rev", "=", expectedRev),
      ctx.db
        .deleteFrom("pms_staff_sites")
        .where("tenant_id", "=", tenantId)
        .where("user_id", "=", userId)
        .where((eb) => eb.exists(tokenRow())),
      ...d.siteIds.map((siteId) =>
        ctx.db
          .insertInto("pms_staff_sites")
          .columns(["tenant_id", "user_id", "site_id"])
          .expression(
            ctx.db
              .selectFrom("pms_staff_access")
              .select([sql<string>`cast(${tenantId} as text)`.as("tenant_id"), sql<string>`cast(${userId} as text)`.as("user_id"), sql<string>`cast(${siteId} as text)`.as("site_id")])
              .where("tenant_id", "=", tenantId)
              .where("user_id", "=", userId)
              .where("write_token", "=", token),
          ),
      ),
    ],
    { foreignKey: "A chosen site does not exist in this clinic." },
  );
  const row = await ctx.db.selectFrom("pms_staff_access").select(["rev", "write_token", "updated_at"]).where("tenant_id", "=", tenantId).where("user_id", "=", userId).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.write_token !== token) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  await pmsAudit(ctx, tenantId, actor, {
    action: "pms.staff_access.set",
    targetType: "user",
    targetId: userId,
    detail: { allSites: d.allSites, sites: d.siteIds.length, rev: num(row.rev) },
  });
  return { ok: true, rev: num(row.rev), updatedAt: row.updated_at };
}

/** Where a member may work (owners: every site). */
export async function getSiteScope(ctx: DbContext, tenantId: string, userId: string, role: string): Promise<SiteScope> {
  const access = await getStaffAccess(ctx, tenantId, userId);
  return effectiveSiteScope(role, access);
}
