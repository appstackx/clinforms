/**
 * DRAFT_FIT (warnings – Blue Heart fix round 1): drafted wording that does not fit where it goes on the form. Never
 * blocking; each is acknowledged or fixed by editing (only unedited drafted text, origin "ai", is checked).
 * - "shorten" (B0-5): a short answer that goes in a table cell, or fills a blank inside the form's printed sentence ("To
 *   return to …", "…/10"), written as a dated, attributed sentence or more than 12 words – it should be the value
 *   alone ("Dog walking", "Daily", "6/10"); the citation keeps its source. Questions drafted from the notes only (an
 *   opinion keeps its attribution).
 * - "comment" (B0-23): commentary about the notes inside an answer ("The notes are written by…", "so I can only
 *   describe…") – it would be printed on the form.
 * - "repeat" (B0-16): a numbered row (Activity 2) that repeats an earlier row of the same table (Activity 1).
 * - "later note" (B0-6): on an initial assessment form, a paragraph citing a note dated after that assessment.
 *
 * W0.4 module split (bh2): each check is a part in draft-fit/ – shorten.ts, commentary.ts (owner WB), measure.ts
 * ("later note"), repeats.ts, and the W0.6 stubs fragments.ts and printed-lead.ts – and compactPlace lives in
 * core/forms/answer-shape.ts (re-exported here). This file runs the parts in the order their flags were always listed:
 * per drafted paragraph shorten, comment, later note (then the stubs); then the repeated rows. Owners:
 * docs/bh2-ownership.json (this file and the parts except commentary.ts: WD).
 *
 * Owner: ai agent.
 */
import type { Paragraph, ReportFlag, ReportSection } from "../types";
import { getValidationContext, hasText } from "./context";
import { commentaryPart } from "./draft-fit/commentary";
import { fragmentsPart } from "./draft-fit/fragments";
import { laterNotePart } from "./draft-fit/measure";
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
  // The order of the parts is the order of their flags. fragments and printed-lead are W0.6 stubs (no flags yet, WD).
  const parts: DraftFitPart[] = [shortenPart(input), commentaryPart(), laterNotePart(input), fragmentsPart(input), printedLeadPart(input), repeatsPart(input)];

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (p.origin !== "ai" || !hasText(p)) continue;
    for (const part of parts) if (part.paragraph) flags.push(...part.paragraph(p, section));
  }
  for (const part of parts) if (part.finish) flags.push(...part.finish());
  return flags;
}
