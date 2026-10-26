/**
 * DRAFT_FIT part "later note" (B0-6): on an initial assessment form, a paragraph citing a note dated after that
 * assessment – the time point of what a drafted answer reports (WD's time-point checks land here).
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split): the same check, moved; draft-fit.ts runs the parts.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { formatUkDate } from "../../dates";
import { reportKindOf } from "../../forms";
import { initialAssessmentView } from "../../scope";
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

export function laterNotePart(input: ValidatorInput): DraftFitPart {
  const ia = input.report.form && reportKindOf(input.report.form.title) === "initial" ? initialAssessmentView(input.bundle) : null;
  const noteDate = new Map(input.bundle.notes.map((n) => [n.id, n.date]));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      if (ia) {
        const later = p.sourceIds.map((id) => noteDate.get(id)).filter((d): d is string => Boolean(d) && (d as string) > ia.date).sort();
        if (later.length > 0) {
          flags.push(
            makeFlag({
              code: "DRAFT_FIT",
              severity: "warning",
              sectionKey: section.key,
              paragraphId: p.id,
              evidence: `later note ${later[later.length - 1]}`,
              message: `From a later note of ${formatUkDate(later[later.length - 1])} – check it belongs on an initial assessment (${formatUkDate(ia.date)}).`,
            }),
          );
        }
      }
      return flags;
    },
  };
}
