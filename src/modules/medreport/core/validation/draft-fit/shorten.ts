/**
 * DRAFT_FIT part "shorten" (B0-5): a short answer that goes in a table cell, or fills a blank inside the form's printed
 * sentence ("To return to …", "…/10"), written as a dated, attributed sentence or more than 12 words – it should be the
 * value alone ("Dog walking", "Daily", "6/10"); the citation keeps its source. Questions drafted from the notes only (an
 * opinion keeps its attribution).
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split): the same check, moved; draft-fit.ts runs the parts.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

const DATED = /\b\d{2}\/\d{2}\/\d{4}\b/;
const ATTRIBUTED = /\b(?:recorded|reported|told|noted|stated|described|assessed)\b/i;

export const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function shortenPart(input: ValidatorInput): DraftFitPart {
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f]));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      const field = fields.get(section.key);
      const place = section.paragraphs[0] === p ? compactPlace(field) : null;
      if (place && (DATED.test(p.text) || ATTRIBUTED.test(p.text) || words(p.text).length > 12)) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence: "shorten",
            message:
              place === "cell"
                ? "Shorten for the box: this answer goes in a table cell, so it should be the value alone (for example “Dog walking”, “Daily”, “6/10”, “Lower back”) – no date and no “recorded” or “told”. Its citation keeps the source."
                : "Shorten for the box: this answer fills a blank inside the form's printed sentence, so it should be the words that complete it – no date and no “recorded” or “told”. Its citation keeps the source.",
          }),
        );
      }
      return flags;
    },
  };
}
