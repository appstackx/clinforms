/**
 * Months and dates for usage (25/10/2026): a usage period is a calendar month in UK time (Europe/London, so a report
 * drafted at 00:30 BST on 1 November counts in November), written "YYYY-MM". Plus the deploy-order guard for the
 * 0007 tables: an app deployed before migration 0007 reads "no package, no usage" instead of failing its pages.
 */

const UK_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

function ukParts(at: Date): { y: string; m: string; d: string } {
  const parts = UK_PARTS.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** The UK calendar month of `at`: "YYYY-MM". */
export function ukPeriodOf(at: Date): string {
  const { y, m } = ukParts(at);
  return `${y}-${m}`;
}

/** The UK calendar date of `at`: "YYYY-MM-DD". */
export function ukDateOf(at: Date): string {
  const { y, m, d } = ukParts(at);
  return `${y}-${m}-${d}`;
}

export const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD_PATTERN.test(value);
}

/** `period` moved by `months` (negative = earlier). */
export function shiftPeriod(period: string, months: number): string {
  const m = PERIOD_PATTERN.exec(period);
  if (!m) throw new Error(`Not a period: ${period}`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The `n` months ending with `period`, newest first. */
export function recentPeriods(period: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftPeriod(period, -i));
}

const USAGE_TABLES = ["clinic_package", "clinic_usage", "usage_report", "usage_event"] as const;
const TABLE_ALT = USAGE_TABLES.join("|");
const SQLITE_MISSING = new RegExp(`no such table: (?:main\\.)?(?:${TABLE_ALT})\\b`, "i");
const PG_MISSING = new RegExp(`relation "(?:public\\.)?(?:${TABLE_ALT})" does not exist`, "i");
const NAMED = new RegExp(`\\b(?:${TABLE_ALT})\\b`);

/** Whether `err` says one of the 0007 tables does not exist (SQLite / D1 through the gateway, or Postgres 42P01). */
export function isMissingUsageTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.code === "42P01" && NAMED.test(message)) return true;
  if (SQLITE_MISSING.test(message) || PG_MISSING.test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isMissingUsageTable(e.cause) : false;
}

let noted = false;
export function noteMissingUsageTables(): void {
  if (noted) return;
  noted = true;
  console.warn("[usage] tables missing: migration 0007 not applied to this database; packages and usage read as empty and usage is not counted.");
}
