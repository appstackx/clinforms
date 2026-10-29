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
 * and closures – the one opening-hours source), so utilisation follows what the diary and online booking offer –
 * joined with the time actually booked (a booking outside the hours, e.g. after the hours changed, is time the
 * practitioner worked) and less the practitioner's blocked time (leave, meetings, training…). Booked time is
 * clipped the same way, so it never passes the available time (utilisation ≤ 100 %).
 */
import { PostgresAdapter, sql, type Kysely, type RawBuilder } from "kysely";
import type { Database } from "../../db/schema";
import type { AppointmentFact, AppointmentOutcome, AttendedPatientsFact, AvailabilityFact, VisitFact } from "../../../modules/pms/reporting/facts";
import { dayUtilisation, type Interval } from "../../../modules/pms/reporting/intervals";
import { addDays, eachDay } from "../../../modules/pms/reporting/periods";
import { londonParts } from "../../../modules/pms/diary/time";
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

/** Pieces of [startsAt, endsAt) per UK date, in minutes after local midnight (a span past midnight is split). */
function localPieces(startsAt: unknown, endsAt: unknown): { date: string; span: Interval }[] {
  const start = new Date(startsAt as string).getTime();
  const end = new Date(endsAt as string).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const out: { date: string; span: Interval }[] = [];
  let at = start;
  for (let guard = 0; at < end && guard < 400; guard++) {
    const p = londonParts(at);
    const left = Math.round((end - at) / 60000);
    const until = Math.min(1440, p.minute + left);
    out.push({ date: p.date, span: [p.minute, until] });
    at += (until - p.minute) * 60000;
  }
  return out;
}

async function availabilityFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<AvailabilityFact[]> {
  assertTenantId(tenantId);
  if (q.siteIds && q.siteIds.length === 0) return [];
  // Bookings that held their slot and the practitioners' blocked time (no patient columns are read). From the day
  // before the period: a block that started then may run past midnight.
  const [windows, { rows }] = await Promise.all([
    availabilityWindows(ctx, tenantId, eachDay(q.from, q.to), { practitionerIds: q.practitionerId ? [q.practitionerId] : undefined }),
    sql<{ kind: string; site_id: string; practitioner_id: string; starts_at: string; ends_at: string }>`
      select a.kind, a.site_id, a.practitioner_id, a.starts_at, a.ends_at
      from pms_appointments a
      where a.tenant_id = ${tenantId} and a.practitioner_id is not null and a.status <> 'cancelled' and a.kind in ('appointment', 'block')
        and a.starts_on >= ${addDays(q.from, -1)} and a.starts_on <= ${q.to}${practitionerIs("a.practitioner_id", q.practitionerId)}
    `.execute(ctx.db),
  ]);
  const allowed = q.siteIds ? new Set(q.siteIds) : null;
  const inPeriod = (date: string) => date >= q.from && date <= q.to;
  type Day = { practitionerId: string; siteId: string; date: string; rota: Interval[]; booked: Interval[] };
  const days = new Map<string, Day>();
  const day = (practitionerId: string, siteId: string, date: string) => {
    const key = `${practitionerId}|${siteId}|${date}`;
    let d = days.get(key);
    if (!d) days.set(key, (d = { practitionerId, siteId, date, rota: [], booked: [] }));
    return d;
  };
  for (const w of windows) {
    if (allowed && !allowed.has(w.siteId)) continue;
    day(w.practitionerId, w.siteId, w.date).rota.push([w.startMinute, w.endMinute]);
  }
  // Blocked time counts against the practitioner wherever it was entered (leave is leave at every site).
  const blocks = new Map<string, Interval[]>();
  for (const r of rows) {
    for (const piece of localPieces(r.starts_at, r.ends_at)) {
      if (!inPeriod(piece.date)) continue;
      if (r.kind === "block") {
        const key = `${r.practitioner_id}|${piece.date}`;
        blocks.set(key, [...(blocks.get(key) ?? []), piece.span]);
      } else if (!allowed || allowed.has(r.site_id)) {
        day(r.practitioner_id, r.site_id, piece.date).booked.push(piece.span);
      }
    }
  }
  const out: AvailabilityFact[] = [];
  for (const d of Array.from(days.values())) {
    const u = dayUtilisation(d.rota, d.booked, blocks.get(`${d.practitionerId}|${d.date}`) ?? []);
    if (u.available <= 0 && u.blocked <= 0) continue;
    out.push({ practitionerId: d.practitionerId, siteId: d.siteId, month: d.date.slice(0, 7), date: d.date, minutes: u.available, bookedMinutes: u.booked, blockedMinutes: u.blocked });
  }
  return out;
}

