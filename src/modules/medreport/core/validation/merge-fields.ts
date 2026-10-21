/**
 * Mail-merge fields (10/2026, core/merge-fields.ts) – MISSING_PLACEHOLDER, blocking, cannot be
 * acknowledged:
 * - an answer whose text contains a merge field («Patient_Name», <<Ref>>, MERGEFIELD) – every report;
 * - a referrer's form (`input.form`, passed by validateReport's callers for form reports) whose
 *   recorded merge fields would still be on the completed form: not replaced by an answered question
 *   (unresolvedMergeFields), or in a place that cannot be completed here (page header or footer, a Word
 *   field code, text printed on a PDF page).
 * Forms analysed before 10/2026 carry no record and get only the answer check; the final render's scan
 * (forms/render-form.ts) still refuses to issue such a form with a merge field left on it.
 */
import { findMergeTokens, listMergeTokens, unresolvedMergeFields } from "../merge-fields";
import type { ReportFlag } from "../types";
import { getValidationContext, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

export function validateMergeFields(input: ValidatorInput): ReportFlag[] {
  const flags: ReportFlag[] = [];
  const ctx = getValidationContext(input);
  for (const { paragraph: p, section } of ctx.paragraphs) {
    const tokens = findMergeTokens(p.text ?? "");
    if (tokens.length === 0) continue;
    flags.push(
      makeFlag({
        code: "MISSING_PLACEHOLDER",
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: p.id,
        evidence: `mail-merge field ${tokens[0]}`,
        message: `This answer contains a mail-merge field (${listMergeTokens(tokens)}). Replace it with the real answer before approving.`,
      }),
    );
  }

  const form = input.form;
  if (!form) return flags;
  for (const left of unresolvedMergeFields(form, input.report)) {
    const times = left.count > 1 ? ` (${left.count} times)` : "";
    flags.push(
      makeFlag({
        code: "MISSING_PLACEHOLDER",
        severity: "blocking",
        ...(left.fieldId && { sectionKey: left.fieldId }),
        evidence: `mail-merge field ${left.text} in ${left.where}`,
        message: left.fixed
          ? `This form still contains a mail-merge field: ${left.text} in ${left.where}${times}. It cannot be completed here, so the form cannot be approved with it. Ask the referrer for the form without mail-merge fields (or remove them from the template) and upload it again.`
          : `This form still contains a mail-merge field: ${left.text} in ${left.where}${times}. Answer the question whose box it is – or, in the form's mapping, make a question replace “${left.text}” – before approving.`,
      }),
    );
  }
  return flags;
}
