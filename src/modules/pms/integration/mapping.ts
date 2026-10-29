/**
 * The column-mapping step: which column of the file holds which field. Pure.
 *
 * suggestMapping() proposes exact matches only (a header equal to the field's label or one of its common names,
 * after matchKey) – it never guesses from part of a word, so a wrong suggestion is rare and staff still confirm
 * every match. validateMapping() says what is missing before the rows are checked.
 */
import { IMPORT_KIND_INFO, templateHeader, type ImportField, type ImportKind } from "./import-kinds";
import { matchKey } from "./values";

/** Field key → column index (0-based), or null for "not in this file". */
export type ImportMapping = Record<string, number | null>;

export interface MappingProblem {
  field: string | null;
  message: string;
}

function keysFor(field: ImportField): string[] {
  return [matchKey(templateHeader(field)), matchKey(field.label), ...field.synonyms.map(matchKey)].filter(Boolean);
}

/** Header variants tried in order: as it is, then without a leading "patient"/"client" (e.g. "Patient Surname"). */
/** Short forms common in exports' column names, written out ("Addr1" → "address 1", "PCode" → "postcode"). */
const ABBREVIATIONS: Readonly<Record<string, string>> = { addr: "address", add: "address", pcode: "postcode", pc: "postcode", tel: "telephone", mob: "mobile", fname: "first name", sname: "surname", lname: "last name", ref: "ref", no: "no" };

function headerVariants(header: string): string[] {
  // CamelCase and letter–digit boundaries become spaces ("PatientFirstName" → "Patient First Name", "Addr1" → "Addr 1").
  const spaced = header.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  const k = matchKey(spaced)
    .split(" ")
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(" ");
  const out = [k];
  const stripped = k.replace(/^(patient|client|pt|patients)\s+/, "");
  if (stripped !== k && stripped) out.push(stripped);
  return out;
}

export function suggestMapping(kind: ImportKind, headers: readonly string[]): ImportMapping {
  const fields = IMPORT_KIND_INFO[kind].fields;
  const mapping: ImportMapping = {};
  for (const f of fields) mapping[f.key] = null;
  const used = new Set<number>();
  // Pass 1: exact header = label/synonym. Pass 2: with "patient"/"client" taken off the header.
  for (const pass of [0, 1]) {
    for (const f of fields) {
      if (mapping[f.key] !== null) continue;
      const wanted = keysFor(f);
      // Earlier names in the list win (the label first, then the most specific synonyms).
      let best: { col: number; rank: number } | null = null;
      headers.forEach((h, col) => {
        if (used.has(col)) return;
        const variant = headerVariants(h)[pass];
        if (!variant) return;
        const rank = wanted.indexOf(variant);
        if (rank >= 0 && (!best || rank < best.rank)) best = { col, rank };
      });
      const found = best as { col: number; rank: number } | null;
      if (found) {
        mapping[f.key] = found.col;
        used.add(found.col);
      }
    }
  }
  return mapping;
}

/** A mapping from a form or the database: only known fields, only whole column numbers in range. */
export function cleanMapping(kind: ImportKind, raw: unknown, columnCount: number): ImportMapping {
  const out: ImportMapping = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const f of IMPORT_KIND_INFO[kind].fields) {
    const v = source[f.key];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
    out[f.key] = n !== null && Number.isInteger(n) && n >= 0 && n < columnCount ? n : null;
  }
  return out;
}

/** What stops the rows from being checked with this mapping (empty = fine). */
export function validateMapping(kind: ImportKind, mapping: ImportMapping): MappingProblem[] {
  const info = IMPORT_KIND_INFO[kind];
  const problems: MappingProblem[] = [];
  const mapped = (key: string) => mapping[key] !== null && mapping[key] !== undefined;
  for (const f of info.fields) {
    if (f.required && !mapped(f.key)) problems.push({ field: f.key, message: `Choose the column that holds “${f.label}”.` });
  }
  if (kind === "patients") {
    const hasFull = mapped("fullName");
    const hasFirst = mapped("firstName");
    const hasLast = mapped("lastName");
    if (!hasFull && !(hasFirst && hasLast)) {
      problems.push({ field: hasFirst ? "lastName" : "firstName", message: "Choose the columns with the first and last name (or one column with the full name)." });
    }
  }
  const byColumn = new Map<number, string[]>();
  for (const f of info.fields) {
    const col = mapping[f.key];
    if (col === null || col === undefined) continue;
    byColumn.set(col, [...(byColumn.get(col) ?? []), f.label]);
  }
  byColumn.forEach((labels, col) => {
    if (labels.length > 1) problems.push({ field: null, message: `Column ${col + 1} is chosen for more than one field (${labels.join(", ")}). Choose it once.` });
  });
  return problems;
}

/** How many fields the mapping uses (for the summary line). */
export function mappedCount(mapping: ImportMapping): number {
  return Object.values(mapping).filter((v) => v !== null && v !== undefined).length;
}
