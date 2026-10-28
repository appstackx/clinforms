/**
 * Opening hours and closures of the clinic's sites (pms_site_hours, pms_site_closures). Set-up rows, not
 * clinical records: a site's week is replaced as a whole (one atomic batch with its audit row) and a closure can
 * be removed. Every statement names the clinic; a site of another clinic is refused by the composite foreign key.
 * Read by the utilisation reports (available time) and, later, by online booking.
 */
import { REPORTING_ID_PREFIXES as P } from "../../../../modules/pms/reporting/ids";
import { openingInfo, type OpeningInfo } from "../../../../modules/pms/reporting/opening";
import { daysInclusive } from "../../../../modules/pms/reporting/periods";
import { ClosureInputSchema, OpeningHoursInputSchema, timeToMinutes, type ClosureInput, type OpeningHoursInput } from "../../../../modules/pms/reporting/schemas";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { RepoInputError, assertId, assertTenantId, guarded, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { getSite } from "../directory";

export interface OpeningSession {
  tenantId: string;
  id: string;
  siteId: string;
  /** 1 Monday … 7 Sunday */
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface SiteClosure {
  tenantId: string;
  id: string;
  /** null = every site. */
  siteId: string | null;
  startsOn: string;
  endsOn: string;
  reason: string | null;
  createdAt: string;
}

const SITE_MISSING = "That site does not exist in this clinic.";

/** Opening sessions of the clinic (or of the given sites), by site, weekday and time. */
export async function listOpeningHours(ctx: DbContext, tenantId: string, options: { siteIds?: readonly string[] } = {}): Promise<OpeningSession[]> {
  assertTenantId(tenantId);
  if (options.siteIds && options.siteIds.length === 0) return [];
  const out: OpeningSession[] = [];
  const groups = options.siteIds ? chunk(options.siteIds, 90) : [null];
  for (const ids of groups) {
    let q = ctx.db.selectFrom("pms_site_hours").select(["tenant_id", "id", "site_id", "weekday", "opens_at", "closes_at"]).where("tenant_id", "=", tenantId);
    if (ids) q = q.where("site_id", "in", ids);
    const rows = await q.orderBy("site_id").orderBy("weekday").orderBy("opens_at").limit(2000).execute();
    out.push(...rows.map((r) => ({ tenantId: r.tenant_id, id: r.id, siteId: r.site_id, weekday: num(r.weekday), opensAt: r.opens_at, closesAt: r.closes_at })));
  }
  return out;
}

/**
 * Replaces a site's opening hours with `input.sessions` (an empty list = closed every day). One atomic batch:
 * the old sessions go, the new ones and the audit row are written together.
 */
export async function setOpeningHours(ctx: DbContext, tenantId: string, input: OpeningHoursInput, actor: PmsActor): Promise<OpeningSession[]> {
  assertTenantId(tenantId);
  const d = parseInput(OpeningHoursInputSchema, input, "Opening hours");
  if (!(await getSite(ctx, tenantId, d.siteId))) throw new RepoInputError(SITE_MISSING);
  const at = nowIso(ctx);
  const sessions = d.sessions.slice().sort((a, b) => a.weekday - b.weekday || timeToMinutes(a.opensAt) - timeToMinutes(b.opensAt));
  const days = new Set(sessions.map((s) => s.weekday)).size;
  await writeWithAudit(
    ctx,
    [
      ctx.db.deleteFrom("pms_site_hours").where("tenant_id", "=", tenantId).where("site_id", "=", d.siteId),
      ...sessions.map((s) =>
        ctx.db.insertInto("pms_site_hours").values({
          tenant_id: tenantId,
          id: pmsId(P.openingSession, ctx),
          site_id: d.siteId,
          weekday: s.weekday,
          opens_at: s.opensAt,
          closes_at: s.closesAt,
          created_by: actor.userId,
          created_at: at,
        }),
      ),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.opening_hours.set", targetType: "pms_site", targetId: d.siteId, detail: { sessions: sessions.length, days } }),
    ],
    { foreignKey: SITE_MISSING, unique: "Two opening sessions start at the same time on one day." },
  );
  return listOpeningHours(ctx, tenantId, { siteIds: [d.siteId] });
}

function toClosure(r: { tenant_id: string; id: string; site_id: string | null; starts_on: string; ends_on: string; reason: string | null; created_at: string }): SiteClosure {
  return { tenantId: r.tenant_id, id: r.id, siteId: r.site_id, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason, createdAt: r.created_at };
}

export async function addClosure(ctx: DbContext, tenantId: string, input: ClosureInput, actor: PmsActor): Promise<SiteClosure> {
  assertTenantId(tenantId);
  const d = parseInput(ClosureInputSchema, input, "Closure");
  const id = pmsId(P.closure, ctx);
  const siteId = d.siteId ?? null;
  const endsOn = d.endsOn ?? d.startsOn;
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_site_closures").values({
        tenant_id: tenantId,
        id,
        site_id: siteId,
        starts_on: d.startsOn,
        ends_on: endsOn,
        reason: d.reason ?? null,
        created_by: actor.userId,
        created_at: nowIso(ctx),
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.closure.create", targetType: "pms_closure", targetId: id, detail: { siteId, everySite: siteId === null, days: daysInclusive(d.startsOn, endsOn) } }),
    ],
    { foreignKey: SITE_MISSING },
  );
  return (await getClosure(ctx, tenantId, id)) as SiteClosure;
}

