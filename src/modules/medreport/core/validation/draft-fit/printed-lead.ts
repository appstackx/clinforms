/**
 * W0.6 stub for WD: the DRAFT_FIT part for the printed lead – an answer that repeats the verb the form already prints
 * before its answer space (Bodycare IA F-17, CLM IA F-15, Medcare IA F-09) blocks, with a deterministic one-click fix.
 * The lead comes from analysis.printedLeads (WE), falling back to a lead quoted in the guidance (plan WD design 9).
 *
 * Run by draft-fit.ts after "fragments". Gives no flags until WD fills it in.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

export function printedLeadPart(_input: ValidatorInput): DraftFitPart {
  return {};
}
