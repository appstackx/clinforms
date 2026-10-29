/**
 * CSV for data import (RFC 4180 plus what exports from clinic software do in practice). Pure and browser-safe: the
 * import page reads the file in the browser with the same code the server uses to check what it receives.
 *
 * - Delimiter: comma, semicolon or tab, detected from the header line (outside quotes); or given.
 * - Quotes: "…" fields may hold delimiters, line breaks and doubled quotes ("").
 * - Line breaks: CRLF, LF or CR. A byte-order mark at the start is ignored. Blank lines are skipped.
 * - Limits (a file that breaks one is refused with a plain message – never a partial read): rows, columns, the
 *   length of one field. Rows shorter than the header are padded with ""; longer rows are an error (the columns
 *   would not line up).
 */
import { safeCsvText } from "../core/csv-safe";

export type CsvDelimiter = "," | ";" | "\t";

export interface CsvLimits {
  /** Data rows (the header not counted). */
  maxRows: number;
  maxColumns: number;
  /** Characters in one field. */
  maxFieldLength: number;
}

export const CSV_LIMITS: CsvLimits = { maxRows: 100_000, maxColumns: 200, maxFieldLength: 10_000 };

export interface CsvTable {
  delimiter: CsvDelimiter;
  headers: string[];
  /** Data rows, each exactly headers.length long. */
  rows: string[][];
}

export type CsvErrorCode = "EMPTY" | "NO_HEADER" | "DUPLICATE_HEADER" | "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "FIELD_TOO_LONG" | "UNCLOSED_QUOTE" | "ROW_TOO_LONG";

export class CsvError extends Error {
  readonly code: CsvErrorCode;
  /** 1-based line of the file where the problem is (when known). */
  readonly line?: number;
  constructor(code: CsvErrorCode, message: string, line?: number) {
    super(message);
    this.name = "CsvError";
    this.code = code;
    this.line = line;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The delimiter used by the first line (outside quotes): the most frequent of , ; and tab (comma on a tie). */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch] += 1;
  }
  let best: CsvDelimiter = ",";
  for (const d of [";", "\t"] as CsvDelimiter[]) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * Splits CSV text into records (arrays of fields). Throws CsvError. `onRecord` receives each record with the
 * 1-based line number it started on; return false to stop early.
 */
function scan(text: string, delimiter: CsvDelimiter, limits: CsvLimits, onRecord: (fields: string[], line: number) => boolean | void): void {
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;
  const pushField = () => {
    if (field.length > limits.maxFieldLength) throw new CsvError("FIELD_TOO_LONG", `A value on line ${recordLine} is longer than ${limits.maxFieldLength.toLocaleString("en-GB")} characters.`, recordLine);
    fields.push(field);
    if (fields.length > limits.maxColumns) throw new CsvError("TOO_MANY_COLUMNS", `Line ${recordLine} has more than ${limits.maxColumns} columns.`, recordLine);
    field = "";
    fieldStarted = false;
  };
  const endRecord = (): boolean => {
    pushField();
    const blank = fields.length === 1 && fields[0] === "";
    const record = fields;
    fields = [];
    if (blank) return true;
    return onRecord(record, recordLine) !== false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        field += ch;
        if (field.length > limits.maxFieldLength) throw new CsvError("FIELD_TOO_LONG", `A value on line ${recordLine} is longer than ${limits.maxFieldLength.toLocaleString("en-GB")} characters.`, recordLine);
      }
      continue;
    }
    if (ch === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (!endRecord()) return;
      line++;
      recordLine = line;
      continue;
    }
    // Text after a closing quote ("abc"def) is kept as it is – exports do this and the value is still readable.
    field += ch;
    fieldStarted = true;
  }
  if (quoted) throw new CsvError("UNCLOSED_QUOTE", `A quoted value that starts on line ${recordLine} is never closed.`, recordLine);
  if (field !== "" || fields.length > 0) endRecord();
}

/** Header cell → trimmed text ("" stays ""; the mapping step shows "Column N" for it). */
function cleanHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim();
}

/** Reads a whole CSV file (header + rows). Throws CsvError. */
export function parseCsv(input: string, options: { delimiter?: CsvDelimiter; limits?: Partial<CsvLimits> } = {}): CsvTable {
  const limits: CsvLimits = { ...CSV_LIMITS, ...(options.limits ?? {}) };
  const text = stripBom(input);
  if (text.trim() === "") throw new CsvError("EMPTY", "The file is empty.");
  const delimiter = options.delimiter ?? detectDelimiter(text);
  let headers: string[] | null = null;
  const rows: string[][] = [];
  scan(text, delimiter, limits, (fields, line) => {
    if (!headers) {
      headers = fields.map(cleanHeader);
      if (headers.every((h) => h === "")) throw new CsvError("NO_HEADER", "The first line has no column names.", line);
      const seen = new Map<string, number>();
      headers.forEach((h, i) => {
        if (!h) return;
        const key = h.toLowerCase();
        if (seen.has(key)) throw new CsvError("DUPLICATE_HEADER", `Two columns are both called "${h}" (columns ${(seen.get(key) ?? 0) + 1} and ${i + 1}).`, line);
        seen.set(key, i);
      });
      return;
    }
    if (fields.length > headers.length) {
      // Trailing empty cells beyond the header are harmless (spreadsheets add them).
      const extra = fields.slice(headers.length);
      if (extra.some((f) => f.trim() !== "")) throw new CsvError("ROW_TOO_LONG", `Line ${line} has ${fields.length} values but the header has ${headers.length} columns.`, line);
      fields = fields.slice(0, headers.length);
    }
    while (fields.length < headers.length) fields.push("");
    rows.push(fields);
    if (rows.length > limits.maxRows) throw new CsvError("TOO_MANY_ROWS", `The file has more than ${limits.maxRows.toLocaleString("en-GB")} rows. Split it into smaller files.`, line);
  });
  if (!headers) throw new CsvError("NO_HEADER", "The first line has no column names.");
  return { delimiter, headers, rows };
}

/** One CSV field, quoted when it needs to be; formula-looking values are prefixed with ' (spreadsheet safety). */
export function csvField(value: string | number | null | undefined, delimiter: CsvDelimiter = ","): string {
  if (value === null || value === undefined) return "";
  return safeCsvText(String(value), { delimiter, keepNumbers: true });
}

/** Rows → CSV text with CRLF line ends. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[], delimiter: CsvDelimiter = ","): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