export async function getClosure(ctx: DbContext, tenantId: string, id: string): Promise<SiteClosure | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_site_closures").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toClosure(row) : null;
}

/** Removes a closure (set-up only, not a clinical record). False when there was none in this clinic. */
export async function removeClosure(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "closure id");
  const existing = await getClosure(ctx, tenantId, id);
  if (!existing) return false;
  await writeWithAudit(ctx, [
    ctx.db.deleteFrom("pms_site_closures").where("tenant_id", "=", tenantId).where("id", "=", id),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.closure.remove", targetType: "pms_closure", targetId: id, detail: { siteId: existing.siteId } }),
  ]);
  return true;
}

/**
 * Closures that touch a period (both dates included), of the given sites and of every site. Soonest first,
 * at most 500.
 */
export async function listClosures(ctx: DbContext, tenantId: string, options: { from?: string; to?: string; siteIds?: readonly string[] } = {}): Promise<SiteClosure[]> {
  assertTenantId(tenantId);
  return guarded(async () => {
    let q = ctx.db.selectFrom("pms_site_closures").selectAll().where("tenant_id", "=", tenantId);
    if (options.to) q = q.where("starts_on", "<=", options.to);
    if (options.from) q = q.where("ends_on", ">=", options.from);
    if (options.siteIds) {
      const ids = options.siteIds.slice(0, 90);
      q = ids.length ? q.where((eb) => eb.or([eb("site_id", "is", null), eb("site_id", "in", ids)])) : q.where("site_id", "is", null);
    }
    const rows = await q.orderBy("starts_on").orderBy("id").limit(500).execute();
    return rows.map(toClosure);
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * When the given sites are open between two dates (the diary's rota windows are clipped to this): their opening
 * sessions (sites without any are "not set") and the closures touching the period. Two queries whatever the period.
 */
export async function openingInfoFor(ctx: DbContext, tenantId: string, siteIds: readonly string[] | null, from: string, to: string): Promise<OpeningInfo> {
  assertTenantId(tenantId);
  if (siteIds && siteIds.length === 0) return openingInfo([], []);
  const ids = siteIds ? Array.from(new Set(siteIds)) : undefined;
  const [sessions, closures] = await Promise.all([listOpeningHours(ctx, tenantId, ids ? { siteIds: ids } : {}), listClosures(ctx, tenantId, { from, to, siteIds: ids })]);
  return openingInfo(sessions, closures);
}
