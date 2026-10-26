/**
 * The reports' data: one loader per report, shared by the pages and the CSV downloads (so a download holds what
 * the screen shows). Each loader takes the clinic's repository context, a resolved request (period, sites the
 * viewer may see, practitioner) and the reporting sources; figures come from the pure rules in
 * src/modules/pms/reporting/metrics.ts. Nothing here decrypts clinical text.
 */
import { DEFAULT_PRESET, monthsOf, periodInstants, resolvePeriod, type ReportPeriod } from "../../../modules/pms/reporting/periods";
import {
  agedDebt,
  attendanceBy,
  attendanceOf,
  authorisationAlerts,
  monthSeries,
  patientMix,
  previousPeriod,
  revenueBy,
  revenueOf,
  totalUtilisation,
  utilisationByPractitioner,
  utilisationByRoom,
  utilisationBySite,
  type AttendanceFigures,
  type AttendanceRow,
  type AuthorisationAlert,
  type DebtRow,
  type PatientMix,
  type RevenueFigures,
  type RevenueRow,
  type UtilisationRow,
} from "../../../modules/pms/reporting/metrics";
import { checkAppointmentFacts, checkAvailabilityFacts, checkDebtFacts, checkRevenueFacts, type FactFilter, type KnownIds } from "../../../modules/pms/reporting/fact-checks";
import type { ReportFilterParams } from "../../../modules/pms/reporting/schemas";
import { siteFilterFor, sitesInScope, type SiteScope } from "../../../modules/pms/reporting/staff";
import type { PayerType, Practitioner, ReferrerKind, Room, Site } from "../../../modules/pms/core/types";
import { logAuthEvent } from "../../email/log";
import type { RepoContext } from "../../repos/context";
import { listPractitioners, listRooms, listSites } from "../../repos/pms/directory";
import { listClosures, listOpeningHours } from "../../repos/pms/reporting/opening-hours";
import {
  authorisationsForReview,
  casesClosedIn,
  casesOpenedBy,
  newPatientsByMonth,
  openCaseload,
  patientMixByCases,
  patientsRegistered,
  referralSources,
  referrerNames,
  type AuthorisationReviewRow,
  type CaseCountRow,
  type CaseloadRow,
  type ReferralSourceRow,
} from "../../repos/pms/reporting/record-figures";
import type { ReportingQuery } from "./query";
import type { ReportingSources } from "./sources";

/* ------------------------------------------------------------------------------------------------
 * Request: period, sites, practitioner
 * ----------------------------------------------------------------------------------------------*/

export interface ReportDirectory {
  sites: Site[];
  rooms: Room[];
  practitioners: Practitioner[];
  siteName: (id: string | null) => string;
  roomName: (id: string | null) => string;
  practitionerName: (id: string | null) => string;
}

