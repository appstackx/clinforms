/**
 * OPEN_GAP: one blocking flag per gap without a resolution (gapId set). A gap is closed by resolving
 * or acknowledging the gap itself (Gap.resolution), never by acknowledging the flag.
 *
 * Owner: ai agent.
 */
import type { ReportFlag } from "../types";
import { makeFlag } from "./context";
import type { ValidatorInput } from "./index";

export function validateGaps(input: ValidatorInput): ReportFlag[] {
  const titles = new Map((input.report.sections ?? []).map((s) => [s.key, s.title]));
  return (input.report.gaps ?? [])
    .filter((g) => !g.resolution)
    .map((g) => {
      const where = titles.get(g.sectionKey);
      return makeFlag({
        code: "OPEN_GAP",
        severity: "blocking",
        sectionKey: g.sectionKey,
        gapId: g.id,
        message: `Open gap${where ? ` in “${where}”` : ""}: ${g.issue}`,
      });
    });
}
