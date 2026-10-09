/**
 * FIGURE_NOT_IN_SOURCE: every date and number in origin "ai" / "edited" text must appear in the
 * sources the paragraph cites (note text with its date and author, REG, or a cited FACT's value and
 * detail).
 *
 * - Dates block: DD/MM/YYYY, "12 March 2026", "March 2027", "15 April", bare years, and durations in
 *   days/weeks/months/years ("within 6 weeks", "6–7 wks", "6/52"). A duration matches only the same
 *   number and unit, so a recalculated "16 weeks" is caught even when "111 days" is cited.
 * - Other numbers warn: scores, measurements, counts (digits or words one to ninety, "twice"),
 *   and spinal levels (C3, L4/5).
 *
 * Record IDs, reference codes and clock times are ignored. One flag per distinct figure per paragraph.
 *
 * Owner: ai agent.
 */
import type { ReportFlag } from "../types";
import { CHECKED_ORIGINS, getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";
import { extractFigures, figureInIndex, isDateLikeFigure, type Figure } from "./text";

function describe(f: Figure): string {
  switch (f.kind) {
    case "date":
    case "month_year":
    case "day_month":
    case "year":
      return "date";
    case "duration":
      return "time period";
    case "level":
      return "spinal level";
    default:
      return "number";
  }
}

export function validateFigures(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p) || CHECKED_ORIGINS.indexOf(p.origin) < 0) continue;
    const cited = ctx.cited(p);
    // Without any valid citation UNCITED_PARAGRAPH already blocks; listing every figure adds noise.
    if (cited.validIds.length === 0) continue;

    const seen = new Set<string>();
    for (const figure of extractFigures(p.text)) {
      if (figureInIndex(figure, cited.figures)) continue;
      const dedupe = `${figure.kind}:${figure.key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const blocking = isDateLikeFigure(figure.kind);
      const what = describe(figure);
      flags.push(
        makeFlag({
          code: "FIGURE_NOT_IN_SOURCE",
          severity: blocking ? "blocking" : "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: figure.raw,
          message: `The ${what} "${figure.raw}" does not appear in the cited source${cited.validIds.length === 1 ? "" : "s"} (${cited.validIds.join(", ")}). Check it against the record and cite the source that states it${blocking ? "" : ", or correct it"}.`,
        }),
      );
    }
  }
  return flags;
}
