/**
 * W0.6 stub for WD: the DRAFT_FIT part for wording fragments – a sentence that starts in lower case, with a digit or a
 * comma, or an orphaned "He/She recorded …" left by a rewrite (plan WD design 6; round-2 B1-3 / B2-6 are not on this
 * base and are re-implemented here behind corpus cases).
 *
 * Run by draft-fit.ts after "later note". Gives no flags until WD fills it in.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

export function fragmentsPart(_input: ValidatorInput): DraftFitPart {
  return {};
}
