/**
 * The diary's figures for the reports (src/server/pms/reporting/sources.ts – the reports never read the diary's
 * tables themselves). AGGREGATED in the database: one row per UK date, site, room, practitioner, appointment type,
 * status and "still to come", so a year of a multi-site clinic never travels to the app appointment by appointment.
 * Every statement names the clinic; IN lists stay under D1's 100 parameters; the same SQL runs on SQLite / D1 and
 * Postgres (only the minutes between two instants differ – see minutesExpr).
 *
 * Outcomes (src/modules/pms/reporting/facts.ts): booked → upcoming (starts at or after "now") or unrecorded;
 * arrived (incl. "in treatment" = arrived + treatment_started_at) and attended ("Completed" on screen) → attended;
 * dna; late_cancelled → late_cancel; cancelled. Blocked time (kind = block) never counts.
 * Working time = the rota's windows from the diary's own availabilityWindows (clipped to the sites' opening hours
 * and closures – the one opening-hours source), so utilisation follows what the diary and online booking offer.
 */
import { PostgresAdapter, sql, type Kysely, type RawBuilder } from "kysely";
import type { Database } from "../../db/schema";
import type { AppointmentFact, AppointmentOutcome, AttendedPatientsFact, AvailabilityFact } from "../../../modules/pms/reporting/facts";
import { eachDay } from "../../../modules/pms/reporting/periods";
import { assertTenantId, num, type RepoContext } from "../../repos/pms/context";
import { availabilityWindows } from "../../repos/pms/diary/availability";
import type { DiaryReportingSource, ReportingQuery } from "../reporting/sources";

/** Is this database Postgres (PGlite in tests)? SQLite and D1 otherwise. */
export function isPostgres(db: Kysely<Database>): boolean {
  return db.getExecutor().adapter instanceof PostgresAdapter;
}

/** Minutes between starts_at and ends_at (stored as timestamptz on Postgres, ISO text on SQLite / D1). */
function minutesExpr(db: Kysely<Database>): RawBuilder<number> {
  return isPostgres(db)
    ? sql<number>`round(extract(epoch from (a.ends_at - a.starts_at)) / 60)`
    : sql<number>`cast(round((julianday(a.ends_at) - julianday(a.starts_at)) * 1440) as integer)`;
}

/** " and <col> in (…)" (null = every site; [] = nothing). The caller's scope keeps it ≤ 90. */
function siteIn(column: string, siteIds: readonly string[] | null): RawBuilder<unknown> {
  if (!siteIds) return sql``;
  if (siteIds.length === 0) return sql` and 1 = 0`;
  return sql` and ${sql.ref(column)} in (${sql.join(siteIds.slice(0, 90))})`;
}

function practitionerIs(column: string, practitionerId: string | null): RawBuilder<unknown> {
  return practitionerId ? sql` and ${sql.ref(column)} = ${practitionerId}` : sql``;
}

function outcomeOf(status: string, upcoming: boolean): AppointmentOutcome | null {
  switch (status) {
    case "booked":
      return upcoming ? "upcoming" : "unrecorded";
    case "arrived":
    case "attended":
      return "attended";
    case "dna":
      return "dna";
    case "late_cancelled":
      return "late_cancel";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

async function appointmentFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<AppointmentFact[]> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ d: string; site_id: string | null; room_id: string | null; practitioner_id: string | null; service_id: string | null; status: string; later: number | string; n: number | string; minutes: number | string | null }>`
    select a.starts_on as d, a.site_id, a.room_id, a.practitioner_id, a.service_id, a.status,
      case when a.starts_at >= ${q.now} then 1 else 0 end as later,
      count(*) as n, sum(${minutesExpr(ctx.db)}) as minutes
    from pms_appointments a
    where a.tenant_id = ${tenantId} and a.kind = 'appointment' and a.starts_on >= ${q.from} and a.starts_on <= ${q.to}${siteIn("a.site_id", q.siteIds)}${practitionerIs("a.practitioner_id", q.practitionerId)}
    group by 1, 2, 3, 4, 5, 6, 7
  `.execute(ctx.db);
  const out: AppointmentFact[] = [];
  for (const r of rows) {
    const outcome = outcomeOf(r.status, num(r.later) === 1);
    if (!outcome) continue;
    out.push({
      month: r.d.slice(0, 7),
      date: r.d,
      siteId: r.site_id,
      roomId: r.room_id,
      practitionerId: r.practitioner_id,
      serviceId: r.service_id,
      outcome,
      appointments: num(r.n),
      minutes: Math.max(0, num(r.minutes ?? 0)),
    });
  }
  return out;
}

async function availabilityFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<AvailabilityFact[]> {
  assertTenantId(tenantId);
  if (q.siteIds && q.siteIds.length === 0) return [];
  const windows = await availabilityWindows(ctx, tenantId, eachDay(q.from, q.to), { practitionerIds: q.practitionerId ? [q.practitionerId] : undefined });
  const allowed = q.siteIds ? new Set(q.siteIds) : null;
  const sums = new Map<string, AvailabilityFact>();
  for (const w of windows) {
    if (allowed && !allowed.has(w.siteId)) continue;
    const key = `${w.practitionerId}|${w.siteId}|${w.date}`;
    const f = sums.get(key) ?? { practitionerId: w.practitionerId, siteId: w.siteId, month: w.date.slice(0, 7), date: w.date, minutes: 0 };
    f.minutes += Math.max(0, w.endMinute - w.startMinute);
    sums.set(key, f);
  }
  return Array.from(sums.values());
}

async function attendedPatients(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<AttendedPatientsFact> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ patients: number | string; new_patients: number | string | null }>`
    select count(*) as patients, sum(case when f.first_on >= ${q.from} then 1 else 0 end) as new_patients
    from (
      select a.patient_id, min(a.starts_on) as first_on
      from pms_appointments a
      where a.tenant_id = ${tenantId} and a.kind = 'appointment' and a.status in ('arrived', 'attended') and a.patient_id in (
        select b.patient_id from pms_appointments b
        where b.tenant_id = ${tenantId} and b.kind = 'appointment' and b.status in ('arrived', 'attended') and b.patient_id is not null
          and b.starts_on >= ${q.from} and b.starts_on <= ${q.to}${siteIn("b.site_id", q.siteIds)}${practitionerIs("b.practitioner_id", q.practitionerId)}
      )
      group by a.patient_id
    ) f
  `.execute(ctx.db);
  return { patients: num(rows[0]?.patients ?? 0), newPatients: num(rows[0]?.new_patients ?? 0) };
}

/** The diary's reporting source (registered by default in src/server/pms/reporting/sources.ts). */
export const DIARY_REPORTING_SOURCE: DiaryReportingSource = { appointmentFacts, availabilityFacts, attendedPatients };
