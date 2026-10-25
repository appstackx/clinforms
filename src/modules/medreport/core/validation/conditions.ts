/**
 * NOT_APPLICABLE_ANSWERED (Blue Heart fix round 2, B1-1, B1-5): a box that does not apply never drops a person's
 * answer silently.
 * - "not applicable": a person's own answer (typed, edited or chosen) sits in a box whose condition does not hold
 *   ("If yes for b, c or d above…" when b, c and d are all “No”). The box prints nothing, so approving it as it is would
 *   issue a form without the approved answer. Blocking; acknowledged with a reason, the answer is printed after all
 *   (core/forms.ts suppressedAsNotApplicable – the forms engine and "Copy answers" share that rule).
 * - "condition does not hold": a drafted Yes/No to a question whose own label carries a condition on the facts
 *   ("a. If the client was … off work at the time of the assessment, is the client at work now?") while its supporting
 *   text says the condition does not hold ("…so he was not off work at the time of the assessment"). Such questions are
 *   no longer drafted (ai/assemble.ts); this catches older drafts. Blocking; the clinician changes the answer or marks
 *   the question not applicable.
 *
 * Owner: ai agent.
 */
import { factCondition, notApplicable } from "../conditions";
import { answeredByPersonIn, NOT_APPLICABLE_ANSWERED } from "../forms";
import type { ReportFlag } from "../types";
import { makeFlag } from "./context";
import type { ValidatorInput } from "./index";

/** Supporting text that says a question's condition does not hold. */
const CONDITION_FAILS = /\b(?:so|therefore|and so)\s+(?:he|she|they|the (?:client|patient|claimant|employee)|m(?:r|rs|s|iss)\.? [a-z'’-]+)\s+(?:was|is|were|are|had|has)\s+not\b|\b(?:does|did) not apply\b|\bnot applicable\b/i;

export function validateConditions(input: ValidatorInput): ReportFlag[] {
  const flags: ReportFlag[] = [];
  for (const section of input.report.sections ?? []) {
    const condition = notApplicable(input.report, section.key);
    if (condition && !section.markedNotApplicable && answeredByPersonIn(input.report, section.key)) {
      flags.push(
        makeFlag({
          code: NOT_APPLICABLE_ANSWERED,
          severity: "blocking",
          sectionKey: section.key,
          evidence: "not applicable",
          message: `This box does not apply because ${condition.because}, so your answer would not be printed. Remove your answer, or change that answer. To print your answer anyway, acknowledge this with a reason.`,
        }),
      );
      continue;
    }
    const facts = section.answer?.kind === "yes_no" ? factCondition(section.title) : null;
    if (!facts || condition || section.answer?.value === null || section.answer?.value === undefined || answeredByPersonIn(input.report, section.key)) continue;
    const says = section.paragraphs.find((p) => p.origin === "ai" && CONDITION_FAILS.test(p.text));
    if (!says) continue;
    flags.push(
      makeFlag({
        code: NOT_APPLICABLE_ANSWERED,
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: says.id,
        evidence: "condition does not hold",
        message: `The condition does not hold – check this answer. The question applies only if ${facts}, and its supporting text says that is not so. Change the answer, or mark the question not applicable.`,
      }),
    );
  }
  return flags;
}
