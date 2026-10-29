/**
 * CSV for downloads (debtors, statements, the e-billing export). Pure.
 *
 * RFC 4180 quoting, CRLF line ends, and spreadsheet formula injection blocked: a TEXT cell starting with
 * = + - @ or a tab/carriage return gets a leading apostrophe (numbers are written as plain numbers).
 */
import { safeCsvText } from "../core/csv-safe";

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return safeCsvText(String(value));
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Pence → "12.50" (a plain decimal for spreadsheets; negative stays a number). */
export function penceDecimal(pence: number): number {
  return Math.round(pence) / 100;
}
