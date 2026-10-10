/**
 * Table questions on a referrer's form (answer type "table", answer kind "rows"): a printed table with
 * repeated rows, such as an insurer's list of treatment sessions and fees.
 *
 * - The answer is `section.answer = {kind: "rows", value: [{<column key>: <cell text>}, …]}`, one
 *   object per row, top to bottom. Column keys and printed headers come from the field's anchor
 *   (`pdf_table` for fillable PDFs, `pdf_overlay_table` for flat PDFs).
 * - Fill source "appointments_table" is resolved by CODE from the attended appointments (status ATT,
 *   in date order): date (DD/MM/YYYY), clinician, service, clinic, amount ("£55.00", from the
 *   appointment's charge when the clinic system sends one) and paid ("Yes" / "No"). A value the record
 *   does not hold is left blank – never guessed.
 * - Rows beyond the printed table are written on the continuation sheet as a table (forms/pdf-table.ts).
 *
 * Pure: no React, no Node built-ins, no env. Safe in the browser and on the server.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { bundleClinic } from "./clinic";
import { compareIsoDateTime, formatUkDate } from "./dates";
import type {
  Appointment,
  AppointmentColumn,
  ComputedFact,
  EpisodeBundle,
  FormAnchor,
  FormAnswer,
  FormAnswerRow,
  FormField,
  FormTableColumn,
  Gap,
  Paragraph,
  ReportSection,
} from "./types";

/** Plain-English names of what an appointments-table column holds (mapping editor, review). */
export const APPOINTMENT_COLUMN_LABELS: Record<AppointmentColumn, string> = {
  date: "Date of the session",
  clinician: "Clinician",
  service: "Treatment / service",
  clinic: "Clinic name",
  amount: "Fee (£)",
  paid: "Paid (Yes / No)",
};

/** An appointment's charge, as the clinic system sends it (`AppointmentSchema.charge`: pounds, GBP). */
function chargeOf(appointment: Appointment): NonNullable<Appointment["charge"]> | null {
  const c = appointment.charge;
  return c && Number.isFinite(c.amount) ? c : null;
}

