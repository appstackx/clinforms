/**
 * Today's figures for the dashboard (src/app/app/clinic/page.tsx) – the same sources, fact checks and site scope
 * as the reports, for today (UK) only. Each function checks its permission first and answers a Result; the
 * dashboard decides which tiles a role sees.
 *
 *   attendanceToday           diary.view   appointments today (not cancelled), done (arrived / in treatment /
 *                                          completed), DNA, sites with appointments
 *   utilisationTodayBySite    reports.all  booked minutes against the practitioners' rota minutes, per site
 *   authorisationsEndingSoon  patients.view  authorisations to act on (expiring within 14 days, expired in the
 *                                          last 30, used up or nearly) – soonest first
 */
import { pmsNow } from "../../../modules/pms/core/clock";
import { ukToday } from "../../../modules/pms/core/text";
import { attendanceOf, type AuthorisationReason } from "../../../modules/pms/reporting/metrics";
import { checkAppointmentFacts } from "../../../modules/pms/reporting/fact-checks";
import { fail, ok, type Result } from "../records/access";
import { buildReportRequest, loadAuthorisations, loadDirectory, loadUtilisation, toQuery } from "./reports";
import { siteScopeOf } from "./scope";
import type { ReportsActor } from "./service";
import { reportingSources, type ReportingSources } from "./sources";

const FORBIDDEN = "You do not have permission to see this.";

async function todayRequest(actor: ReportsActor, now: Date) {
  const ctx = actor.repo();
  const dir = await loadDirectory(ctx, actor.tenantId);
  const today = ukToday(now);
  const built = buildReportRequest({
    tenantId: actor.tenantId,
    params: { preset: "custom", from: today, to: today, siteId: null, practitionerId: null, serviceId: null },
    today,
    now: now.toISOString(),
    scope: siteScopeOf({ siteIds: actor.siteIds ?? null }),
    directory: dir,
  });
  return { ctx, dir, req: built.request };
}

export interface AttendanceToday {
  /** Appointments today that were not cancelled (booked, arrived, in treatment, completed, DNA). */
  appointments: number;
  /** Arrived, in treatment or completed. */
  done: number;
  dna: number;
  /** Sites with at least one of those appointments. */
  sites: number;
}

export async function attendanceToday(actor: ReportsActor, options: { now?: Date; sources?: ReportingSources } = {}): Promise<Result<AttendanceToday>> {
  if (!actor.can("diary.view")) return fail("forbidden", FORBIDDEN);
  const sources = options.sources ?? reportingSources();
  if (!sources.diary) return ok({ appointments: 0, done: 0, dna: 0, sites: 0 });
  const { ctx, req } = await todayRequest(actor, options.now ?? pmsNow());
  const facts = checkAppointmentFacts(await sources.diary.appointmentFacts(ctx, actor.tenantId, toQuery(req)), {
    from: req.period.from,
    to: req.period.to,
    siteIds: req.siteIds,
    practitionerId: null,
    known: req.known,
  }).facts.filter((f) => f.outcome !== "cancelled" && f.outcome !== "late_cancel");
  const t = attendanceOf(facts);
  return ok({ appointments: t.total, done: t.attended, dna: t.dna, sites: new Set(facts.filter((f) => f.appointments > 0).map((f) => f.siteId)).size });
}

export interface SiteUtilisationToday {
  siteId: string;
  siteName: string;
  bookedMinutes: number;
  /** The practitioners' rota minutes at the site today (inside opening hours); null = nobody on the rota. */
  availableMinutes: number | null;
  utilisation: number | null;
}

export async function utilisationTodayBySite(actor: ReportsActor, options: { now?: Date; sources?: ReportingSources } = {}): Promise<Result<SiteUtilisationToday[]>> {
  if (!actor.can("reports.all")) return fail("forbidden", FORBIDDEN);
  const { ctx, dir, req } = await todayRequest(actor, options.now ?? pmsNow());
  const r = await loadUtilisation(ctx, req, dir, options.sources ?? reportingSources());
  if (!r.available) return ok([]);
  return ok(
    r.bySiteRota
      .filter((x) => x.availableMinutes !== null || x.bookedMinutes > 0)
      .map((x) => ({ siteId: x.key, siteName: dir.siteName(x.key), bookedMinutes: x.bookedMinutes, availableMinutes: x.availableMinutes, utilisation: x.utilisation }))
      .sort((a, b) => a.siteName.localeCompare(b.siteName)),
  );
}

export interface AuthorisationSoon {
  id: string;
  patientId: string;
  patientName: string | null;
  payerName: string | null;
  code: string;
  sessionsUsed: number;
  sessionsAuthorised: number | null;
  sessionsLeft: number | null;
  expiresOn: string | null;
  daysToExpiry: number | null;
  reasons: AuthorisationReason[];
  siteId: string | null;
  siteName: string;
}

export async function authorisationsEndingSoon(actor: ReportsActor, limit = 5, options: { now?: Date } = {}): Promise<Result<{ rows: AuthorisationSoon[]; total: number }>> {
  if (!actor.can("patients.view")) return fail("forbidden", FORBIDDEN);
  const { ctx, dir, req } = await todayRequest(actor, options.now ?? pmsNow());
  const alerts = await loadAuthorisations(ctx, req, 14);
  const rows = alerts.slice(0, Math.max(0, limit)).map((a) => ({
    id: a.authorisation.id,
    patientId: a.authorisation.patientId,
    patientName: a.authorisation.patientName,
    payerName: a.authorisation.issuerName,
    code: a.authorisation.code,
    sessionsUsed: a.authorisation.sessionsUsed,
    sessionsAuthorised: a.authorisation.sessionsAuthorised,
    sessionsLeft: a.view.sessionsLeft,
    expiresOn: a.authorisation.expiresOn,
    daysToExpiry: a.view.daysToExpiry,
    reasons: a.reasons,
    siteId: a.authorisation.siteId,
    siteName: dir.siteName(a.authorisation.siteId),
  }));
  return ok({ rows, total: alerts.length });
}
