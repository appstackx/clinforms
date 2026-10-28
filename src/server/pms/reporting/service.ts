/**
 * The reports' server layer – what the report pages and the CSV route call. Every function:
 *
 *   1. checks the member's permission FIRST: reports.all opens every report for the member's sites; reports.own
 *      (clinicians by default) opens attendance, utilisation and caseload limited to the member's OWN practitioner
 *      (no linked practitioner = an empty report that says so); the finance reports need reports.all; CSV needs
 *      reports.export;
 *   2. limits every figure to the member's sites (actor.siteIds from the access module – a site outside them is
 *      ignored, never shown): the sources filter in SQL AND the loaders' fact checks drop anything else;
 *   3. answers a ReportView: the stat cards, chart and tables the page shows and the CSV rows of the same figures
 *      (a download always holds what the screen shows).
 *
 * Nothing here decrypts clinical text; the authorisations report names patients (as the design does) and is for
 * reports.all only.
 */
import type { PayerType } from "../../../modules/pms/core/types";
import { formatPence, formatUkDate } from "../../../modules/pms/core/text";
import { pmsNow } from "../../../modules/pms/core/clock";
import { REPORTS, reportAccess, type ReportId } from "../../../modules/pms/reporting/catalogue";
import { AUTHORISATION_REASON_LABELS, DEBT_BUCKET_LABELS, PAYER_TYPE_LABELS } from "../../../modules/pms/reporting/copy";
import { penceToPounds, reportFileName, toCsv, type CsvValue } from "../../../modules/pms/reporting/csv";
import { DEBT_BUCKETS, overduePence, ratio, totalUtilisation, type AttendanceRow } from "../../../modules/pms/reporting/metrics";
import { PERIOD_LABELS, REPORT_PERIOD_CHIPS, monthLabel, type PeriodPreset, weekLabel } from "../../../modules/pms/reporting/periods";
import { parseReportFilter, type QuerySource } from "../../../modules/pms/reporting/schemas";
import type { ChartBar, ReportFilters, ReportPage, ReportTable, ReportView } from "../../../modules/pms/reporting/view";
import { ukToday } from "../../../modules/pms/core/text";
import { pmsAudit } from "../../repos/pms/context";
import { findPractitionerByUser } from "../../repos/pms/directory";
import { authorisationSessionsLeft } from "../../repos/pms/reporting/record-figures";
import { getReportingSettings } from "../../repos/pms/reporting/settings";
import { fail, ok, type RecordsActor, type Result } from "../records/access";
import {
  buildReportRequest,
  loadAttendance,
  loadAuthorisations,
  loadCaseload,
  loadDebtors,
  loadDirectory,
  loadRevenue,
  loadUtilisation,
  type ReportDirectory,
  type ReportRequest,
} from "./reports";
import { siteScopeOf } from "./scope";
import { reportingSources, type ReportingSources } from "./sources";

export type ReportsActor = RecordsActor;
export type { ChartBar, ReportChart, ReportFilters, ReportPage, ReportTable, ReportView, StatCard } from "../../../modules/pms/reporting/view";

/* ------------------------------------------------------------------------------------------------
 * What a page shows
 * ----------------------------------------------------------------------------------------------*/

/* ------------------------------------------------------------------------------------------------
 * Formatting
 * ----------------------------------------------------------------------------------------------*/

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(1)}%`);
const pct0 = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${Math.round(v * 100)}%`);
const n = (v: number) => v.toLocaleString("en-GB");
function hours(minutes: number | null): string {
  if (minutes === null) return "–";
  const h = Math.round((minutes / 60) * 10) / 10;
  return h.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}
const hoursCsv = (minutes: number | null) => (minutes === null ? null : Math.round((minutes / 60) * 100) / 100);
const ratePercentCsv = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
const L = "left" as const;
const R = "right" as const;
const cols = (labels: string[]) => labels.map((label, i) => ({ label, align: i === 0 ? L : R }));

