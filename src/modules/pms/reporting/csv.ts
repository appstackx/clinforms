/**
 * CSV for the report downloads (pure). RFC 4180 quoting, CRLF line ends, UTF-8 with a byte-order mark so
 * spreadsheet programs read accents correctly. Text cells that a spreadsheet would run as a formula (starting
 * with =, +, -, @, tab or carriage return) get a leading apostrophe; numbers are written as numbers.
 */

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_BOM = "﻿";

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** Pence as pounds with two decimals for a spreadsheet (12345 → 123.45). */
export function penceToPounds(pence: number | null | undefined): number | null {
  if (typeof pence !== "number" || !Number.isFinite(pence)) return null;
  return Math.round(pence) / 100;
}

/** A share as a percentage with one decimal (0.0625 → 6.3), null when unknown. */
export function rateToPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 10;
}

/** "utilisation-riverside-demo-2026-10-01-to-2026-10-31.csv" (ids and dates only). */
export function reportFileName(report: string, tenantId: string, from: string, to: string): string {
  const safe = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${safe(report)}-${safe(tenantId)}-${from}-to-${to}.csv`;
}
