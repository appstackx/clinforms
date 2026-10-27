/**
 * DRAFT_FIT (warnings – Blue Heart fix round 1; bh2 WD): drafted wording that does not fit where it goes. Advisory,
 * except two blocks that each have a way out: a repeated printed verb (one-click fix) and an identical name cell in
 * numbered rows (acknowledge with a reason). Only unedited drafted text (origin "ai") is checked – a one-click fix keeps
 * origin "ai" (Paragraph.fixes), so the checks keep running after it.
 * - "shorten" (B0-5, B2-14, B3-12): a compact answer written as more than the value; the message names the trigger.
 * - "comment" (B0-23, WB): commentary about the notes inside an answer.
 * - "later note" / "earlier note" (B0-6, B1-6, B3-7): the answer reports the wrong time point.
 * - "date" (B3-7): a sentence dated to a day none of its cited sources has.
 * - "dose" (B3-12): a medicine named without a dose no cited note gives.
 * - "wording" (B1-3, B2-6): a piece that cannot start a sentence.
 * - "printed lead" (B2-8, B3-8): the answer repeats the verb the form prints before it (blocking).
 * - "repeat" / "duplicate" (B0-16, B2-7, B3-11, R-regression-4, R-regression-7): wording another box already says.
 *
 * W0.4 module split (bh2): each check is a part in draft-fit/ – shorten.ts, commentary.ts (owner WB), measure.ts,
 * fragments.ts, printed-lead.ts, repeats.ts – and compactPlace lives in core/forms/answer-shape.ts (re-exported here).
 * This file runs the parts: per drafted paragraph in document order, then each part's finish().
 * Owners: docs/bh2-ownership.json (this file and the parts except commentary.ts: WD).
 */
import type { Paragraph, ReportFlag, ReportSection } from "../types";
import { getValidationContext, hasText } from "./context";
import { commentaryPart } from "./draft-fit/commentary";
import { fragmentsPart } from "./draft-fit/fragments";
import { attendanceFramingPart, datedLeadPart, dosePart, laterNotePart } from "./draft-fit/measure";
import { printedLeadPart } from "./draft-fit/printed-lead";
import { repeatsPart } from "./draft-fit/repeats";
import { shortenPart } from "./draft-fit/shorten";
import type { ValidatorInput } from "./registry";

export { compactPlace } from "../forms/answer-shape";

/**
 * One part of the DRAFT_FIT check (draft-fit/*.ts), made once per run: `paragraph` sees every unedited drafted
 * paragraph with text (origin "ai"), in document order; `finish` runs once after the last one.
 */
export interface DraftFitPart {
  paragraph?(p: Paragraph, section: ReportSection): ReportFlag[];
  finish?(): ReportFlag[];
}

export function validateDraftFit(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];
  // The order of the parts is the order of their flags.
  const parts: DraftFitPart[] = [
    shortenPart(input),
    commentaryPart(),
    laterNotePart(input),
    datedLeadPart(input),
    dosePart(input),
    attendanceFramingPart(input),
    fragmentsPart(input),
    printedLeadPart(input),
    repeatsPart(input),
  ];

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (p.origin !== "ai" || !hasText(p)) continue;
    for (const part of parts) if (part.paragraph) flags.push(...part.paragraph(p, section));
  }
  for (const part of parts) if (part.finish) flags.push(...part.finish());
  return flags;
}
