/**
 * Table answers on the review screen (S2): pure edits behind the table editor. Staff can correct a
 * cell, add a row or remove one; every change is recorded in the activity log ("answer_set", detail
 * starting "<key>:"), so the question shows as changed by the clinician.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { nowIso } from "../../../core/dates";
import { cleanRows, tableColumnsOf } from "../../../core/form-tables";
import { isSectionAnswered } from "../../../core/forms";
import { appendActivity } from "../../../core/report-factory";
import type { FormAnswerRow, FormField, FormTableColumn, Report } from "../../../core/types";

/** The printed columns of a table question (from its anchor); falls back to the keys used in the rows. */
export function tableColumnsForReview(field: Pick<FormField, "anchor"> | null | undefined, rows: readonly FormAnswerRow[]): FormTableColumn[] {
  const printed = field ? tableColumnsOf(field.anchor) : [];
  if (printed.length) return printed;
  const keys: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (keys.indexOf(k) < 0) keys.push(k);
  return keys.map((key) => ({ key, header: key }));
}

/** The rows of a table answer (empty when unanswered). */
export function rowsOf(value: unknown): FormAnswerRow[] {
  return Array.isArray(value) ? (value as FormAnswerRow[]) : [];
}

function sameRows(a: readonly FormAnswerRow[], b: readonly FormAnswerRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Replace a table answer's rows (trimmed, empty rows dropped). Unchanged rows return the same report.
 * A signed report is never changed here (the review reducer already blocks edits).
 */
export function setRowsAnswer(report: Report, key: string, rows: readonly FormAnswerRow[], actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section || section.answer?.kind !== "rows" || report.status === "signed") return report;
  const before = rowsOf(section.answer.value);
  const next = cleanRows(rows);
  if (sameRows(before, next)) return report;
  const sections = report.sections.map((s) => {
    if (s.key !== key) return s;
    const updated = { ...s, answer: { kind: "rows" as const, value: next.length ? next : null } };
    return { ...updated, status: isSectionAnswered(updated) ? ("complete" as const) : ("needs_input" as const) };
  });
  return appendActivity(
    { ...report, sections, updatedAt: nowIso(now) },
    {
      actor,
      action: "answer_set",
      detail: `${key}: table “${section.title}” changed (${next.length} row${next.length === 1 ? "" : "s"}, was ${before.length}).`,
    },
    now,
  );
}
