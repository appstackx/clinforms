/**
 * DRAFT_FIT part "wording" (bh2 WD design 1 and 6): drafted text with a piece that cannot start a sentence – a stop
 * followed by a lower-case word or a comma ("…at discharge. so there is no 4th…"), or a date lead followed by a
 * lower-case fragment ("On 15/07/2026: in my assessment …", B1-3). A warning: drafting no longer rewrites sentences
 * after the fact (plainClinicalWording is not run at assembly), so this is the one cheap net that stays – the
 * SUBJECTLESS_AND / SUBJECT_BEFORE / NO_VERB_AS_NOW nets that only policed that rewriter are not carried over, and
 * the drafting's own house style ("On 20/10/2026 Tom Ellis, physiotherapist, assessed …, and recorded that …") is never
 * flagged (B3-13).
 *
 * Compact places are skipped: a value that completes a printed sentence starts in lower case on purpose ("To return to
 * lighter work"). Only printed text answers; supporting text of a structured answer is not printed.
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import { sentenceStartProblem, splitSentences } from "../../text/sentences";
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

/** "On 15/07/2026: in my …", "At the review on 01/10/2026: the …" – a date lead and a colon before a lower-case word. */
const DATE_COLON_FRAGMENT = /^(?:On|At [^:]{0,40} on) \d{2}\/\d{2}\/\d{4}:\s+[a-z]/;

/** The first piece of `text` that cannot start a sentence, or null. */
export function wordingFragment(text: string): string | null {
  for (const s of splitSentences(text, "notes")) {
    if (DATE_COLON_FRAGMENT.test(s.text)) return s.text;
    if (s.index === 0) continue; // the answer's own first word (a value may start in lower case)
    const problem = sentenceStartProblem(s);
    if (problem === "lower_case" || problem === "comma") return s.text;
  }
  return null;
}

export function fragmentsPart(input: ValidatorInput): DraftFitPart {
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f] as const));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      if (section.answer && section.answer.kind !== "text") return flags;
      if (compactPlace(fields.get(section.fieldId ?? section.key)) !== null) return flags;
      const piece = wordingFragment(p.text);
      if (!piece) return flags;
      const excerpt = piece.length > 60 ? `${piece.slice(0, 57).trimEnd()}…` : piece;
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "wording",
          message: `Check the wording: “${excerpt}” starts in the middle of a sentence – it would print like that.`,
        }),
      );
      return flags;
    },
  };
}
