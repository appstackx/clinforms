/**
 * Figures from the shared patient record (cases, patients, referrers, authorisations) for the reports – READ
 * ONLY. Counted in the database (GROUP BY on TEXT dates and ids, the same SQL on SQLite/D1 and Postgres), so a
 * large clinic's history never travels to the app row by row. Every statement names the clinic. Lists are capped;
 * IN lists go in groups of 90 (D1: at most 100 parameters).
 */
import { sql, type RawBuilder } from "kysely";
import type { AuthorisationStatus, PayerType, ReferrerKind } from "../../../../modules/pms/core/types";
import { addDays } from "../../../../modules/pms/reporting/periods";
import { assertTenantId, num, numOrNull, type DbContext, type RepoContext } from "../context";
import { getPatientSummaries } from "../patients";

export interface FigureRange {
  /** UK dates, both included. */
  from: string;
  to: string;
  /** null = every site; else only these sites (cases without a site are then left out). */
  siteIds: readonly string[] | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "and site_id in (…)" for raw SQL, or nothing. Sites beyond 90 are refused by the caller's scope (MAX_SITES_PER_PERSON 60). */
function siteClause(column: string, siteIds: readonly string[] | null): RawBuilder<unknown> {
  if (!siteIds) return sql``;
  if (siteIds.length === 0) return sql` and 1 = 0`;
  return sql` and ${sql.ref(column)} in (${sql.join(siteIds.slice(0, 90))})`;
}

/* ------------------------------------------------------------------------------------------------
 * Cases
 * ----------------------------------------------------------------------------------------------*/

export interface CaseCountRow {
  month: string;
  siteId: string | null;
  practitionerId: string | null;
  payerType: PayerType;
  cases: number;
}

/** Cases opened in the period, by month, site, practitioner and payer type. */
export async function casesOpenedBy(ctx: DbContext, tenantId: string, range: FigureRange): Promise<CaseCountRow[]> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ month: string; site_id: string | null; practitioner_id: string | null; payer_type: string; n: number | string }>`
    select substr(opened_on, 1, 7) as month, site_id, practitioner_id, payer_type, count(*) as n
    from pms_cases
    where tenant_id = ${tenantId} and opened_on >= ${range.from} and opened_on <= ${range.to}${siteClause("site_id", range.siteIds)}
    group by substr(opened_on, 1, 7), site_id, practitioner_id, payer_type
  `.execute(ctx.db);
  return rows.map((r) => ({ month: r.month, siteId: r.site_id, practitionerId: r.practitioner_id, payerType: r.payer_type as PayerType, cases: num(r.n) }));
}

/** Cases closed or discharged in the period. */
export async function casesClosedIn(ctx: DbContext, tenantId: string, range: FigureRange): Promise<number> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ n: number | string }>`
    select count(*) as n from pms_cases
    where tenant_id = ${tenantId} and closed_on is not null and closed_on >= ${range.from} and closed_on <= ${range.to}${siteClause("site_id", range.siteIds)}
  `.execute(ctx.db);
  return num(rows[0]?.n ?? 0);
}

export interface CaseloadRow {
  siteId: string | null;
  practitionerId: string | null;
  payerType: PayerType;
  cases: number;
}

/** Open cases now, by site, practitioner and payer type. */
export async function openCaseload(ctx: DbContext, tenantId: string, siteIds: readonly string[] | null): Promise<CaseloadRow[]> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ site_id: string | null; practitioner_id: string | null; payer_type: string; n: number | string }>`
    select site_id, practitioner_id, payer_type, count(*) as n
    from pms_cases
    where tenant_id = ${tenantId} and status = 'open'${siteClause("site_id", siteIds)}
    group by site_id, practitioner_id, payer_type
  `.execute(ctx.db);
  return rows.map((r) => ({ siteId: r.site_id, practitionerId: r.practitioner_id, payerType: r.payer_type as PayerType, cases: num(r.n) }));
}

export interface ReferralSourceRow {
  referrerId: string | null;
  name: string | null;
  kind: ReferrerKind | null;
  cases: number;
}

