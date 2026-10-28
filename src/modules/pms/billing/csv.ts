/**
 * CSV for downloads (debtors, statements, the e-billing export). Pure.
 *
 * RFC 4180 quoting, CRLF line ends, and spreadsheet formula injection blocked: a TEXT cell starting with
 * = + - @ or a tab/carriage return gets a leading apostrophe (numbers are written as plain numbers).
 */

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Pence → "12.50" (a plain decimal for spreadsheets; negative stays a number). */
export function penceDecimal(pence: number): number {
  return Math.round(pence) / 100;
}
