/**
 * DRAFT_FIT part "comment" (B0-23): commentary about the notes inside an answer ("The notes are written by…", "so I can
 * only describe…") – it would be printed on the form.
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split): the same check, moved; draft-fit.ts runs the parts.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";

const COMMENTARY = /\b(?:the notes (?:are|were) (?:all )?written by|(?:so )?i can only (?:describe|say|give)|the (?:record|notes) (?:does|do) not (?:set out|say|state|record)|it is not possible to (?:say|tell) from the (?:notes|record))\b/i;

export function commentaryPart(): DraftFitPart {
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      const comment = COMMENTARY.exec(p.text);
      if (comment) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence: "comment",
            message: `Remove the comment about the notes (“${comment[0]}…”): it would be printed on the form.`,
          }),
        );
      }
      return flags;
    },
  };
}