/** Every site, room and practitioner of the clinic (inactive ones too: history points at them). */
export async function loadDirectory(ctx: RepoContext, tenantId: string): Promise<ReportDirectory> {
  const [sites, rooms, practitioners] = await Promise.all([
    listSites(ctx, tenantId, { includeInactive: true }),
    listRooms(ctx, tenantId, { includeInactive: true }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
  ]);
  const siteNames = new Map(sites.map((s) => [s.id, s.name]));
  const roomNames = new Map(rooms.map((r) => [r.id, `${r.name}${siteNames.get(r.siteId) ? ` · ${siteNames.get(r.siteId)}` : ""}`]));
  const pracNames = new Map(practitioners.map((p) => [p.id, p.displayName]));
  return {
    sites,
    rooms,
    practitioners,
    siteName: (id) => (id ? (siteNames.get(id) ?? "Unknown site") : "No site"),
    roomName: (id) => (id ? (roomNames.get(id) ?? "Unknown room") : "No room"),
    practitionerName: (id) => (id ? (pracNames.get(id) ?? "Unknown practitioner") : "No practitioner"),
  };
}

export interface ReportRequest {
  tenantId: string;
  period: ReportPeriod;
  /** UK date and ISO instant the report is made on. */
  today: string;
  now: string;
  scope: SiteScope;
  /** The site chosen in the filter (inside the scope), or null. */
  siteId: string | null;
  /** The sites the figures cover: null = the whole clinic. */
  siteIds: readonly string[] | null;
  practitionerId: string | null;
  /** The clinic's own sites, rooms and practitioners (facts naming anything else are left out). */
  known: KnownIds;
}

export interface BuiltRequest {
  request: ReportRequest;
  /** A problem with the period asked for (the default period is shown instead). */
  periodError: string | null;
  /** Sites the viewer may pick from. */
  siteChoices: Site[];
  practitionerChoices: Practitioner[];
}

export function buildReportRequest(options: { tenantId: string; params: ReportFilterParams; today: string; now: string; scope: SiteScope; directory: ReportDirectory }): BuiltRequest {
  const { params, today, scope, directory } = options;
  let periodError: string | null = null;
  let resolved = resolvePeriod(params.preset ?? DEFAULT_PRESET, today, { from: params.from, to: params.to });
  if (!resolved.ok) {
    periodError = resolved.error;
    resolved = resolvePeriod(DEFAULT_PRESET, today);
  }
  const period = (resolved as { ok: true; period: ReportPeriod }).period;
  const siteChoices = sitesInScope(scope, directory.sites);
  const siteId = params.siteId && siteChoices.some((s) => s.id === params.siteId) ? params.siteId : null;
  const siteIds = siteFilterFor(scope, siteId);
  const practitionerChoices = directory.practitioners.filter((p) => p.active || p.id === params.practitionerId);
  const practitionerId = params.practitionerId && directory.practitioners.some((p) => p.id === params.practitionerId) ? params.practitionerId : null;
  return {
    request: {
      tenantId: options.tenantId,
      period,
      today,
      now: options.now,
      scope,
      siteId,
      siteIds,
      practitionerId,
      known: { siteIds: directory.sites.map((s) => s.id), roomIds: directory.rooms.map((r) => r.id), practitionerIds: directory.practitioners.map((p) => p.id) },
    },
    periodError,
    siteChoices,
    practitionerChoices,
  };
}

export function toQuery(req: Pick<ReportRequest, "period" | "now" | "siteIds" | "practitionerId">, period: Pick<ReportPeriod, "from" | "to"> = req.period): ReportingQuery {
  const { start, end } = periodInstants(period);
  return { from: period.from, to: period.to, start, end, now: req.now, siteIds: req.siteIds, practitionerId: req.practitionerId };
}

function withPeriod(req: ReportRequest, period: Pick<ReportPeriod, "from" | "to" | "days">): ReportRequest {
  return { ...req, period: { ...req.period, preset: "custom", ...period } };
}

function factFilter(req: ReportRequest): FactFilter {
  return { from: req.period.from, to: req.period.to, siteIds: req.siteIds, practitionerId: req.practitionerId, known: req.known };
}

function noteDropped(source: string, dropped: number): void {
  if (dropped > 0) logAuthEvent("pms.reporting.facts_dropped", { source, dropped });
}

/** The sites a report's rows cover: the filtered sites, else every active site in the viewer's scope. */
function sitesInView(req: ReportRequest, dir: ReportDirectory): Site[] {
  if (req.siteIds) return dir.sites.filter((s) => req.siteIds?.includes(s.id));
  return sitesInScope(req.scope, dir.sites).filter((s) => s.active);
}

/* ------------------------------------------------------------------------------------------------
 * Utilisation and attendance (diary)
 * ----------------------------------------------------------------------------------------------*/

export type Unavailable = { available: false };

export interface UtilisationReport {
  available: true;
  bySite: UtilisationRow[];
  byRoom: UtilisationRow[];
  byPractitioner: UtilisationRow[];
  /** Sites (room time) – the clinic's figure. */
  total: { bookedMinutes: number; availableMinutes: number; utilisation: number | null };
  practitionerTotal: { bookedMinutes: number; availableMinutes: number; utilisation: number | null };
  /** Sites shown without opening hours (no rate possible). */
  sitesWithoutHours: string[];
}

export async function loadUtilisation(ctx: RepoContext, req: ReportRequest, dir: ReportDirectory, sources: ReportingSources): Promise<UtilisationReport | Unavailable> {
  if (!sources.diary) return { available: false };
  const q = toQuery(req);
  const sites = sitesInView(req, dir);
  const siteIds = sites.map((s) => s.id);
  const [rawFacts, rawAvail, hours, closures] = await Promise.all([
    sources.diary.appointmentFacts(ctx, req.tenantId, q),
    sources.diary.availabilityFacts(ctx, req.tenantId, q),
    listOpeningHours(ctx, req.tenantId, { siteIds }),
    listClosures(ctx, req.tenantId, { from: req.period.from, to: req.period.to, siteIds }),
  ]);
  const facts = checkAppointmentFacts(rawFacts, factFilter(req));
  const avail = checkAvailabilityFacts(rawAvail, factFilter(req));
  noteDropped("diary.appointments", facts.dropped);
  noteDropped("diary.availability", avail.dropped);
  const rooms = dir.rooms.filter((r) => r.active && siteIds.includes(r.siteId));
  const practitioners = req.practitionerId
    ? dir.practitioners.filter((p) => p.id === req.practitionerId)
    : dir.practitioners.filter((p) => p.active && p.bookable && (!req.siteIds || (p.defaultSiteId !== null && siteIds.includes(p.defaultSiteId))));
  const bySite = utilisationBySite(facts.facts, sites, rooms, hours, closures, req.period);
  const byPractitioner = utilisationByPractitioner(facts.facts, practitioners, avail.facts);
  return {
    available: true,
    bySite,
    byRoom: utilisationByRoom(facts.facts, rooms, hours, closures, req.period),
    byPractitioner,
    total: totalUtilisation(bySite),
    practitionerTotal: totalUtilisation(byPractitioner),
    sitesWithoutHours: sites.filter((s) => !hours.some((h) => h.siteId === s.id)).map((s) => s.id),
  };
}

export interface AttendanceReport {
  available: true;
  total: AttendanceFigures;
  bySite: AttendanceRow[];
  byPractitioner: AttendanceRow[];
  byMonth: AttendanceRow[];
}

export async function loadAttendance(ctx: RepoContext, req: ReportRequest, sources: ReportingSources): Promise<AttendanceReport | Unavailable> {
  if (!sources.diary) return { available: false };
  const q = toQuery(req);
  const facts = checkAppointmentFacts(await sources.diary.appointmentFacts(ctx, req.tenantId, q), factFilter(req));
  noteDropped("diary.appointments", facts.dropped);
  const months = monthsOf(req.period.from, req.period.to);
  const byMonth = attendanceBy(facts.facts, (f) => f.month);
  return {
    available: true,
    total: attendanceOf(facts.facts),
    bySite: attendanceBy(facts.facts, (f) => f.siteId),
    byPractitioner: attendanceBy(facts.facts, (f) => f.practitionerId),
    byMonth: months.map((m) => byMonth.find((r) => r.key === m) ?? { key: m, ...attendanceOf([]) }),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Patients and caseload (shared record; diary when in use)
 * ----------------------------------------------------------------------------------------------*/

export interface PatientsReport {
  byCases: PatientMix;
  /** From attended appointments (null until the diary is in use). */
  byAppointments: PatientMix | null;
  newByMonth: { month: string; value: number }[];
  casesOpened: number;
  /** Clinic-wide only (patients have no site): null for a site selection. */
  registered: number | null;
  sources: ReferralSourceRow[];
  sourcesByKind: { kind: ReferrerKind | null; cases: number }[];
}

export async function loadPatients(ctx: RepoContext, req: ReportRequest, sources: ReportingSources): Promise<PatientsReport> {
  const range = { from: req.period.from, to: req.period.to, siteIds: req.siteIds };
  const q = toQuery(req);
  const { start, end } = periodInstants(req.period);
  const [mix, byMonth, opened, registered, refs, attended] = await Promise.all([
    patientMixByCases(ctx, req.tenantId, range),
    newPatientsByMonth(ctx, req.tenantId, range),
    casesOpenedBy(ctx, req.tenantId, range),
    req.siteIds ? Promise.resolve(null) : patientsRegistered(ctx, req.tenantId, start, end),
    referralSources(ctx, req.tenantId, range),
    sources.diary ? sources.diary.attendedPatients(ctx, req.tenantId, q) : Promise.resolve(null),
  ]);
  const kinds = new Map<ReferrerKind | null, number>();
  for (const r of refs) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.cases);
  return {
    byCases: patientMix(mix.patients, mix.newPatients),
    byAppointments: attended ? patientMix(attended.patients, attended.newPatients) : null,
    newByMonth: monthSeries(byMonth, monthsOf(req.period.from, req.period.to)),
    casesOpened: opened.reduce((s, r) => s + r.cases, 0),
    registered,
    sources: refs,
    sourcesByKind: Array.from(kinds.entries())
      .map(([kind, cases]) => ({ kind, cases }))
      .sort((a, b) => b.cases - a.cases),
  };
}

export interface CaseloadReport {
  openTotal: number;
  openByPractitioner: { key: string | null; cases: number }[];
  openBySite: { key: string | null; cases: number }[];
  openByPayer: { key: PayerType; cases: number }[];
  openedByMonth: { month: string; value: number }[];
  openedByPayer: { key: PayerType; cases: number }[];
  opened: number;
  closed: number;
}

function sumBy<T, K>(rows: readonly T[], key: (r: T) => K, value: (r: T) => number): { key: K; cases: number }[] {
  const m = new Map<K, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return Array.from(m.entries())
    .map(([k, cases]) => ({ key: k, cases }))
    .sort((a, b) => b.cases - a.cases);
}

export async function loadCaseload(ctx: RepoContext, req: ReportRequest): Promise<CaseloadReport> {
  const range = { from: req.period.from, to: req.period.to, siteIds: req.siteIds };
  const [open, opened, closed] = await Promise.all([openCaseload(ctx, req.tenantId, req.siteIds), casesOpenedBy(ctx, req.tenantId, range), casesClosedIn(ctx, req.tenantId, range)]);
  const forPrac = <T extends CaseloadRow | CaseCountRow>(rows: T[]) => (req.practitionerId ? rows.filter((r) => r.practitionerId === req.practitionerId) : rows);
  const o = forPrac(open);
  const p = forPrac(opened);
  const byMonth = new Map<string, number>();
  for (const r of p) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.cases);
  return {
    openTotal: o.reduce((s, r) => s + r.cases, 0),
    openByPractitioner: sumBy(o, (r) => r.practitionerId, (r) => r.cases),
    openBySite: sumBy(o, (r) => r.siteId, (r) => r.cases),
    openByPayer: sumBy(o, (r) => r.payerType, (r) => r.cases),
    openedByMonth: monthSeries(byMonth, monthsOf(req.period.from, req.period.to)),
    openedByPayer: sumBy(p, (r) => r.payerType, (r) => r.cases),
    opened: p.reduce((s, r) => s + r.cases, 0),
    closed,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Revenue and debt (invoicing)
 * ----------------------------------------------------------------------------------------------*/

export interface RevenueReport {
  available: true;
  total: RevenueFigures;
  byMonth: RevenueRow[];
  bySite: RevenueRow[];
  byPayer: RevenueRow[];
  byPractitioner: RevenueRow[];
}

export async function loadRevenue(ctx: RepoContext, req: ReportRequest, sources: ReportingSources): Promise<RevenueReport | Unavailable> {
  if (!sources.billing) return { available: false };
  const q = toQuery(req);
  const checked = checkRevenueFacts(await sources.billing.revenueFacts(ctx, req.tenantId, q), factFilter(req));
  noteDropped("billing.revenue", checked.dropped);
  const facts = checked.facts;
  const byMonth = revenueBy(facts, (f) => f.month);
  return {
    available: true,
    total: revenueOf(facts),
    byMonth: monthsOf(req.period.from, req.period.to).map((m) => byMonth.find((r) => r.key === m) ?? { key: m, ...revenueOf([]) }),
    bySite: revenueBy(facts, (f) => f.siteId ?? ""),
    byPayer: revenueBy(facts, (f) => f.payerType),
    byPractitioner: revenueBy(facts, (f) => f.practitionerId),
  };
}

export interface DebtorsReport {
  available: true;
  rows: (DebtRow & { name: string })[];
  total: DebtRow;
}

export async function loadDebtors(ctx: RepoContext, req: ReportRequest, sources: ReportingSources): Promise<DebtorsReport | Unavailable> {
  if (!sources.billing) return { available: false };
  const q = toQuery(req);
  const checked = checkDebtFacts(await sources.billing.debtFacts(ctx, req.tenantId, q), factFilter(req));
  // Payer accounts must be this clinic's own (names are looked up in the clinic's directory only).
  const names = await referrerNames(ctx, req.tenantId, checked.facts.map((f) => f.payerReferrerId).filter((x): x is string => Boolean(x)));
  const facts = checked.facts.filter((f) => f.payerReferrerId === null || names.has(f.payerReferrerId));
  noteDropped("billing.debt", checked.dropped + (checked.facts.length - facts.length));
  const { rows, total } = agedDebt(facts, req.today);
  return {
    available: true,
    rows: rows.map((r) => ({ ...r, name: r.payerReferrerId ? (names.get(r.payerReferrerId) as string) : r.payerType === "self_pay" ? "Self-pay patients" : "No account recorded" })),
    total,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Authorisations to act on (shared record)
 * ----------------------------------------------------------------------------------------------*/

export const AUTHORISATION_WINDOWS = [7, 14, 30, 60] as const;

export async function loadAuthorisations(ctx: RepoContext, req: ReportRequest, days: number): Promise<AuthorisationAlert<AuthorisationReviewRow>[]> {
  const rows = await authorisationsForReview(ctx, req.tenantId, { today: req.today, days, siteIds: req.siteIds });
  const mine = req.practitionerId ? rows.filter((r) => r.practitionerId === req.practitionerId) : rows;
  return authorisationAlerts(mine, req.today, days);
}

/* ------------------------------------------------------------------------------------------------
 * Dashboard
 * ----------------------------------------------------------------------------------------------*/

export interface Compared<T> {
  now: T;
  before: T;
}

export interface DashboardReport {
  period: ReportPeriod;
  previous: { from: string; to: string; days: number };
  attendance: Compared<AttendanceFigures> | null;
  utilisation: Compared<number | null> | null;
  patients: Compared<PatientMix>;
  revenue: Compared<RevenueFigures> | null;
  debt: DebtRow | null;
  authorisationsToAct: number;
  openCases: number;
}

export async function loadDashboard(ctx: RepoContext, req: ReportRequest, dir: ReportDirectory, sources: ReportingSources): Promise<DashboardReport> {
  const prev = previousPeriod(req.period);
  const before = withPeriod(req, prev);
  const [attNow, attBefore, utilNow, utilBefore, patNow, patBefore, revNow, revBefore, debt, auths, caseload] = await Promise.all([
    loadAttendance(ctx, req, sources),
    loadAttendance(ctx, before, sources),
    loadUtilisation(ctx, req, dir, sources),
    loadUtilisation(ctx, before, dir, sources),
    patientMixByCases(ctx, req.tenantId, { from: req.period.from, to: req.period.to, siteIds: req.siteIds }),
    patientMixByCases(ctx, req.tenantId, { from: prev.from, to: prev.to, siteIds: req.siteIds }),
    loadRevenue(ctx, req, sources),
    loadRevenue(ctx, before, sources),
    loadDebtors(ctx, req, sources),
    loadAuthorisations(ctx, req, 14),
    openCaseload(ctx, req.tenantId, req.siteIds),
  ]);
  const open = req.practitionerId ? caseload.filter((r) => r.practitionerId === req.practitionerId) : caseload;
  return {
    period: req.period,
    previous: prev,
    attendance: attNow.available && attBefore.available ? { now: attNow.total, before: attBefore.total } : null,
    utilisation: utilNow.available && utilBefore.available ? { now: (req.practitionerId ? utilNow.practitionerTotal : utilNow.total).utilisation, before: (req.practitionerId ? utilBefore.practitionerTotal : utilBefore.total).utilisation } : null,
    patients: { now: patientMix(patNow.patients, patNow.newPatients), before: patientMix(patBefore.patients, patBefore.newPatients) },
    revenue: revNow.available && revBefore.available ? { now: revNow.total, before: revBefore.total } : null,
    debt: debt.available ? debt.total : null,
    authorisationsToAct: auths.length,
    openCases: open.reduce((s, r) => s + r.cases, 0),
  };
}