/** Who referred the cases opened in the period (the 100 biggest sources; null = not recorded). */
export async function referralSources(ctx: DbContext, tenantId: string, range: FigureRange): Promise<ReferralSourceRow[]> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ referrer_id: string | null; n: number | string }>`
    select referrer_id, count(*) as n
    from pms_cases
    where tenant_id = ${tenantId} and opened_on >= ${range.from} and opened_on <= ${range.to}${siteClause("site_id", range.siteIds)}
    group by referrer_id
    order by count(*) desc, referrer_id
    limit 100
  `.execute(ctx.db);
  const ids = rows.map((r) => r.referrer_id).filter((id): id is string => Boolean(id));
  const names = new Map<string, { name: string; kind: string }>();
  for (const group of chunk(ids, 90)) {
    const found = await ctx.db.selectFrom("pms_referrers").select(["id", "name", "kind"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const f of found) names.set(f.id, { name: f.name, kind: f.kind });
  }
  return rows.map((r) => ({
    referrerId: r.referrer_id,
    name: r.referrer_id ? (names.get(r.referrer_id)?.name ?? null) : null,
    kind: r.referrer_id ? ((names.get(r.referrer_id)?.kind as ReferrerKind | undefined) ?? null) : null,
    cases: num(r.n),
  }));
}

/* ------------------------------------------------------------------------------------------------
 * New and returning patients (by cases)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Patients with a case opened in the period (at the chosen sites), and how many of them had their first case
 * with the clinic (any site) in the period.
 */
export async function patientMixByCases(ctx: DbContext, tenantId: string, range: FigureRange): Promise<{ patients: number; newPatients: number }> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ patients: number | string; new_patients: number | string | null }>`
    select count(*) as patients, sum(case when f.first_on >= ${range.from} then 1 else 0 end) as new_patients
    from (
      select patient_id, min(opened_on) as first_on
      from pms_cases
      where tenant_id = ${tenantId} and patient_id in (
        select patient_id from pms_cases
        where tenant_id = ${tenantId} and opened_on >= ${range.from} and opened_on <= ${range.to}${siteClause("site_id", range.siteIds)}
      )
      group by patient_id
    ) f
  `.execute(ctx.db);
  return { patients: num(rows[0]?.patients ?? 0), newPatients: num(rows[0]?.new_patients ?? 0) };
}

/** New patients (first case with the clinic) by month of that first case. */
export async function newPatientsByMonth(ctx: DbContext, tenantId: string, range: FigureRange): Promise<Map<string, number>> {
  assertTenantId(tenantId);
  const cohort = range.siteIds
    ? sql` and f.patient_id in (select patient_id from pms_cases where tenant_id = ${tenantId} and opened_on >= ${range.from} and opened_on <= ${range.to}${siteClause("site_id", range.siteIds)})`
    : sql``;
  const { rows } = await sql<{ month: string; n: number | string }>`
    select substr(f.first_on, 1, 7) as month, count(*) as n
    from (select patient_id, min(opened_on) as first_on from pms_cases where tenant_id = ${tenantId} group by patient_id) f
    where f.first_on >= ${range.from} and f.first_on <= ${range.to}${cohort}
    group by substr(f.first_on, 1, 7)
  `.execute(ctx.db);
  return new Map(rows.map((r) => [r.month, num(r.n)]));
}

/** Patients registered between two instants ([start, end), ISO). The record has no site, so this is clinic-wide. */
export async function patientsRegistered(ctx: DbContext, tenantId: string, start: string, end: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom("pms_patients")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("created_at", ">=", start)
    .where("created_at", "<", end)
    .executeTakeFirst();
  return num(row?.n ?? 0);
}

/* ------------------------------------------------------------------------------------------------
 * Treatment authorisations needing attention
 * ----------------------------------------------------------------------------------------------*/

export interface AuthorisationReviewRow {
  id: string;
  caseId: string;
  patientId: string;
  referrerId: string | null;
  code: string;
  status: AuthorisationStatus;
  sessionsAuthorised: number | null;
  valueAuthorisedPence: number | null;
  sessionsUsed: number;
  valueUsedPence: number;
  validFrom: string | null;
  expiresOn: string | null;
  /** From the case. */
  caseTitle: string | null;
  siteId: string | null;
  practitionerId: string | null;
  /** From the patient (plain demographics; nothing decrypted). */
  patientNumber: number | null;
  patientName: string | null;
  /** The issuer's name from the directory. */
  issuerName: string | null;
}

