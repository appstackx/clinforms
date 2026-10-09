/**
 * Structured answers on a referrer's form (Revision 2): a drafted DATE or NUMBER answer (e.g. "Date
 * symptoms began: 12/03/2026", "Number of headaches per week: 3") is printed on the form without its
 * supporting paragraph, so the value itself must appear in the sources that paragraph cites.
 *
 * - FIGURE_NOT_IN_SOURCE: dates block (acknowledgeable with a reason, like any date); numbers warn.
 * - Checked only when the field's answer is backed by drafted text (paragraphs with origin "ai" or
 *   "edited"); a value the clinician entered with no drafted support, or a value filled by code from
 *   registration / computed facts ("from_records"), is not checked here.
 *
 * Yes/no, tick box and choice answers are checked through their supporting paragraphs by the other
 * validators (citations, opinion language, scope); a missing required answer is MISSING_PLACEHOLDER
 * (placeholders.ts).
 *
 * Owner: ai agent.
 */
import { formatUkDate, isValidIsoDate } from "../dates";
import type { ReportFlag } from "../types";
import { CHECKED_ORIGINS, getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";
import { emptyFigureIndex, extractFigures, figureInIndex, type FigureIndex } from "./text";

export function validateFormAnswers(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  for (const section of input.report.sections ?? []) {
    const answer = section.answer;
    if (!section.fieldId || !answer || (answer.kind !== "date" && answer.kind !== "number")) continue;
    if (answer.value === null || answer.value === "" || typeof answer.value !== "string") continue;

    const support = (section.paragraphs ?? []).filter((p) => hasText(p) && CHECKED_ORIGINS.indexOf(p.origin) >= 0);
    if (support.length === 0) continue;

    const cited: FigureIndex = emptyFigureIndex();
    const citedIds: string[] = [];
    for (const p of support) {
      const c = ctx.cited(p);
      c.validIds.forEach((id) => {
        if (citedIds.indexOf(id) < 0) citedIds.push(id);
      });
      (Object.keys(cited) as Array<keyof FigureIndex>).forEach((k) => {
        c.figures[k].forEach((v) => cited[k].add(v));
      });
    }
    // No valid citation at all: UNCITED_PARAGRAPH already blocks the supporting text.
    if (citedIds.length === 0) continue;

    const isDate = answer.kind === "date";
    const shown = isDate && isValidIsoDate(answer.value) ? formatUkDate(answer.value) : answer.value;
    const figure = extractFigures(shown).find((f) => (isDate ? f.kind === "date" : f.kind === "number"));
    if (!figure || figureInIndex(figure, cited)) continue;

    flags.push(
      makeFlag({
        code: "FIGURE_NOT_IN_SOURCE",
        severity: isDate ? "blocking" : "warning",
        sectionKey: section.key,
        evidence: `answer ${shown}`,
        message: `The ${isDate ? "date" : "number"} given as the answer to “${section.title}” (${shown}) does not appear in the cited source${citedIds.length === 1 ? "" : "s"} (${citedIds.join(", ")}). Check it against the record${isDate ? ", or acknowledge it with a reason" : " and correct it"}.`,
      }),
    );
  }
  return flags;
}
