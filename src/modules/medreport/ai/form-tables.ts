import "server-only";

/**
 * Tables in a proposed map of a FILLABLE PDF (S2). Whatever proposed the map (live analysis, rules),
 * the fields of a table with repeated rows (forms/pdf-table.ts detectPdfFieldTables – e.g. an insurer's
 * expenses table: provider, treatment, date, amount, paid × 7 rows) become ONE question with answer
 * type "table" and a `pdf_table` anchor, instead of one question per cell. A table whose columns
 * include a date is filled by code from the attended appointments ("appointments_table"); one the
 * analysis left for the referrer (every cell "leave_blank") stays blank.
 *
 * Pure (no I/O). Owner: S2 (pdf-tables-flat).
 */
import { appointmentColumnsFor } from "../core/form-tables";
import type { FormField, FormFieldConfidence, PdfFormOutline } from "../core/types";
import { detectPdfFieldTables, pdfTableAnchorOf, type DetectedPdfTable } from "../forms/pdf-table";

export interface TableQuestion {
  field: Omit<FormField, "id">;
  /** Indexes (into the input list) of the per-cell questions this table replaces. */
  replaces: number[];
  /** Position of the table's first cell in the form's field order. */
  order: number;
  table: DetectedPdfTable;
}

const RANK: Record<FormFieldConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * One table question per detected table, replacing the questions that point at its cells.
 * `fieldOrder` is the outline's field order (form-outline.ts indexPdf().order).
 */
export function pdfTableQuestions(
  pdf: PdfFormOutline,
  fields: ReadonlyArray<Pick<FormField, "anchor" | "fillSource" | "required" | "confidence" | "section">>,
  fieldOrder: ReadonlyMap<string, number>,
): TableQuestion[] {
  const out: TableQuestion[] = [];
  for (const table of detectPdfFieldTables(pdf)) {
    const names = new Set(table.fieldNames);
    const replaces: number[] = [];
    fields.forEach((f, i) => {
      if (f.anchor.kind === "pdf_field" && names.has(f.anchor.fieldName)) replaces.push(i);
    });
    const replaced = replaces.map((i) => fields[i]);
    const columns = appointmentColumnsFor(table.columns);
    const allBlank = replaced.length > 0 && replaced.every((f) => f.fillSource.kind === "leave_blank");
    const fromAppointments = Boolean(columns) && !allBlank;
    const confidence = replaced.reduce<FormFieldConfidence>((c, f) => (RANK[f.confidence] < RANK[c] ? f.confidence : c), "medium");
    const rowsN = table.rows.length;
    const colsN = table.columns.length;
    const recognised = columns ? Object.keys(columns).length : 0;
    const note = fromAppointments
      ? `Table of ${rowsN} rows × ${colsN} columns, filled from the attended appointments (one row per session; ${recognised} of ${colsN} columns recognised). Check the columns.`
      : `Table of ${rowsN} rows × ${colsN} columns.${columns ? "" : " None of its columns is a date of treatment, so it is not filled from the appointments."} Check who completes it.`;
    const order = Math.min(...table.fieldNames.map((n) => fieldOrder.get(n) ?? Number.MAX_SAFE_INTEGER));
    const section = replaced.map((f) => f.section).find((s) => Boolean(s?.trim()));
    out.push({
      field: {
        label: table.label,
        ...(section && { section }),
        guidance: table.guidance || `List each row of the table: ${table.columns.map((c) => c.header).join(", ")}.`,
        answerType: "table",
        anchor: pdfTableAnchorOf(table),
        fillSource: fromAppointments && columns ? { kind: "appointments_table", columns } : { kind: "leave_blank" },
        required: fromAppointments ? replaced.length === 0 || replaced.some((f) => f.required) : false,
        confidence,
        note,
      },
      replaces,
      order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
      table,
    });
  }
  return out;
}
