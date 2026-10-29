/**
 * Small READ-ONLY figures from the shared patient record (cases, authorisations, outcome measures, the diary's
 * attended visits) for the "Today" page (src/server/pms/reporting/dashboard.ts). Counted in the database; every
 * statement names the clinic; IN lists in groups of 90 (D1: at most 100 parameters). Nothing decrypted.
 */
import { sql } from "kysely";
import { assertTenantId, num, type RepoContext } from "../context";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface AuthorisationAtRisk {
  id: string;
  caseId: string;
  patientId: string;
  referrerId: string | null;
  sessionsAuthorised: number | null;
  sessionsUsed: number;
  expiresOn: string | null;
  /** The case's site (the scope filter). */
  siteId: string | null;
}

/**
 * Active authorisations of open cases with at most one session left, or ending between today and `until` (both
 * included): used up first, then by the sessions left and the expiry date. `siteIds` (null = every site): only cases
 * at those sites (cases without a site are then left out).
 */
export async function authorisationsAtRisk(ctx: RepoContext, tenantId: string, q: { today: string; until: string; siteIds: readonly string[] | null; limit?: number }): Promise<AuthorisationAtRisk[]> {
  assertTenantId(tenantId);
  if (q.siteIds && q.siteIds.length === 0) return [];
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  let query = ctx.db
    .selectFrom("pms_authorisations as a")
    .innerJoin("pms_cases as c", (j) => j.onRef("c.tenant_id", "=", "a.tenant_id").onRef("c.id", "=", "a.case_id"))
    .select(["a.id", "a.case_id", "a.patient_id", "a.referrer_id", "a.sessions_authorised", "a.sessions_used", "a.expires_on", "c.site_id"])
    .where("a.tenant_id", "=", tenantId)
    .where("c.tenant_id", "=", tenantId)
    .where("a.status", "=", "active")
    .where("c.status", "=", "open")
    .where((eb) =>
      eb.or([
        eb.and([eb("a.sessions_authorised", "is not", null), eb(sql<number>`a.sessions_authorised - a.sessions_used`, "<=", 1)]),
        eb.and([eb("a.expires_on", "is not", null), eb("a.expires_on", ">=", q.today), eb("a.expires_on", "<=", q.until)]),
      ]),
    );
  if (q.siteIds) query = query.where("c.site_id", "in", q.siteIds.slice(0, 90) as string[]);
  const rows = await query.orderBy(sql`case when a.sessions_authorised is null then 99 else a.sessions_authorised - a.sessions_used end`).orderBy("a.expires_on").orderBy("a.id").limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    patientId: r.patient_id,
    referrerId: r.referrer_id,
    sessionsAuthorised: r.sessions_authorised === null ? null : num(r.sessions_authorised),
    sessionsUsed: num(r.sessions_used),
    expiresOn: r.expires_on,
    siteId: r.site_id,
  }));
}

/** Per case: outcome measures recorded (not in error) and visits attended before `beforeIso` (outcome due rule). */
export async function caseOutcomeFigures(ctx: RepoContext, tenantId: string, caseIds: readonly string[], beforeIso: string): Promise<Map<string, { measures: number; attendedBefore: number }>> {
  assertTenantId(tenantId);
  const out = new Map<string, { measures: number; attendedBefore: number }>();
  for (const id of caseIds) out.set(id, { measures: 0, attendedBefore: 0 });
  for (const group of chunk(caseIds, 90)) {
    const [measures, visits] = await Promise.all([
      ctx.db
        .selectFrom("pms_outcome_measures")
        .select(["case_id", sql<number>`count(*)`.as("n")])
        .where("tenant_id", "=", tenantId)
        .where("case_id", "in", group as string[])
        .where("status", "=", "recorded")
        .groupBy("case_id")
        .execute(),
      // The cases' own visits (pms_appointments_case), counted here: with "starts_at < ?" in the query SQLite
      // took the start-time index and read the whole clinic's history before today (M10). A case has few visits.
      ctx.db
        .selectFrom("pms_appointments")
        .select(["case_id", "starts_at"])
        .where("tenant_id", "=", tenantId)
        .where("case_id", "in", group as string[])
        .where("kind", "=", "appointment")
        .where("status", "=", "attended")
        .limit(20_000)
        .execute()
        .then((rows) => {
          const before = Date.parse(beforeIso);
          const n = new Map<string, number>();
          for (const r of rows) if (r.case_id && Date.parse(new Date(r.starts_at).toISOString()) < before) n.set(r.case_id, (n.get(r.case_id) ?? 0) + 1);
          return Array.from(n.entries()).map(([case_id, c]) => ({ case_id, n: c }));
        }),
    ]);
    for (const m of measures) if (m.case_id) out.set(m.case_id, { ...(out.get(m.case_id) ?? { measures: 0, attendedBefore: 0 }), measures: num(m.n) });
    for (const v of visits) if (v.case_id) out.set(v.case_id, { ...(out.get(v.case_id) ?? { measures: 0, attendedBefore: 0 }), attendedBefore: num(v.n) });
  }
  return out;
}

/** Open cases of one practitioner (within the site scope; null = every site) and how many sites they are at. */
export async function openCasesOf(ctx: RepoContext, tenantId: string, practitionerId: string, siteIds: ReadonlySet<string> | null): Promise<{ cases: number; sites: number }> {
  assertTenantId(tenantId);
  if (siteIds && siteIds.size === 0) return { cases: 0, sites: 0 };
  let q = ctx.db
    .selectFrom("pms_cases")
    .select(["site_id", sql<number>`count(*)`.as("n")])
    .where("tenant_id", "=", tenantId)
    .where("practitioner_id", "=", practitionerId)
    .where("status", "=", "open");
  if (siteIds) q = q.where("site_id", "in", Array.from(siteIds).slice(0, 90));
  const rows = await q.groupBy("site_id").execute();
  return { cases: rows.reduce((s, r) => s + num(r.n), 0), sites: rows.filter((r) => r.site_id !== null).length };
}