/**
 * Active authorisations that expire between 30 days ago and `days` from `today`, or have at most one session
 * (or 15 % of the value) left – at most 500 of each kind, at the chosen sites (by their case's site).
 */
export async function authorisationsForReview(ctx: RepoContext, tenantId: string, options: { today: string; days: number; siteIds: readonly string[] | null }): Promise<AuthorisationReviewRow[]> {
  assertTenantId(tenantId);
  const until = addDays(options.today, Math.max(0, Math.min(366, Math.floor(options.days))));
  const cols = ["id", "case_id", "patient_id", "referrer_id", "code", "status", "sessions_authorised", "value_authorised_pence", "sessions_used", "value_used_pence", "valid_from", "expires_on"] as const;
  const [expiring, low] = await Promise.all([
    ctx.db
      .selectFrom("pms_authorisations")
      .select(cols)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "active")
      .where("expires_on", "is not", null)
      .where("expires_on", ">=", addDays(options.today, -30))
      .where("expires_on", "<=", until)
      .orderBy("expires_on")
      .limit(500)
      .execute(),
    ctx.db
      .selectFrom("pms_authorisations")
      .select(cols)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "active")
      .where((eb) =>
        eb.or([
          eb.and([eb("sessions_authorised", "is not", null), eb(sql<number>`sessions_authorised - sessions_used`, "<=", 1)]),
          eb.and([eb("value_authorised_pence", "is not", null), eb(sql<number>`(value_authorised_pence - value_used_pence) * 100`, "<=", sql<number>`value_authorised_pence * 15`)]),
        ]),
      )
      .orderBy("id")
      .limit(500)
      .execute(),
  ]);
  const byId = new Map<string, (typeof expiring)[number]>();
  for (const r of [...expiring, ...low]) byId.set(r.id, r);
  const auths = Array.from(byId.values());
  const caseIds = Array.from(new Set(auths.map((a) => a.case_id)));
  const cases = new Map<string, { title: string; site_id: string | null; practitioner_id: string | null }>();
  for (const group of chunk(caseIds, 90)) {
    const rows = await ctx.db.selectFrom("pms_cases").select(["id", "title", "site_id", "practitioner_id"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const r of rows) cases.set(r.id, r);
  }
  const visible = auths.filter((a) => {
    if (!options.siteIds) return true;
    const site = cases.get(a.case_id)?.site_id;
    return Boolean(site && options.siteIds.includes(site));
  });
  const patients = await getPatientSummaries(ctx, tenantId, Array.from(new Set(visible.map((a) => a.patient_id))));
  const issuerIds = Array.from(new Set(visible.map((a) => a.referrer_id).filter((x): x is string => Boolean(x))));
  const issuers = new Map<string, string>();
  for (const group of chunk(issuerIds, 90)) {
    const rows = await ctx.db.selectFrom("pms_referrers").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const r of rows) issuers.set(r.id, r.name);
  }
  return visible.map((a) => {
    const c = cases.get(a.case_id);
    const p = patients.get(a.patient_id);
    return {
      id: a.id,
      caseId: a.case_id,
      patientId: a.patient_id,
      referrerId: a.referrer_id,
      code: a.code,
      status: a.status as AuthorisationStatus,
      sessionsAuthorised: numOrNull(a.sessions_authorised),
      valueAuthorisedPence: numOrNull(a.value_authorised_pence),
      sessionsUsed: num(a.sessions_used),
      valueUsedPence: num(a.value_used_pence),
      validFrom: a.valid_from,
      expiresOn: a.expires_on,
      caseTitle: c?.title ?? null,
      siteId: c?.site_id ?? null,
      practitionerId: c?.practitioner_id ?? null,
      patientNumber: p ? p.patientNumber : null,
      patientName: p ? `${p.preferredName ?? p.firstName} ${p.lastName}` : null,
      issuerName: a.referrer_id ? (issuers.get(a.referrer_id) ?? null) : null,
    };
  });
}

/** Names of payer accounts and referrers by id (ids of another clinic are simply not found). */
export async function referrerNames(ctx: DbContext, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  const out = new Map<string, string>();
  for (const group of chunk(Array.from(new Set(ids)), 90)) {
    const rows = await ctx.db.selectFrom("pms_referrers").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}
