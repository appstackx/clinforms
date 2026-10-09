/**
 * MISSING_PLACEHOLDER (blocking, cannot be acknowledged):
 * - a section of the report with no text yet (not drafted, or a recorded-opinion section left empty
 *   for the clinician to write);
 * - placeholder text left in a paragraph: "[CLAIMANT]", "[MISSING]", "[TBC]", "[Clinician to …]",
 *   "[insert …]", "XX/XX/XXXX", "TODO" and similar.
 *
 * Referrer forms (sections with `fieldId`): a field is answered by its structured value (yes/no, tick
 * box, choice, date, number) or by text (text answer types) – core/forms.ts isSectionAnswered(). A
 * REQUIRED field left unanswered blocks sign-off (evidence "empty section"); an OPTIONAL one is a
 * warning that it will be left blank on the referrer's form (evidence "optional field blank"). Sign-off
 * fields are filled from the approval receipt and are never "empty" here.
 *
 * Owner: ai agent.
 */
import { isSectionAnswered } from "../forms";
import type { ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

/** Placeholder markers that must never reach a signed report. */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\[\s*(?:MISSING|CLAIMANT|EMPLOYEE|PATIENT|NAME|DATE|DOB|TBC|TBA|TBD|TO BE (?:CONFIRMED|COMPLETED|ADDED)|TO CONFIRM|TO COMPLETE|INSERT|ADD|CLINICIAN|PLACEHOLDER|REDACTED|\.\.\.|…)[^\]]*\]/gi,
  /\b[Xx]{1,2}\/[Xx]{1,2}\/(?:[Xx]{2}|[Xx]{4})\b/g,
  /\b(?:TODO|TBC|FIXME)\b/g,
  /\{\{?[^{}\n]{1,40}\}\}?/g,
];

export function validatePlaceholders(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  const specs = new Map(input.template.sections.map((s) => [s.key, s]));
  for (const section of input.report.sections ?? []) {
    if (section.fieldId) {
      // Form reports: sign-off fields are filled from the approval receipt.
      if (section.kind === "declaration" || isSectionAnswered({ paragraphs: section.paragraphs ?? [], answer: section.answer })) continue;
      const required = specs.get(section.key)?.required ?? true;
      if (!required) {
        flags.push(
          makeFlag({
            code: "MISSING_PLACEHOLDER",
            severity: "warning",
            sectionKey: section.key,
            evidence: "optional field blank",
            message: `“${section.title}” is optional on the referrer's form and has no answer, so it will be left blank.`,
          }),
        );
        continue;
      }
      flags.push(
        makeFlag({
          code: "MISSING_PLACEHOLDER",
          severity: "blocking",
          sectionKey: section.key,
          evidence: "empty section",
          message:
            section.status === "pending"
              ? `“${section.title}” has not been answered yet.`
              : `“${section.title}” is required on the referrer's form and has no answer yet. Answer it (or resolve its gap with your own wording) before approving.`,
        }),
      );
      continue;
    }
    if ((section.paragraphs ?? []).some(hasText)) continue;
    flags.push(
      makeFlag({
        code: "MISSING_PLACEHOLDER",
        severity: "blocking",
        sectionKey: section.key,
        evidence: "empty section",
        message:
          section.status === "pending"
            ? `“${section.title}” has not been drafted yet.`
            : `“${section.title}” has no text yet. Write it (or resolve its gap with your own wording) before signing.`,
      }),
    );
  }

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    const seen = new Set<string>();
    // Blank each match out so "[TBC]" is not reported again as "TBC".
    let work = p.text;
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags.indexOf("g") >= 0 ? pattern.flags : `${pattern.flags}g`);
      const found: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(work)) !== null) found.push(m);
      for (const match of found) {
        work = work.slice(0, match.index) + " ".repeat(match[0].length) + work.slice(match.index + match[0].length);
        const evidence = match[0];
        if (seen.has(evidence.toLowerCase())) continue;
        seen.add(evidence.toLowerCase());
        flags.push(
          makeFlag({
            code: "MISSING_PLACEHOLDER",
            severity: "blocking",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence,
            message: `Placeholder "${evidence}" is still in the text. Replace it with the real wording.`,
          }),
        );
      }
    }
  }
  return flags;
}
