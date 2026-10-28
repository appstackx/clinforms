/**
 * Referrer forms – fields → sections: which fields get a report section, the section kind for a fill source, and how
 * a question's answer is stored on its section.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * Shared by core/forms.ts and core/forms/answers.ts (so neither imports the other). Owner: integrator (shared) –
 * docs/bh2-ownership.json.
 */
import type { AnswerType, FillSource, FormAnswerKind, FormDefinition, FormField, SectionKind } from "../types";

/* ------------------------------------------------------------------------------------------------
 * Fields → sections
 * ----------------------------------------------------------------------------------------------*/

/** Report section kind for a fill source; null for leave_blank (no section). */
export function sectionKindForFillSource(source: FillSource): SectionKind | null {
  switch (source.kind) {
    case "registration":
    case "computed_fact":
    case "fixed":
    case "appointments_table":
      return "from_records";
    case "notes_narrative":
      return "ai_narrative";
    case "clinician_opinion":
      return "clinician_opinion";
    case "signoff":
      return "declaration";
    case "leave_blank":
      return null;
  }
}

/** A field gets a report section unless its fill source is leave_blank. */
export function isAnswerableField(field: FormField): boolean {
  return field.fillSource.kind !== "leave_blank";
}

/** The answerable fields, in form order. */
export function answerableFields(form: Pick<FormDefinition, "fields">): FormField[] {
  return form.fields.filter(isAnswerableField);
}

/** How the answer to a question of this type is stored on the report section. */
export function answerKindFor(answerType: AnswerType): FormAnswerKind {
  switch (answerType) {
    case "yes_no":
      return "yes_no";
    case "checkbox":
      return "checkbox";
    case "single_choice":
      return "choice";
    case "date":
    case "date_signed":
      return "date";
    case "number":
      return "number";
    case "table":
      return "rows";
    default:
      return "text";
  }
}
