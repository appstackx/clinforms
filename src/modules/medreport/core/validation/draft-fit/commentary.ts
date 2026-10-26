/**
 * DRAFT_FIT part "comment" (B0-23; bh2 plan WB design 12): commentary about the notes inside an answer – it would be
 * printed on the form.
 *
 * Commentary is ONLY a sentence whose subject is, or that names, the notes or the record: "The notes are written by…",
 * "so I can only describe…", "No limits on his duties were recorded in his notes.", "No frequency was recorded in that
 * note.", "Tom Ellis's note did not record any restriction on driving.", "The initial assessment on 01/09/2026 by Priya
 * Shah did not record specific treatment goals." (B2-17, B3-14). A clinical negative ("No red flags were reported.",
 * "No swelling was noted on examination.") is a finding: never commentary, never removable (R-regression-5) – the
 * cited note must hold it (validation/attribution-negatives.ts).
 *
 * The warning on a comment about another clinician's note says so (B3-14); on supporting text – the paragraphs of a
 * tick, choice or yes/no answer – it says the text is kept with the report, not printed on the form (B3-14a). The
 * one-click "Remove the comment" (attribution-fixes.ts) takes out whole commentary sentences, never the box's only text.
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split); draft-fit.ts runs the parts.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Paragraph, ReportFlag, ReportSection } from "../../types";
import { splitSentences } from "../../text/sentences";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";

const NOTE_WORDS = "(?:notes?|records?|clinical notes|documentation|initial assessment|assessment note|discharge note|review note|follow-up note)";
const OWNERS = "(?:the|his|her|their|that|this|these|those|my|[A-Z][a-z]+(?: [A-Z][a-z'’-]+)?['’]s)";

/** The whole-sentence commentary shapes (each names the notes or the record). */
const COMMENTARY_SENTENCE: readonly RegExp[] = [
  // "The notes are written by …", "so I can only describe …", "it is not possible to say from the notes"
  /\b(?:the notes (?:are|were) (?:all )?written by|(?:so )?i can only (?:describe|say|give)|it is not possible to (?:say|tell) from the (?:notes|record))\b/i,
  // "The record does not say …", "Tom Ellis's note did not record …", "The initial assessment on 01/09/2026 by Priya Shah did not record …"
  new RegExp(`\\b${OWNERS} ${NOTE_WORDS}\\b[^.;]{0,80}?\\b(?:does|do|did) not (?:set out|say|state|record|mention|include|give|document|describe|specify)\\b`, "i"),
  // "… (was|were) not recorded in her notes", "No frequency was recorded in that note."
  new RegExp(`\\b(?:was|were|is|are|has been|have been) (?:not )?(?:recorded|documented|stated|mentioned|specified) (?:in|by) ${OWNERS} ${NOTE_WORDS}\\b`, "i"),
  // "There is no record of …", "The notes do not record …"
  /\bthere (?:is|was) no (?:record|mention|note) of\b/i,
];

/** A clinician named in the comment, or "her/his note" (a colleague's note: B3-14 says so). */
const COLLEAGUE = /\b([A-Z][a-z]+ [A-Z][a-z'’-]+)['’]s (?:note|notes|record|assessment)\b|\bby ([A-Z][a-z]+ [A-Z][a-z'’-]+)\b/;

/** The commentary sentences of a text (whole sentences, the shared tokenizer). */
export function commentarySentences(text: string): Array<{ start: number; end: number; text: string }> {
  return splitSentences(text, "prose").filter((s) => COMMENTARY_SENTENCE.some((re) => re.test(s.text)));
}

/** Whether a section's paragraphs are supporting text (kept with the report, not printed): a tick, choice or yes/no answer. */
export function isSupportingText(section: Pick<ReportSection, "answer">): boolean {
  return Boolean(section.answer && section.answer.kind !== "text");
}

export function commentaryPart(): DraftFitPart {
  return {
    paragraph(p: Paragraph, section: ReportSection) {
      const flags: ReportFlag[] = [];
      const found = commentarySentences(p.text);
      if (found.length === 0) return flags;
      const sentence = found[0].text;
      const colleague = COLLEAGUE.exec(sentence);
      const who = colleague ? (colleague[1] ?? colleague[2]) : null;
      const where = isSupportingText(section)
        ? "It is supporting text – kept with the report, not printed on the form – but it says nothing about the patient."
        : "It would be printed on the form.";
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "comment",
          message: `Remove the comment about the notes (“${sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence}”)${who ? `, a comment on ${who}'s documentation` : ""}. ${where}`,
        }),
      );
      return flags;
    },
  };
}
