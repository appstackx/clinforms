/**
 * Packages and how usage counts (25/10/2026) – browser-safe and pure, shared by the platform page (presets in the
 * "Packages" form), the clinic's "Plan & usage" page, the platform usage page and the admin script.
 *
 * The price list (memory/context/pricing.md §0 and the 23/10 packages), all ex VAT:
 *   Starter £99 a month, 25 reports · Practice £199, 100 · Group £349, 250 · Group Plus £549, 500
 *   extra reports £1.50 each (Group £1.25) · Custom = per deal (e.g. £300 for 500) · set-up £250 (one-off)
 *   founding prices are fixed for 12 months.
 *
 * What counts (Khuram, 25/10/2026 – drafting costs money whether or not the report is completed): a report counts
 * towards the allowance ONCE, when its answers are first drafted from the notes, or – when nothing needed drafting –
 * when it is first approved. Drafting the same report again, regenerating answers or approving it again never counts
 * again; an amended version of an approved report is the same report. The public demo never counts.
 */

export const PACKAGE_IDS = ["starter", "practice", "group", "group_plus", "custom", "trial"] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === "string" && (PACKAGE_IDS as readonly string[]).indexOf(value) >= 0;
}

export interface PackagePreset {
  id: PackageId;
  label: string;
  /** null = set per deal (custom). */
  monthlyPricePence: number | null;
  reportsIncluded: number | null;
  extraReportPence: number | null;
}

/** The price list as presets for the platform form (custom: everything per deal). */
export const PACKAGE_PRESETS: Readonly<Record<PackageId, PackagePreset>> = {
  starter: { id: "starter", label: "Starter", monthlyPricePence: 9_900, reportsIncluded: 25, extraReportPence: 150 },
  practice: { id: "practice", label: "Practice", monthlyPricePence: 19_900, reportsIncluded: 100, extraReportPence: 150 },
  group: { id: "group", label: "Group", monthlyPricePence: 34_900, reportsIncluded: 250, extraReportPence: 125 },
  group_plus: { id: "group_plus", label: "Group Plus", monthlyPricePence: 54_900, reportsIncluded: 500, extraReportPence: 150 },
  custom: { id: "custom", label: "Custom", monthlyPricePence: null, reportsIncluded: null, extraReportPence: null },
  trial: { id: "trial", label: "Trial", monthlyPricePence: 0, reportsIncluded: 25, extraReportPence: 0 },
};

/** One-off set-up fee of the price list. */
export const SETUP_FEE_PENCE = 25_000;
/** Founding prices are fixed for this many months from the package's start. */
export const FOUNDING_MONTHS = 12;

export const SETUP_FEE_STATUSES = ["due", "paid", "waived"] as const;
export type SetupFeeStatus = (typeof SETUP_FEE_STATUSES)[number];

export function packageLabel(id: string | null | undefined): string {
  return id && isPackageId(id) ? PACKAGE_PRESETS[id].label : "No package";
}

export const SETUP_FEE_LABELS: Readonly<Record<SetupFeeStatus, string>> = { due: "due", paid: "paid", waived: "waived" };

/** £ from pence, UK style: "£199", "£1.50", "£1,234.56" (whole pounds without pence). */
export function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  const text = `£${pounds.toLocaleString("en-GB")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
  return negative ? `−${text}` : text;
}

/** £ with pence always shown ("£7.50", "£0.00"): for amounts that are sums. */
export function formatPenceExact(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const text = `£${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `−${text}` : text;
}

/**
 * Pounds as typed ("199", "1.5", "£1,234.00") → pence; null for an empty value; NaN for anything else (negative,
 * more than two decimals, not a number).
 */
export function parsePounds(text: string | null | undefined): number | null {
  const raw = String(text ?? "")
    .trim()
    .replace(/^£/, "")
    .replace(/,/g, "");
  if (raw === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return Number.NaN;
  const [whole, frac = ""] = raw.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "1 report", "25 reports" (UK thousands separators). */
export function reportsText(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "report" : "reports"}`;
}

/** "3 of 25 reports", "0 of 1 report" (the allowance decides the noun). */
export function ofAllowanceText(counted: number, included: number): string {
  return `${counted.toLocaleString("en-GB")} of ${reportsText(included)}`;
}

/** "2026-10" → "October 2026". */
export function periodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-10-31" → "31 October 2026". */
export function ukDateLabel(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!m) return String(date ?? "");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The package as one month sees it: the founding price while it applies (founding_until on or after the month's first day). */
export function effectiveMonthlyPence(
  pkg: { monthlyPricePence: number; foundingPricePence: number | null; foundingUntil: string | null },
  period: string,
): number {
  if (pkg.foundingPricePence !== null && pkg.foundingUntil && pkg.foundingUntil >= `${period}-01`) return pkg.foundingPricePence;
  return pkg.monthlyPricePence;
}

/** Reports over the allowance (never negative). */
export function extraReports(billable: number, included: number | null | undefined): number {
  if (included === null || included === undefined) return 0;
  return Math.max(0, billable - included);
}

/** Customer-facing wording of the clinic's "Plan & usage" page (neutral: no technology or vendor names). */
export const PLAN_COPY = {
  rule: "A report counts when its answers are first drafted, or when it is approved if nothing needed drafting.",
  again: "Drafting a report again or approving it again does not count again, and nor does an amended version of an approved report.",
  chargingLater: "Charging for extra reports starts once billing is set up.",
  exVat: "Prices exclude VAT.",
  noPackage: "Your clinic's package has not been set up yet. ClinForms will confirm it with you – until then, nothing is charged.",
  shortLine: (count: number, included: number | null) =>
    included === null ? `This month: ${reportsText(count)}.` : `This month: ${ofAllowanceText(count, included)}.`,
  wouldBeCharged: (extra: number, each: string, total: string) => `${extra} extra ${extra === 1 ? "report" : "reports"} × ${each} = ${total} would be charged.`,
  managersOnly: "Your clinic's owner and administrators can see the package and the full usage.",
  inProgress: "Counted but not approved yet",
} as const;