/** "Priya Shah" → "P Shah" (chart labels). */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0][0]} ${parts[parts.length - 1]}`;
}

/** A scale top above the largest value and the target, on a round step. */
function scaleMax(values: number[], target: number | null, step: number): number {
  const top = Math.max(target ?? 0, ...values, 0);
  return Math.max(step, Math.ceil((top * 1.15) / step) * step);
}

function describe(title: string, bars: ChartBar[]): string {
  return bars.length ? `${title}: ${bars.map((b) => `${b.label} ${b.display}`).join(", ")}` : `${title}: no figures`;
}

/* ------------------------------------------------------------------------------------------------
 * The request: permission, sites, own caseload
 * ----------------------------------------------------------------------------------------------*/

interface Built {
  req: ReportRequest;
  dir: ReportDirectory;
  filters: ReportFilters;
  own: boolean;
  /** reports.own without a linked practitioner. */
  unlinked: boolean;
  targets: { utilisation: number; dna: number };
}

async function build(actor: ReportsActor, id: ReportId, params: QuerySource, now: Date): Promise<Result<Built>> {
  const access = reportAccess(id, (p) => actor.can(p));
  if (!access) return fail("forbidden", "You do not have permission to see this report.");
  const ctx = actor.repo();
  const parsed = parseReportFilter(params);
  const [dir, settings, mine] = await Promise.all([
    loadDirectory(ctx, actor.tenantId),
    getReportingSettings(ctx, actor.tenantId),
    access === "own" ? findPractitionerByUser(ctx, actor.tenantId, actor.userId) : Promise.resolve(null),
  ]);
  const own = access === "own";
  const info = REPORTS[id];
  const scope = siteScopeOf({ siteIds: actor.siteIds ?? null });
  const asked = {
    ...parsed,
    practitionerId: own ? (mine?.id ?? "__none__") : info.filters.practitioner ? parsed.practitionerId : null,
    serviceId: info.filters.service ? parsed.serviceId : null,
  };
  const built = buildReportRequest({ tenantId: actor.tenantId, params: asked, today: ukToday(now), now: now.toISOString(), scope, directory: dir });
  const req = built.request;
  if (own) req.practitionerId = mine?.id ?? null;
  const p = req.period;
  const filters: ReportFilters = {
    period: info.filters.period
      ? {
          preset: p.preset,
          chips: REPORT_PERIOD_CHIPS.map((preset) => ({ preset, label: preset === "custom" ? "Custom" : PERIOD_LABELS[preset] })),
          from: p.from,
          to: p.to,
          rangeText: `${formatUkDate(p.from)} – ${formatUkDate(p.to)}`,
          error: built.periodError,
        }
      : null,
    sites: built.siteChoices.filter((s) => s.active || s.id === req.siteId).map((s) => ({ id: s.id, name: s.name })),
    siteId: req.siteId,
    allSites: scope.all,
    practitioners: info.filters.practitioner && !own ? built.practitionerChoices.filter((x) => x.bookable || x.id === req.practitionerId).map((x) => ({ id: x.id, name: x.displayName })) : null,
    practitionerId: own ? null : req.practitionerId,
    services: info.filters.service ? dir.services.filter((x) => x.active || x.id === req.serviceId).map((x) => ({ id: x.id, name: x.name })) : null,
    serviceId: req.serviceId,
    own,
  };
  return ok({ req, dir, filters, own, unlinked: own && !mine, targets: { utilisation: settings.utilisationTargetPercent / 100, dna: settings.dnaTargetTenths / 1000 } });
}

function queryOf(f: ReportFilters): string {
  const q = new URLSearchParams();
  if (f.period) {
    q.set("period", f.period.preset);
    if (f.period.preset === "custom") {
      q.set("from", f.period.from);
      q.set("to", f.period.to);
    }
  }
  if (f.siteId) q.set("site", f.siteId);
  if (f.practitionerId) q.set("practitioner", f.practitionerId);
  if (f.serviceId) q.set("service", f.serviceId);
  return q.toString();
}

const UNLINKED = "Your account is not linked to a practitioner, so there is no caseload of your own to show. Ask the clinic owner to link you (Set-up → Practitioners).";
const NO_DIARY = "These figures come from the diary. They appear once appointments are booked in the diary.";
const NO_BILLING = "These figures come from invoicing. They appear once invoices are raised in the clinic system.";

function emptyView(id: ReportId, notice: string): ReportView {
  return { id, title: REPORTS[id].title, description: REPORTS[id].description, notice, stats: [], chart: null, tables: [], footnote: null, csv: { header: ["note"], rows: [[notice]] } };
}

/* ------------------------------------------------------------------------------------------------
 * The reports
 * ----------------------------------------------------------------------------------------------*/

function attendanceRowCells(label: string, r: AttendanceRow): string[] {
  return [label, n(r.due), n(r.attended), n(r.dna), n(r.lateCancel), pct(r.dnaRate)];
}

async function attendanceView(b: Built, sources: ReportingSources): Promise<ReportView> {
  const r = await loadAttendance(ctxOf(b), b.req, sources);
  if (!r.available) return emptyView("attendance", NO_DIARY);
  const t = r.total;
  const target = b.targets.dna;
  const weeks = r.byWeek;
  const values = weeks.map((w) => (w.dnaRate ?? 0) * 100);
  const bars = weeks.map((w, i) => ({ label: i === 0 ? `w/c ${weekLabel(w.key, true)}` : weekLabel(w.key, true), value: values[i], display: pct(w.dnaRate), strong: (w.dnaRate ?? 0) > target }));
  const max = scaleMax(values, target * 100, 1);
  const tables: ReportTable[] = [
    { id: "weeks", title: null, columns: cols(["Week", "Booked", "Attended", "DNA", "Late cancellation", "DNA rate"]), rows: weeks.map((w) => ({ cells: attendanceRowCells(weekLabel(w.key), w) })), empty: "No appointments in this period." },
  ];
  if (!b.req.practitionerId) {
    tables.push({ id: "practitioners", title: "By practitioner", columns: cols(["Practitioner", "Booked", "Attended", "DNA", "Late cancellation", "DNA rate"]), rows: r.byPractitioner.map((x) => ({ cells: attendanceRowCells(b.dir.practitionerName(x.key), x) })), empty: "No appointments in this period." });
  }
  const header = ["group", "name", "booked", "attended", "did_not_attend", "late_cancellations", "dna_rate_percent", "cancelled_in_good_time", "not_recorded", "upcoming"];
  const csvRow = (group: string, name: string, x: AttendanceRow | (typeof r)["total"]) => [group, name, x.due, x.attended, x.dna, x.lateCancel, ratePercentCsv(x.dnaRate), x.cancelled, x.unrecorded, x.upcoming];
  const rows: CsvValue[][] = [csvRow("total", "All", t), ...weeks.map((w) => csvRow("week", w.key, w)), ...r.byPractitioner.map((x) => csvRow("practitioner", b.dir.practitionerName(x.key), x))];
  return {
    id: "attendance",
    title: REPORTS.attendance.title,
    description: REPORTS.attendance.description,
    notice: null,
    stats: [
      { id: "attended", label: "Attended", value: n(t.attended), sub: `${pct(t.attendedRate)} of booked`, tone: "plain" },
      { id: "dna", label: "DNA", value: n(t.dna), sub: `${pct(t.dnaRate)} · target under ${(target * 100).toFixed(1)}%`, tone: (t.dnaRate ?? 0) > target ? "warn" : "plain" },
      { id: "late", label: "Late cancellations", value: n(t.lateCancel), sub: pct(t.lateCancelRate), tone: "plain" },
    ],
    chart: { title: "DNA rate by week (%)", bars, max, maxLabel: `${max}%`, note: `Darker bar = above the ${(target * 100).toFixed(1)}% target.`, description: describe("DNA rate by week", bars) },
    tables,
    footnote: `Booked = attended + did not attend + late cancellations (cancelled in good time is left out; "Completed" counts as attended, in treatment as arrived).${t.unrecorded ? ` ${n(t.unrecorded)} past appointment${t.unrecorded === 1 ? " is" : "s are"} still marked booked (not recorded) and left out.` : ""}`,
    csv: { header, rows },
  };
}

async function utilisationView(b: Built, sources: ReportingSources): Promise<ReportView> {
  const r = await loadUtilisation(ctxOf(b), b.req, b.dir, sources);
  if (!r.available) return emptyView("utilisation", NO_DIARY);
  const target = b.targets.utilisation;
  const pracs = r.byPractitioner.filter((x) => x.availableMinutes !== null || x.bookedMinutes > 0);
  const total = totalUtilisation(pracs);
  const mainSite = (pid: string) => b.dir.siteName(b.dir.practitioners.find((p) => p.id === pid)?.defaultSiteId ?? null);
  const bars = pracs.map((x) => ({ label: shortName(b.dir.practitionerName(x.key)), value: (x.utilisation ?? 0) * 100, display: pct0(x.utilisation), strong: (x.utilisation ?? 0) >= target }));
  const siteRows = r.bySiteRota.filter((x) => x.availableMinutes !== null || x.bookedMinutes > 0);
  const scopeLabel = b.req.siteId ? b.dir.siteName(b.req.siteId) : b.filters.allSites ? "All sites" : "Your sites";
  const header = ["group", "name", "rota_hours", "booked_hours", "utilisation_percent", "main_site"];
  const rows: CsvValue[][] = [
    ...pracs.map((x) => ["practitioner", b.dir.practitionerName(x.key), hoursCsv(x.availableMinutes), hoursCsv(x.bookedMinutes), ratePercentCsv(x.utilisation), mainSite(x.key)]),
    ...(b.req.practitionerId ? [] : siteRows.map((x) => ["site", b.dir.siteName(x.key), hoursCsv(x.availableMinutes), hoursCsv(x.bookedMinutes), ratePercentCsv(x.utilisation), ""])),
  ];
  const tables: ReportTable[] = [
    { id: "practitioners", title: null, columns: cols(["Practitioner", "Rota hours", "Booked hours", "Utilisation", "Main site"]), rows: pracs.map((x) => ({ cells: [b.dir.practitionerName(x.key), hours(x.availableMinutes), hours(x.bookedMinutes), pct0(x.utilisation), mainSite(x.key)] })), empty: "No rota time or appointments in this period." },
  ];
  if (!b.req.practitionerId) tables.push({ id: "sites", title: "By site", columns: cols(["Site", "Rota hours", "Booked hours", "Utilisation"]), rows: siteRows.map((x) => ({ cells: [b.dir.siteName(x.key), hours(x.availableMinutes), hours(x.bookedMinutes), pct0(x.utilisation)] })), empty: "No rota time in this period." });
  return {
    id: "utilisation",
    title: REPORTS.utilisation.title,
    description: REPORTS.utilisation.description,
    notice: null,
    stats: [
      { id: "utilisation", label: b.req.practitionerId ? "Utilisation" : "Average utilisation", value: pct0(total.utilisation), sub: `Target ${Math.round(target * 100)}%`, tone: total.utilisation !== null && total.utilisation < target ? "warn" : "plain" },
      { id: "rota-hours", label: "Rota hours", value: hours(total.availableMinutes), sub: scopeLabel, tone: "plain" },
      { id: "unfilled-hours", label: "Unfilled hours", value: hours(Math.max(0, total.availableMinutes - total.bookedMinutes)), sub: "Rota time not booked", tone: "plain" },
    ],
    chart: { title: "Booked share of rota hours (%)", bars, max: 100, maxLabel: "100%", note: `Darker bar = at or above the ${Math.round(target * 100)}% target.`, description: describe("Booked share of rota hours", bars) },
    tables,
    footnote: "Booked time includes did-not-attend and late cancellations (they used the time); rota time is the practitioners' working hours inside the sites' opening hours, less closures.",
    csv: { header, rows },
  };
}

async function caseloadView(b: Built): Promise<ReportView> {
  const r = await loadCaseload(ctxOf(b), b.req);
  const pracs = r.practitioners.filter((x) => x.open + x.opened + x.closed > 0);
  const bars = pracs.map((x) => ({ label: x.key ? shortName(b.dir.practitionerName(x.key)) : "None", value: x.open, display: n(x.open), strong: false }));
  const name = (key: string | null) => (key ? b.dir.practitionerName(key) : "No practitioner");
  return {
    id: "caseload",
    title: REPORTS.caseload.title,
    description: REPORTS.caseload.description,
    notice: null,
    stats: [
      { id: "open", label: "Open cases", value: n(r.openTotal), sub: b.req.practitionerId ? b.dir.practitionerName(b.req.practitionerId) : "All practitioners", tone: "plain" },
      { id: "new", label: "New this period", value: n(r.opened), sub: "Cases opened", tone: "plain" },
      { id: "discharged", label: "Discharged", value: n(r.closed), sub: "Cases closed", tone: "plain" },
    ],
    chart: { title: "Open cases", bars, max: scaleMax(bars.map((x) => x.value), null, 5), maxLabel: String(scaleMax(bars.map((x) => x.value), null, 5)), note: null, description: describe("Open cases", bars) },
    tables: [
      { id: "practitioners", title: null, columns: cols(["Practitioner", "Open", "New", "Discharged"]), rows: pracs.map((x) => ({ cells: [name(x.key), n(x.open), n(x.opened), n(x.closed)] })), empty: "No cases." },
      { id: "payers", title: "Open cases by payer", columns: cols(["Payer", "Open"]), rows: r.openByPayer.map((x) => ({ cells: [PAYER_TYPE_LABELS[x.key] ?? x.key, n(x.cases)] })), empty: "No open cases." },
    ],
    footnote: "A case belongs to the site and practitioner it was opened with.",
    csv: {
      header: ["group", "name", "open", "opened_in_period", "closed_in_period"],
      rows: [["total", "All", r.openTotal, r.opened, r.closed], ...pracs.map((x) => ["practitioner", name(x.key), x.open, x.opened, x.closed] as CsvValue[]), ...r.openByPayer.map((x) => ["payer", PAYER_TYPE_LABELS[x.key] ?? x.key, x.cases, null, null] as CsvValue[])],
    },
  };
}

async function revenueView(b: Built, sources: ReportingSources): Promise<ReportView> {
  const r = await loadRevenue(ctxOf(b), b.req, sources);
  if (!r.available) return emptyView("revenue", NO_BILLING);
  const t = r.total;
  const insurerInvoiced = r.byPayer.filter((x) => x.key !== "self_pay").reduce((s, x) => s + x.invoicedPence, 0);
  const months = r.byMonth;
  const patientsBy = new Map<string, number>();
  const insurersBy = new Map<string, number>();
  for (const m of months) {
    patientsBy.set(m.key, 0);
    insurersBy.set(m.key, 0);
  }
  for (const row of r.byMonthPayer) {
    const target = row.payerType === "self_pay" ? patientsBy : insurersBy;
    target.set(row.month, (target.get(row.month) ?? 0) + row.invoicedPence);
  }
  const values = months.map((m) => m.invoicedPence / 100);
  const max = scaleMax(values, null, 100);
  const bars = months.map((m, i) => ({ label: monthLabel(m.key).slice(0, 3), value: values[i], display: formatPence(m.invoicedPence).replace(/\.\d\d$/, ""), strong: false }));
  return {
    id: "revenue",
    title: REPORTS.revenue.title,
    description: REPORTS.revenue.description,
    notice: null,
    stats: [
      { id: "invoiced", label: "Invoiced", value: formatPence(t.invoicedPence), sub: `${n(t.invoices)} invoice${t.invoices === 1 ? "" : "s"}`, tone: "plain" },
      { id: "collected", label: "Collected", value: formatPence(t.receivedPence), sub: `${pct0(ratio(t.receivedPence, t.invoicedPence))} of invoiced`, tone: "plain" },
      { id: "insurer-share", label: "Insurer share", value: pct0(ratio(insurerInvoiced, t.invoicedPence)), sub: formatPence(insurerInvoiced), tone: "plain" },
    ],
    chart: { title: "Invoiced per month (£)", bars, max, maxLabel: `£${max.toLocaleString("en-GB")}`, note: null, description: describe("Invoiced per month", bars) },
    tables: [
      {
        id: "months",
        title: null,
        columns: cols(["Month", "Patients", "Insurers", "Credit notes", "Total", "Received"]),
        rows: months.map((m) => ({ cells: [monthLabel(m.key), formatPence(patientsBy.get(m.key) ?? 0), formatPence(insurersBy.get(m.key) ?? 0), formatPence(-m.creditedPence).replace(/^£0\.00$/, "£0.00"), formatPence(m.netPence), formatPence(m.receivedPence)] })),
        empty: "No invoices in this period.",
      },
      { id: "payers", title: "By payer", columns: cols(["Payer", "Invoiced", "Credited", "Net", "Received"]), rows: r.byPayer.map((x) => ({ cells: [PAYER_TYPE_LABELS[x.key as PayerType] ?? x.key, formatPence(x.invoicedPence), formatPence(x.creditedPence), formatPence(x.netPence), formatPence(x.receivedPence)] })), empty: "No invoices in this period." },
    ],
    footnote: "Patients = invoices addressed to the patient (self-pay, excesses, contributions and fees); insurers = invoices to an insurer or other account. Invoiced and credited by the document's date, received by the payment's date; void invoices left out.",
    csv: {
      header: ["group", "name", "invoiced_patients_gbp", "invoiced_insurers_gbp", "credited_gbp", "net_gbp", "received_gbp"],
      rows: [
        ...months.map((m) => ["month", m.key, penceToPounds(patientsBy.get(m.key) ?? 0), penceToPounds(insurersBy.get(m.key) ?? 0), penceToPounds(m.creditedPence), penceToPounds(m.netPence), penceToPounds(m.receivedPence)] as CsvValue[]),
        ["total", "All", penceToPounds(t.invoicedPence - insurerInvoiced), penceToPounds(insurerInvoiced), penceToPounds(t.creditedPence), penceToPounds(t.netPence), penceToPounds(t.receivedPence)],
      ],
    },
  };
}

async function debtorsView(b: Built, sources: ReportingSources): Promise<ReportView> {
  const r = await loadDebtors(ctxOf(b), b.req, sources);
  if (!r.available) return emptyView("debtors", NO_BILLING);
  const t = r.total;
  const label = (x: (typeof r.rows)[number]) => (x.payerType === "self_pay" && !x.payerReferrerId ? "Patients (all)" : x.name);
  const largest = r.rows[0] ?? null;
  const over60 = overduePence(t, 60);
  const bucketLabels: Record<(typeof DEBT_BUCKETS)[number], string> = { not_due: "Not yet due", d0_30: "1–30", d31_60: "31–60", d61_90: "61–90", d91_plus: "90+" };
  const values = DEBT_BUCKETS.map((k) => t.buckets[k] / 100);
  const bars = DEBT_BUCKETS.map((k, i) => ({ label: bucketLabels[k], value: values[i], display: formatPence(t.buckets[k]).replace(/\.\d\d$/, ""), strong: k === "d61_90" || k === "d91_plus" }));
  const max = scaleMax(values, null, 50);
  return {
    id: "debtors",
    title: REPORTS.debtors.title,
    description: REPORTS.debtors.description,
    notice: null,
    stats: [
      { id: "owed", label: "Total owed", value: formatPence(t.outstandingPence), sub: `${n(t.invoices)} invoice${t.invoices === 1 ? "" : "s"}`, tone: "plain" },
      { id: "over-60", label: "Over 60 days", value: formatPence(over60), sub: pct0(ratio(over60, t.outstandingPence)), tone: over60 > 0 ? "warn" : "plain" },
      { id: "largest", label: "Largest debtor", value: largest ? label(largest) : "–", sub: largest ? formatPence(largest.outstandingPence) : "", tone: "plain" },
    ],
    chart: { title: "Owed by age (£)", bars, max, maxLabel: `£${max.toLocaleString("en-GB")}`, note: "Darker bar = over 60 days.", description: describe("Owed by age", bars) },
    tables: [
      {
        id: "accounts",
        title: null,
        columns: cols(["Account", ...DEBT_BUCKETS.map((k) => DEBT_BUCKET_LABELS[k]), "Total"]),
        rows: r.rows.map((x) => ({ cells: [label(x), ...DEBT_BUCKETS.map((k) => formatPence(x.buckets[k])), formatPence(x.outstandingPence)] })),
        empty: "Nothing is owed.",
      },
    ],
    footnote: "What is still owed today on each issued invoice after payments and credit notes, by days past its due date (the issue date when there is none) – the same bands as Billing → Aged debt.",
    csv: {
      header: ["account", "invoices", ...DEBT_BUCKETS.map((k) => `${k}_gbp`), "total_gbp"],
      rows: [...r.rows.map((x) => [label(x), x.invoices, ...DEBT_BUCKETS.map((k) => penceToPounds(x.buckets[k])), penceToPounds(x.outstandingPence)] as CsvValue[]), ["Total", t.invoices, ...DEBT_BUCKETS.map((k) => penceToPounds(t.buckets[k])), penceToPounds(t.outstandingPence)]],
    },
  };
}

async function authorisationsView(b: Built, canSeePatients: boolean): Promise<ReportView> {
  const ctx = ctxOf(b);
  const [alerts, left] = await Promise.all([loadAuthorisations(ctx, b.req, 30), authorisationSessionsLeft(ctx, b.req.tenantId, { today: b.req.today, siteIds: b.req.siteIds, practitionerId: b.req.practitionerId })]);
  const buckets = [0, 0, 0, 0, 0];
  let active = 0;
  for (const x of left) {
    buckets[Math.min(4, x.left)] += x.authorisations;
    active += x.authorisations;
  }
  const bars = ["0 left", "1 left", "2 left", "3 left", "4+ left"].map((label, i) => ({ label, value: buckets[i], display: n(buckets[i]), strong: i <= 1 }));
  const expiring14 = alerts.filter((a) => a.view.daysToExpiry !== null && a.view.daysToExpiry >= 0 && a.view.daysToExpiry <= 14).length;
  const why = (reasons: readonly string[]) => reasons.map((x) => AUTHORISATION_REASON_LABELS[x as keyof typeof AUTHORISATION_REASON_LABELS] ?? x).join(", ");
  const max = scaleMax(buckets, null, 5);
  return {
    id: "authorisations",
    title: REPORTS.authorisations.title,
    description: REPORTS.authorisations.description,
    notice: null,
    stats: [
      { id: "active", label: "Active authorisations", value: n(active), sub: "With a session limit", tone: "plain" },
      { id: "need-extension", label: "Need extension", value: n(buckets[0] + buckets[1]), sub: "0 or 1 session left", tone: buckets[0] + buckets[1] > 0 ? "warn" : "plain" },
      { id: "expiring", label: "Expiring in 14 days", value: n(expiring14), sub: "", tone: "plain" },
    ],
    chart: { title: "Sessions left on active authorisations", bars, max, maxLabel: String(max), note: "Darker bar = an extension is needed.", description: describe("Sessions left on active authorisations", bars) },
    tables: [
      {
        id: "authorisations",
        title: "To act on",
        columns: cols(["Patient", "Insurer", "Used", "Authorised", "Expires", "Why"]),
        rows: alerts.map((a) => ({
          cells: [a.authorisation.patientName ?? "Patient", a.authorisation.issuerName ?? "–", n(a.authorisation.sessionsUsed), a.authorisation.sessionsAuthorised === null ? "–" : n(a.authorisation.sessionsAuthorised), formatUkDate(a.authorisation.expiresOn) || "–", why(a.reasons)],
          href: canSeePatients ? `/app/clinic/patients/${a.authorisation.patientId}` : null,
        })),
        empty: "No authorisation needs action.",
      },
    ],
    footnote: "To act on: expiring within 30 days, expired in the last 30 days, used up, or one session or little value left.",
    csv: {
      header: ["patient_number", "patient", "insurer", "code", "sessions_used", "sessions_authorised", "value_used_gbp", "value_authorised_gbp", "expires_on", "why"],
      rows: alerts.map((a) => [a.authorisation.patientNumber, a.authorisation.patientName, a.authorisation.issuerName, a.authorisation.code, a.authorisation.sessionsUsed, a.authorisation.sessionsAuthorised, penceToPounds(a.authorisation.valueUsedPence), penceToPounds(a.authorisation.valueAuthorisedPence), a.authorisation.expiresOn, why(a.reasons)]),
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Entry points
 * ----------------------------------------------------------------------------------------------*/

const contexts = new WeakMap<Built, ReturnType<ReportsActor["repo"]>>();
function ctxOf(b: Built): ReturnType<ReportsActor["repo"]> {
  const c = contexts.get(b);
  if (!c) throw new Error("report context missing");
  return c;
}

/** The report page for `id` and the query string (filters outside the member's access are ignored). */
export async function reportPageFor(actor: ReportsActor, id: ReportId, params: QuerySource, options: { now?: Date; sources?: ReportingSources } = {}): Promise<Result<ReportPage>> {
  const built = await build(actor, id, params, options.now ?? pmsNow());
  if (!built.ok) return built;
  const b = built.value;
  contexts.set(b, actor.repo());
  const sources = options.sources ?? reportingSources();
  let view: ReportView;
  if (b.unlinked) view = emptyView(id, UNLINKED);
  else if (id === "attendance") view = await attendanceView(b, sources);
  else if (id === "utilisation") view = await utilisationView(b, sources);
  else if (id === "caseload") view = await caseloadView(b);
  else if (id === "revenue") view = await revenueView(b, sources);
  else if (id === "debtors") view = await debtorsView(b, sources);
  else view = await authorisationsView(b, actor.can("patients.view"));
  return ok({ view, filters: b.filters, canExport: actor.can("reports.export"), query: queryOf(b.filters) });
}

/** The CSV of a report (reports.export as well as the report's own permission). */
export async function reportCsvFor(actor: ReportsActor, id: ReportId, params: QuerySource, options: { now?: Date; sources?: ReportingSources } = {}): Promise<Result<{ view: ReportView; filters: ReportFilters; from: string; to: string; csv: string; fileName: string }>> {
  if (!actor.can("reports.export")) return fail("forbidden", "You do not have permission to download reports.");
  const page = await reportPageFor(actor, id, params, options);
  if (!page.ok) return page;
  const now = options.now ?? pmsNow();
  const today = ukToday(now);
  const p = page.value.filters.period;
  const f = page.value.filters;
  // Recorded in the clinic's audit trail: which report, how many rows and which filters – ids and counts only.
  await pmsAudit(actor.repo(), actor.tenantId, actor.actor, {
    action: "pms.report.export",
    targetType: "pms_report",
    targetId: id,
    detail: { rows: page.value.view.csv.rows.length, siteFiltered: f.siteId !== null || !f.allSites, practitionerFiltered: f.practitionerId !== null || f.own, own: f.own },
  });
  return ok({ view: page.value.view, filters: f, from: p?.from ?? today, to: p?.to ?? today, csv: toCsv(page.value.view.csv.header, page.value.view.csv.rows), fileName: reportFileName(id, actor.tenantId, p?.from ?? today, p?.to ?? today) });
}