/** "£55.00", "£1,250.50". */
export function formatPounds(amount: number): string {
  const [whole, pence] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "-" : ""}£${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${pence}`;
}

const SERVICE_BY_NOTE_TYPE: Record<string, string> = {
  initial_assessment: "Physiotherapy initial assessment",
  follow_up: "Physiotherapy follow-up session",
  discharge: "Physiotherapy session and discharge",
  telephone: "Physiotherapy telephone consultation",
};

/** The table columns of a table anchor (empty for any other anchor). */
export function tableColumnsOf(anchor: FormAnchor): FormTableColumn[] {
  if (anchor.kind === "pdf_table") return anchor.columns;
  if (anchor.kind === "pdf_overlay_table") return anchor.columns.map(({ key, header }) => ({ key, header }));
  return [];
}

/** Rows the printed table holds (0 for any other anchor). */
export function tableCapacity(anchor: FormAnchor): number {
  if (anchor.kind === "pdf_table") return anchor.rows.length;
  if (anchor.kind === "pdf_overlay_table") return anchor.rowTops.length;
  return 0;
}

export function isTableAnchor(anchor: FormAnchor): boolean {
  return anchor.kind === "pdf_table" || anchor.kind === "pdf_overlay_table";
}

/** True when a rows value has at least one non-empty cell. */
export function hasRowContent(value: FormAnswer["value"] | undefined): boolean {
  return Array.isArray(value) && value.some((row) => Object.keys(row).some((k) => (row[k] ?? "").trim() !== ""));
}

/** Rows with every cell trimmed and fully empty rows removed. */
export function cleanRows(rows: readonly FormAnswerRow[]): FormAnswerRow[] {
  const out: FormAnswerRow[] = [];
  for (const row of rows) {
    const next: FormAnswerRow = {};
    let any = false;
    for (const key of Object.keys(row)) {
      const v = (row[key] ?? "").replace(/\s+/g, " ").trim();
      next[key] = v;
      if (v) any = true;
    }
    if (any) out.push(next);
  }
  return out;
}

/**
 * Rows as plain text, one line per row with the cells in column order (" · " between cells), for the
 * review list and text-only views. `columns` gives the order (default: each row's own key order).
 */
export function rowsToText(rows: readonly FormAnswerRow[], columns?: readonly Pick<FormTableColumn, "key">[]): string {
  return rows
    .map((row) => {
      const keys = columns?.length ? columns.map((c) => c.key) : Object.keys(row);
      return keys
        .map((k) => (row[k] ?? "").trim())
        .filter(Boolean)
        .join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * appointments_table: rows from the attended appointments (code only)
 * ----------------------------------------------------------------------------------------------*/

export interface AppointmentsTableValue {
  rows: FormAnswerRow[];
  /** Citable IDs: the notes of the attended sessions, and FACT-attendance when computed. */
  sourceIds: string[];
  /** The attended appointments the rows come from (record IDs, e.g. "A-003"), in row order. */
  appointmentIds: string[];
  /** Columns whose value the record does not hold for at least one row (left blank). */
  missing: AppointmentColumn[];
}

function cellValue(column: AppointmentColumn, appointment: Appointment, bundle: EpisodeBundle): string {
  const note = appointment.noteId ? bundle.notes.find((n) => n.id === appointment.noteId) : undefined;
  switch (column) {
    case "date":
      return formatUkDate(appointment.date);
    case "clinician":
      return appointment.clinician?.name ?? note?.author.name ?? "";
    case "service":
      return (note && SERVICE_BY_NOTE_TYPE[note.type]) || "Physiotherapy session";
    case "clinic":
      return bundleClinic(bundle)?.name ?? "";
    case "amount": {
      const charge = chargeOf(appointment);
      return charge && (!charge.currency || charge.currency === "GBP") ? formatPounds(charge.amount) : "";
    }
    case "paid": {
      const paid = chargeOf(appointment)?.paid;
      return paid === true ? "Yes" : paid === false ? "No" : "";
    }
  }
}

/**
 * One row per attended appointment, in date and time order, with each column's value from the record.
 * Null when the record has no attended appointment.
 */
export function resolveAppointmentsTable(
  columns: Record<string, AppointmentColumn>,
  ctx: { bundle: EpisodeBundle; computedFacts: ComputedFact[] },
): AppointmentsTableValue | null {
  const attended = ctx.bundle.appointments.filter((a) => a.status === "ATT").sort(compareIsoDateTime);
  if (attended.length === 0) return null;
  const keys = Object.keys(columns);
  const missing = new Set<AppointmentColumn>();
  const rows = attended.map((a) => {
    const row: FormAnswerRow = {};
    for (const key of keys) {
      const value = cellValue(columns[key], a, ctx.bundle);
      if (!value) missing.add(columns[key]);
      row[key] = value;
    }
    return row;
  });
  const noteIds = Array.from(new Set(attended.map((a) => a.noteId).filter((id): id is string => Boolean(id))));
  const sourceIds = [...noteIds, ...(ctx.computedFacts.some((f) => f.id === "FACT-attendance") ? ["FACT-attendance"] : [])];
  return { rows, sourceIds, appointmentIds: attended.map((a) => a.id), missing: Array.from(missing) };
}

/**
 * The report section (and gap, if any) for a table question filled from the appointments – the same
 * rules as the registration answers: filled now by code (origin "from_records"), a value the record
 * lacks left blank, a system gap when a required table cannot be completed from the record.
 */
export function buildAppointmentsTableSection(
  field: FormField,
  columns: Record<string, AppointmentColumn>,
  ctx: { bundle: EpisodeBundle; computedFacts: ComputedFact[] },
  base: Pick<ReportSection, "key" | "title" | "kind" | "fieldId">,
): { section: ReportSection; gap: Gap | null } {
  const resolved = resolveAppointmentsTable(columns, ctx);
  if (!resolved) {
    return {
      section: { ...base, status: field.required ? "needs_input" : "complete", paragraphs: [], answer: { kind: "rows", value: null } },
      gap: field.required
        ? {
            id: `gap-${field.id}-record`,
            sectionKey: field.id,
            issue: `The record holds no attended appointment for “${field.label}”, so the table has been left blank.`,
            suggestedQuestion: `Which sessions should be listed for “${field.label}”? Check the appointment history in the clinic system.`,
            relatedNoteIds: [],
            raisedBy: "system",
          }
        : null,
    };
  }
  const n = resolved.rows.length;
  const dates = ctx.bundle.appointments.filter((a) => resolved.appointmentIds.indexOf(a.id) >= 0).map((a) => a.date).sort();
  const span = dates.length > 1 ? `, ${formatUkDate(dates[0])} to ${formatUkDate(dates[dates.length - 1])}` : dates.length === 1 ? `, ${formatUkDate(dates[0])}` : "";
  const blank = resolved.missing.map((c) => APPOINTMENT_COLUMN_LABELS[c].toLowerCase());
  const text =
    `Filled from the appointment record: ${n} attended session${n === 1 ? "" : "s"}${span}.` +
    (blank.length ? ` The record does not hold every ${blank.join(" or ")}, so those cells are left blank.` : "");
  const paragraph: Paragraph = { id: `${field.id}-r1`, text, sourceIds: resolved.sourceIds, origin: "from_records", basis: "record" };
  return { section: { ...base, status: "complete", paragraphs: [paragraph], answer: { kind: "rows", value: resolved.rows } }, gap: null };
}

/* ------------------------------------------------------------------------------------------------
 * Column headers → what an appointments table column holds (analysis, mapping editor)
 * ----------------------------------------------------------------------------------------------*/

/**
 * What a printed column most likely holds, from its header ("Visit date" → date, "Fee
 * charged" → amount, "Fee settled?" → paid, "Clinic or hospital name" → clinic). Null when the
 * header names nothing the appointment record holds.
 */
export function appointmentColumnFromHeader(header: string): AppointmentColumn | null {
  const h = header.toLowerCase();
  if (/\bpaid\b|\bsettled\b|\boutstanding\b/.test(h)) return "paid";
  if (/\bdates?\b|\bwhen\b/.test(h)) return "date";
  if (/\bamount\b|\bfees?\b|\bcosts?\b|\bcharges?\b|\bprice\b|£|\btotal\b|\binvoice value\b/.test(h)) return "amount";
  if (/\b(?:therapist|clinician|practitioner|physiotherapist|treated by|seen by)\b/.test(h) && !/\b(?:hospital|clinic|provider|practice|centre|center)\b/.test(h)) return "clinician";
  if (/\b(?:provider|hospital|clinic|practice|centre|center|facility)\b/.test(h)) return "clinic";
  if (/\b(?:treatment|service|procedure|consultation|description|type of|session)\b/.test(h)) return "service";
  return null;
}

/** An appointments-table column map for these columns (recognised headers only; null if no date column). */
export function appointmentColumnsFor(columns: readonly FormTableColumn[]): Record<string, AppointmentColumn> | null {
  const out: Record<string, AppointmentColumn> = {};
  for (const c of columns) {
    const what = appointmentColumnFromHeader(c.header);
    if (what) out[c.key] = what;
  }
  return Object.keys(out).some((k) => out[k] === "date") ? out : null;
}