/**
 * A patient's first attended appointment ever (any site, any practitioner): one probe of the index
 * pms_appointments_patient_starts per patient (walks that patient's diary from the start to the first attended
 * visit) – never a scan of the whole clinic's history. `column` is the patient id of the outer query.
 */
function firstAttended(tenantId: string, column: string, field: "starts_at" | "starts_on"): RawBuilder<unknown> {
  return sql`(select x.${sql.raw(field)} from pms_appointments x where x.tenant_id = ${tenantId} and x.patient_id = ${sql.ref(column)} and x.kind = 'appointment' and x.status in ('arrived', 'attended') order by x.starts_at, x.id limit 1)`;
}

async function attendedPatients(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<AttendedPatientsFact> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ patients: number | string; new_patients: number | string | null }>`
    select count(*) as patients, sum(case when ${firstAttended(tenantId, "p.patient_id", "starts_on")} >= ${q.from} then 1 else 0 end) as new_patients
    from (
      select distinct b.patient_id from pms_appointments b
      where b.tenant_id = ${tenantId} and b.kind = 'appointment' and b.status in ('arrived', 'attended') and b.patient_id is not null
        and b.starts_on >= ${q.from} and b.starts_on <= ${q.to}${siteIn("b.site_id", q.siteIds)}${practitionerIs("b.practitioner_id", q.practitionerId)}
    ) p
  `.execute(ctx.db);
  return { patients: num(rows[0]?.patients ?? 0), newPatients: num(rows[0]?.new_patients ?? 0) };
}

/**
 * Attended appointments in the period by UK date, site and practitioner, split by whether each was the patient's
 * first attended appointment ever (any site, any practitioner) – new vs returning patients.
 */
async function visitFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<VisitFact[]> {
  assertTenantId(tenantId);
  // A visit is the patient's first when no attended visit of theirs started earlier – one short probe of
  // pms_appointments_patient_starts per visit (the same answer as "starts at the patient's first attended time",
  // ties included), never a pass over the clinic's whole history (M10: 2.1M rows read on D1 for a year).
  const { rows } = await sql<{ d: string; site_id: string | null; practitioner_id: string | null; first_visit: number | string; n: number | string }>`
    select a.starts_on as d, a.site_id, a.practitioner_id,
      case when a.patient_id is not null and not exists (
        select 1 from pms_appointments x
        where x.tenant_id = ${tenantId} and x.patient_id = a.patient_id and x.kind = 'appointment' and x.status in ('arrived', 'attended') and x.starts_at < a.starts_at
      ) then 1 else 0 end as first_visit,
      count(*) as n
    from pms_appointments a
    where a.tenant_id = ${tenantId} and a.kind = 'appointment' and a.status in ('arrived', 'attended')
      and a.starts_on >= ${q.from} and a.starts_on <= ${q.to}${siteIn("a.site_id", q.siteIds)}${practitionerIs("a.practitioner_id", q.practitionerId)}
    group by 1, 2, 3, 4
  `.execute(ctx.db);
  return rows.map((r) => ({ month: r.d.slice(0, 7), date: r.d, siteId: r.site_id, practitionerId: r.practitioner_id, firstVisit: num(r.first_visit) === 1, appointments: num(r.n) }));
}

/** The diary's reporting source (registered by default in src/server/pms/reporting/sources.ts). */
export const DIARY_REPORTING_SOURCE: DiaryReportingSource = { appointmentFacts, availabilityFacts, attendedPatients, visitFacts };
