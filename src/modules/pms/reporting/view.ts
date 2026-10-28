/**
 * What a report page shows (plain data – the server layer src/server/pms/reporting/service.ts builds it, the
 * screens in src/components/pms/reporting render it, the CSV route writes its csv rows). Pure types.
 */
import type { ReportId } from "./catalogue";
import type { CsvValue } from "./csv";
import type { PeriodPreset } from "./periods";

export interface StatCard {
  id: string;
  label: string;
  value: string;
  sub: string;
  /** "warn": above/below the clinic's target. */
  tone: "plain" | "warn";
}

export interface ChartBar {
  label: string;
  value: number;
  display: string;
  /** The design's darker bar (beyond the target). */
  strong: boolean;
}

export interface ReportChart {
  title: string;
  bars: ChartBar[];
  /** Top of the scale, and how it reads. */
  max: number;
  maxLabel: string;
  /** "Darker bar = above the 4.0% target." */
  note: string | null;
  /** The chart as words (screen readers). */
  description: string;
}

export interface ReportTable {
  id: string;
  title: string | null;
  columns: { label: string; align: "left" | "right" }[];
  rows: { cells: string[]; href?: string | null }[];
  empty: string;
}

export interface ReportView {
  id: ReportId;
  title: string;
  description: string;
  /** Why there are no figures (not linked to a practitioner, no diary yet…), else null. */
  notice: string | null;
  stats: StatCard[];
  chart: ReportChart | null;
  tables: ReportTable[];
  /** A line under the tables (definitions, rows not recorded yet). */
  footnote: string | null;
  csv: { header: string[]; rows: CsvValue[][] };
}

export interface ReportFilters {
  /** The period chips; null = this report has no period (debtors, authorisations: "today"). */
  period: { preset: PeriodPreset; chips: { preset: PeriodPreset; label: string }[]; from: string; to: string; rangeText: string; error: string | null } | null;
  sites: { id: string; name: string }[];
  siteId: string | null;
  /** All the clinic's sites (the chip says "all 11"), or only the member's. */
  allSites: boolean;
  practitioners: { id: string; name: string }[] | null;
  practitionerId: string | null;
  services: { id: string; name: string }[] | null;
  serviceId: string | null;
  /** The member's own caseload only (reports.own). */
  own: boolean;
}

export interface ReportPage {
  view: ReportView;
  filters: ReportFilters;
  canExport: boolean;
  /** The query string reproducing the view (CSV link), without "?". */
  query: string;
}

