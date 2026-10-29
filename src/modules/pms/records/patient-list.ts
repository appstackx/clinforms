/**
 * The patient list's filters and its CSV export (pure, browser-safe): what the URL carries, how it is read back
 * (anything unknown is dropped – never trusted), and the CSV cell rule that stops a spreadsheet from running a
 * cell as a formula (K2-NFR-005).
 */
import { PATIENT_STATUSES, PAYER_TYPES } from "../core/schemas";
import type { PatientStatus, PayerType } from "../core/types";

export const PATIENT_PAGE_SIZE = 25;
/** Most rows one CSV export holds. */
export const MAX_EXPORT_ROWS = 5000;

export interface PatientListFilters {
  q: string;
  status: PatientStatus | "any";
  /** Lead practitioner of an open case. */
  practitionerId: string | null;
  /** Payer type of an open case. */
  payer: PayerType | null;
  /** No booked or arrived appointment from now on. */
  noFuture: boolean;
  /** Last seen today (phone chip "Seen today"). */
  seenToday: boolean;
  /** Owes money on issued invoices addressed to them (billing; members with billing.view). */
  owesMoney: boolean;
  /** Has a case or an appointment at this site (only a site within the member's own scope is honoured). */
  siteId: string | null;
  sort: "asc" | "desc";
  page: number;
}

export const DEFAULT_PATIENT_FILTERS: PatientListFilters = { q: "", status: "active", practitionerId: null, payer: null, noFuture: false, seenToday: false, owesMoney: false, siteId: null, sort: "asc", page: 1 };

const ID = /^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** The filters of a URL's search parameters (unknown values fall back to the defaults). */
export function filtersFromParams(params: Params): PatientListFilters {
  const status = get(params, "status");
  const payer = get(params, "payer");
  const prac = get(params, "practitioner");
  const site = get(params, "site");
  const page = Number(get(params, "page") ?? 1);
  return {
    q: (get(params, "q") ?? "").trim().slice(0, 120),
    status: status === "any" || (PATIENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as PatientStatus | "any") : "active",
    practitionerId: prac && ID.test(prac) ? prac : null,
    payer: payer && (PAYER_TYPES as readonly string[]).includes(payer) ? (payer as PayerType) : null,
    noFuture: get(params, "nofuture") === "1",
    seenToday: get(params, "seen") === "today",
    owesMoney: get(params, "owes") === "1",
    siteId: site && ID.test(site) ? site : null,
    sort: get(params, "sort") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 && page < 100_000 ? page : 1,
  };
}

/** The search parameters for filters (defaults left out, so URLs stay short). */
export function paramsFromFilters(f: Partial<PatientListFilters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status && f.status !== "active") p.set("status", f.status);
  if (f.practitionerId) p.set("practitioner", f.practitionerId);
  if (f.payer) p.set("payer", f.payer);
  if (f.noFuture) p.set("nofuture", "1");
  if (f.seenToday) p.set("seen", "today");
  if (f.owesMoney) p.set("owes", "1");
  if (f.siteId) p.set("site", f.siteId);
  if (f.sort === "desc") p.set("sort", "desc");
  if (f.page && f.page > 1) p.set("page", String(f.page));
  return p;
}

/** True when any filter narrows the list beyond the default "active patients". */
export function hasNarrowingFilters(f: PatientListFilters): boolean {
  return Boolean(f.q || f.practitionerId || f.payer || f.noFuture || f.seenToday || f.owesMoney || f.siteId || f.status !== "active");
}

/** One CSV cell: quoted when needed; a leading = + - @ tab or carriage return is defused with an apostrophe. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}
