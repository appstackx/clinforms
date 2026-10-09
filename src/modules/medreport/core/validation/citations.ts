/**
 * UNKNOWN_SOURCE_ID and UNCITED_PARAGRAPH.
 *
 * - UNKNOWN_SOURCE_ID (warning): a paragraph cites an ID that is not a source of this report (not
 *   REG, a note in the bundle or a computed fact). The ID is ignored for every check. The server drops
 *   such IDs from AI output when it assembles a draft and records the flag; that flag is carried over
 *   here for as long as the paragraph is unchanged AI text.
 * - UNCITED_PARAGRAPH (blocking): origin "ai" or "edited" text with no valid citation, or an attributed
 *   opinion (basis clinician_opinion_recorded, or any paragraph in a clinician_opinion section) that
 *   does not cite the note in which the opinion was recorded. "clinician" and "from_records"
 *   paragraphs are exempt.
 *
 * Owner: ai agent.
 */
import { isNoteId } from "../ids";
import type { ReportFlag } from "../types";
import { CHECKED_ORIGINS, getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

export function validateCitations(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  for (const ref of ctx.paragraphs) {
    const { paragraph: p, section } = ref;
    if (!hasText(p)) continue;
    const cited = ctx.cited(p);

    for (const id of cited.unknownIds) {
      flags.push(
        makeFlag({
          code: "UNKNOWN_SOURCE_ID",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: id,
          message: `"${id}" is not a source in this record, so it is ignored. Cite REG, a note (N-…) or a computed fact (FACT-…).`,
        }),
      );
    }

    if (CHECKED_ORIGINS.indexOf(p.origin) < 0) continue;

    if (cited.validIds.length === 0) {
      flags.push(
        makeFlag({
          code: "UNCITED_PARAGRAPH",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          message:
            p.origin === "ai"
              ? "This drafted paragraph cites no source in the record. Add the note or fact it comes from, or rewrite it as your own text."
              : "This edited paragraph cites no source in the record. Add the note or fact it comes from, or mark it as your own wording.",
        }),
      );
      continue;
    }

    const isOpinion = p.basis === "clinician_opinion_recorded" || section.kind === "clinician_opinion";
    if (isOpinion && !cited.validIds.some(isNoteId)) {
      flags.push(
        makeFlag({
          code: "UNCITED_PARAGRAPH",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "no note cited",
          message: "An attributed opinion must cite the note in which the clinician recorded it (N-…), not only REG or a computed fact.",
        }),
      );
    }
  }

  // Carry over UNKNOWN_SOURCE_ID flags recorded when the server dropped an invalid ID from AI output,
  // while the paragraph is still unchanged AI text and the ID is still absent.
  const byId = new Map(ctx.paragraphs.map((r) => [r.paragraph.id, r]));
  for (const old of input.report.flags ?? []) {
    if (old.code !== "UNKNOWN_SOURCE_ID" || !old.paragraphId) continue;
    const ref = byId.get(old.paragraphId);
    if (!ref || ref.paragraph.origin !== "ai") continue;
    if (old.evidence && (ref.paragraph.sourceIds ?? []).indexOf(old.evidence) >= 0) continue; // re-flagged above
    flags.push({ ...old, severity: "warning", sectionKey: ref.section.key });
  }

  return flags;
}
