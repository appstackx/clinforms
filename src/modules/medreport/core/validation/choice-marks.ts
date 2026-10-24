/**
 * Marked cells and kept options on a referrer's Word form (10/2026: "mark the column" tables and "delete as
 * necessary" lists, core/schemas.ts DocxAnchorSchema mark_cell / delete_options). The forms engine marks a cell, or
 * keeps a printed option, only for an answer that IS one of the printed options – anything else would mark nothing
 * and print the row empty, or leave every option printed. So, blocking (MISSING_PLACEHOLDER, cannot be acknowledged):
 *
 * - a "tick all that apply" row answered as text ("Neck, Back") that names something not printed as an option;
 * - a choice (yes / no, one of several, a tick box) whose answer matches none of the printed options.
 *
 * Unanswered questions are placeholders.ts's. Pure.
 */
import { answerToText, isSectionAnswered, matchOption, namedOptions } from "../forms";
import type { FormField, ReportFlag } from "../types";
import { makeFlag } from "./context";
import type { ValidatorInput } from "./index";

function printedOptions(field: FormField): string[] {
  if (field.anchor.kind !== "docx") return [];
  if (field.options?.length) return field.options;
  if (field.anchor.target === "mark_cell") return (field.anchor.optionCells ?? []).map((c) => c.option);
  return (field.anchor.optionTexts ?? []).map((o) => o.option);
}

export function validateChoiceMarks(input: ValidatorInput): ReportFlag[] {
  const form = input.form;
  if (!form) return [];
  const flags: ReportFlag[] = [];
  for (const field of form.fields) {
    if (field.anchor.kind !== "docx" || (field.anchor.target !== "mark_cell" && field.anchor.target !== "delete_options")) continue;
    const section = input.report.sections.find((s) => s.key === field.id);
    if (!section || !isSectionAnswered(section)) continue;
    const options = printedOptions(field);
    const text = answerToText(section).trim();
    const printed = options.map((o) => `“${o}”`).join(", ");
    if (field.answerType === "short_text" || field.answerType === "long_text") {
      const named = namedOptions(options, text);
      if (!named.unmatched) continue;
      flags.push(
        makeFlag({
          code: "MISSING_PLACEHOLDER",
          severity: "blocking",
          sectionKey: section.key,
          evidence: named.unmatched,
          message: `The answer to “${section.title}” names “${named.unmatched}”, which is not printed on the form, so nothing would be marked. Name only the printed options (${printed}), or “None”.`,
        }),
      );
      continue;
    }
    // A structured choice: its value is checked when the form is filled; one that matches no printed option blocks.
    const value = section.answer && section.answer.kind !== "text" ? section.answer.value : null;
    if (typeof value === "boolean") continue;
    if (typeof value === "string" && (matchOption(options, value) || options.length === 0)) continue;
    if (value === null || value === undefined) continue;
    flags.push(
      makeFlag({
        code: "MISSING_PLACEHOLDER",
        severity: "blocking",
        sectionKey: section.key,
        evidence: String(value),
        message: `The answer to “${section.title}” is not one of the printed options (${printed}), so the form would be left unmarked. Choose one of them.`,
      }),
    );
  }
  return flags;
}
