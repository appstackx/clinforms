/**
 * The report downloads: the same loaders as the pages, written as CSV (src/modules/pms/reporting/csv.ts). Money
 * in pounds with two decimals, rates as percentages with one decimal, UK dates. Patient names appear only in the
 * authorisations download and only for members who may download patient lists (patients.export); everyone else
 * gets the patient number.
 */
import { formatUkDate } from "../../../modules/pms/core/text";
import type { ReportId } from "../../../modules/pms/reporting/catalogue";
import { AUTHORISATION_REASON_LABELS, DEBT_BUCKET_LABELS, PAYER_TYPE_LABELS, REFERRER_KIND_LABELS, labelOf } from "../../../modules/pms/reporting/copy";
import { penceToPounds, rateToPercent, toCsv, type CsvValue } from "../../../modules/pms/reporting/csv";
import { DEBT_BUCKETS } from "../../../modules/pms/reporting/metrics";
import { monthLabel } from "../../../modules/pms/reporting/periods";
import type { RepoContext } from "../../repos/context";
import { AUTHORISATION_WINDOWS, loadAttendance, loadAuthorisations, loadCaseload, loadDebtors, loadPatients, loadRevenue, loadUtilisation, type ReportDirectory, type ReportRequest } from "./reports";
import type { ReportingSources } from "./sources";

export interface CsvTable {
  header: string[];
  rows: CsvValue[][];
}

export interface CsvOptions {
  /** Authorisations: the window in days. */
  days?: number;
  /** Patient names allowed in the download. */
  patientNames: boolean;
}

const NOT_IN_USE = (what: string): CsvTable => ({ header: ["note"], rows: [[`${what} not in use at this clinic yet`]] });

