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
 *   bh2 fix round 1 (R1T-WA1-L1; ownership exception – the integrator's file): its remedy names only what the people
 *   concerned can do. "Mark it as your own wording" is the approving clinician's action over their own text
 *   (ui/components/review/reducer.ts markOwnWords), so it is offered only on text no one else entered: on a paragraph
 *   another member entered (staff, or a clinician who is not the approver – the paragraph's `by` stamp) the message says
 *   that the approving clinician, named, rewrites it in their own words. The flag is the same for every viewer (the
 *   validators never know who is looking), so it never says "you" to someone who cannot act on it.
 *
 * Owner: ai agent.
 */
import { isNoteId } from "../ids";
import type { Paragraph, Report, ReportFlag } from "../types";
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
          message: p.origin === "ai" ? "This drafted paragraph cites no source in the record. Add the note or fact it comes from, or rewrite it as your own text." : uncitedEditMessage(p, input.report),
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

/**
 * UNCITED_PARAGRAPH's words for a person's text (R1T-WA1-L1): "mark it as your own wording" only where the writer is the
 * approving clinician (or the report has no approver, or no one is stamped); another member's text names who settles it.
 */
function uncitedEditMessage(p: Pick<Paragraph, "by">, report: Pick<Report, "approver">): string {
  const approver = report.approver;
  const by = p.by;
  const someoneElse = Boolean(approver && by && (by.memberId !== approver.memberId || by.role === "staff"));
  if (!someoneElse || !approver || !by) return "This edited paragraph cites no source in the record. Add the note or fact it comes from, or mark it as your own wording.";
  return `This paragraph, entered by ${by.name}, cites no source in the record. Add the note or fact it comes from – or ${approver.name}, the approving clinician, can write the answer in their own words.`;
}