export async function reportTable(id: ReportId, ctx: RepoContext, req: ReportRequest, dir: ReportDirectory, sources: ReportingSources, options: CsvOptions): Promise<CsvTable> {
  switch (id) {
    case "utilisation": {
      const r = await loadUtilisation(ctx, req, dir, sources);
      if (!r.available) return NOT_IN_USE("The diary is");
      const header = ["group", "name", "utilisation_percent", "booked_minutes", "attended_minutes", "available_minutes", "appointments"];
      const rows: CsvValue[][] = [];
      const add = (group: string, list: typeof r.bySite, name: (id: string) => string) => {
        for (const x of list) rows.push([group, name(x.key), rateToPercent(x.utilisation), x.bookedMinutes, x.attendedMinutes, x.availableMinutes, x.appointments]);
      };
      add("practitioner", r.byPractitioner, dir.practitionerName);
      if (!req.practitionerId) {
        add("site", r.bySite, dir.siteName);
        add("room", r.byRoom, dir.roomName);
      }
      return { header, rows };
    }
    case "attendance": {
      const r = await loadAttendance(ctx, req, sources);
      if (!r.available) return NOT_IN_USE("The diary is");
      const header = ["group", "name", "appointments", "due", "attended", "did_not_attend", "dna_percent", "late_cancellations", "late_cancel_percent", "cancelled_in_good_time", "not_recorded", "upcoming"];
      const rows: CsvValue[][] = [];
      const add = (group: string, list: typeof r.bySite, name: (id: string) => string) => {
        for (const x of list) rows.push([group, name(x.key), x.total, x.due, x.attended, x.dna, rateToPercent(x.dnaRate), x.lateCancel, rateToPercent(x.lateCancelRate), x.cancelled, x.unrecorded, x.upcoming]);
      };
      add("total", [{ key: "", ...r.total }], () => "All");
      add("practitioner", r.byPractitioner, dir.practitionerName);
      add("site", r.bySite, dir.siteName);
      add("month", r.byMonth, monthLabel);
      return { header, rows };
    }
    case "patients": {
      const r = await loadPatients(ctx, req, sources);
      const header = ["group", "name", "value"];
      const rows: CsvValue[][] = [
        ["total", "new patients (first case)", r.byCases.newPatients],
        ["total", "returning patients (new case, seen before)", r.byCases.returning],
        ["total", "cases opened", r.casesOpened],
      ];
      if (r.registered !== null) rows.push(["total", "patients registered", r.registered]);
      if (r.byAppointments) rows.push(["diary", "patients seen", r.byAppointments.patients], ["diary", "seen for the first time", r.byAppointments.newPatients]);
      for (const m of r.newByMonth) rows.push(["new patients by month", monthLabel(m.month), m.value]);
      for (const k of r.sourcesByKind) rows.push(["cases by kind of referrer", k.kind ? labelOf(REFERRER_KIND_LABELS, k.kind) : "Not recorded", k.cases]);
      for (const s of r.sources) rows.push(["cases by referrer", s.name ?? "Not recorded", s.cases]);
      return { header, rows };
    }
    case "caseload": {
      const r = await loadCaseload(ctx, req);
      const header = ["group", "name", "cases"];
      const rows: CsvValue[][] = [
        ["total", "open now", r.openTotal],
        ["total", "opened in the period", r.opened],
        ["total", "closed in the period", r.closed],
      ];
      for (const x of r.openByPractitioner) rows.push(["open by practitioner", dir.practitionerName(x.key), x.cases]);
      for (const x of r.openBySite) rows.push(["open by site", dir.siteName(x.key), x.cases]);
      for (const x of r.openByPayer) rows.push(["open by payer", labelOf(PAYER_TYPE_LABELS, x.key), x.cases]);
      for (const m of r.openedByMonth) rows.push(["opened by month", monthLabel(m.month), m.value]);
      for (const x of r.openedByPayer) rows.push(["opened by payer", labelOf(PAYER_TYPE_LABELS, x.key), x.cases]);
      return { header, rows };
    }
    case "revenue": {
      const r = await loadRevenue(ctx, req, sources);
      if (!r.available) return NOT_IN_USE("Invoicing is");
      const header = ["group", "name", "invoiced_gbp", "credited_gbp", "net_gbp", "received_gbp", "invoices"];
      const rows: CsvValue[][] = [];
      const add = (group: string, list: typeof r.byMonth, name: (k: string) => string) => {
        for (const x of list) rows.push([group, name(x.key), penceToPounds(x.invoicedPence), penceToPounds(x.creditedPence), penceToPounds(x.netPence), penceToPounds(x.receivedPence), x.invoices]);
      };
      add("total", [{ key: "", ...r.total }], () => "All");
      add("month", r.byMonth, monthLabel);
      add("payer", r.byPayer, (k) => labelOf(PAYER_TYPE_LABELS, k));
      add("site", r.bySite, (k) => dir.siteName(k || null));
      add("practitioner", r.byPractitioner, dir.practitionerName);
      return { header, rows };
    }
    case "debtors": {
      const r = await loadDebtors(ctx, req, sources);
      if (!r.available) return NOT_IN_USE("Invoicing is");
      const header = ["payer", "payer_type", "invoices", ...DEBT_BUCKETS.map((b) => `${DEBT_BUCKET_LABELS[b].toLowerCase().replace(/[^a-z0-9]+/g, "_")}_gbp`), "total_gbp", "oldest_due"];
      const rows: CsvValue[][] = [...r.rows, { ...r.total, name: "Total" }].map((x) => [
        x.name,
        x.key === "total" ? "" : labelOf(PAYER_TYPE_LABELS, x.payerType),
        x.invoices,
        ...DEBT_BUCKETS.map((b) => penceToPounds(x.buckets[b])),
        penceToPounds(x.outstandingPence),
        x.oldestDueOn ? formatUkDate(x.oldestDueOn) : "",
      ]);
      return { header, rows };
    }
    case "authorisations": {
      const days = options.days && (AUTHORISATION_WINDOWS as readonly number[]).includes(options.days) ? options.days : 14;
      const alerts = await loadAuthorisations(ctx, req, days);
      const header = ["patient_number", ...(options.patientNames ? ["patient"] : []), "case", "practitioner", "site", "authorisation", "issued_by", "sessions_left", "value_left_gbp", "expires", "days_to_expiry", "why"];
      const rows: CsvValue[][] = alerts.map(({ authorisation: a, view, reasons }) => [
        a.patientNumber,
        ...(options.patientNames ? [a.patientName] : []),
        a.caseTitle,
        a.practitionerId ? dir.practitionerName(a.practitionerId) : "",
        a.siteId ? dir.siteName(a.siteId) : "",
        a.code,
        a.issuerName,
        view.sessionsLeft,
        penceToPounds(view.valueLeftPence),
        a.expiresOn ? formatUkDate(a.expiresOn) : "",
        view.daysToExpiry,
        reasons.map((x) => AUTHORISATION_REASON_LABELS[x]).join("; "),
      ]);
      return { header, rows };
    }
    default:
      return { header: [], rows: [] };
  }
}

export function tableToCsv(table: CsvTable): string {
  return toCsv(table.header, table.rows);
}
