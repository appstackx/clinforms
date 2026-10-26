/**
 * DRAFT_FIT part "printed lead" (B2-8, B3-8; bh2 WD design 9): an answer that repeats the verb the form already prints
 * before its answer space – "To return to returning to work…" (Medcare IA F-09), "To return to walking the dog daily …
 * and returning to work" (Bodycare IA F-17), "To return to Mr X had stopped…" (CLM IA F-15). It blocks: the form would
 * print the verb twice. The deterministic one-click fix (ui/components/review/fixes.ts, generator "printed-lead") takes
 * the repeated verb out: "returning to work as a carer" → "work as a carer"; "walking the dog daily and returning to
 * work" → "walking the dog daily and work".
 *
 * The lead is the map's analysis.printedLeads (WE, read from the template), else a lead quoted in the guidance
 * (core/forms/answer-shape.ts printedLeadOf). Only drafted text (origin "ai") in a blank or cell that the lead belongs to.
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { printedLeadOf } from "../../forms/answer-shape";
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

/** Verbs a printed lead ends with, and the ways an answer restates them. */
const LEAD_VERBS: ReadonlyArray<{ lead: RegExp; restated: string }> = [
  { lead: /\b(?:return|get back|go back|come back)\s+to$/i, restated: "(?:to\\s+)?(?:return(?:s|ing|ed)?|go(?:es|ing)? back|get(?:s|ting)? back|com(?:es|ing) back|went back|got back)\\s+to" },
  { lead: /\b(?:resume|resuming)$/i, restated: "(?:to\\s+)?resum(?:e|es|ing|ed)" },
  { lead: /\b(?:improve|improving)$/i, restated: "(?:to\\s+)?improv(?:e|es|ing|ed)" },
  { lead: /\b(?:be able to)$/i, restated: "(?:to\\s+)?(?:be(?:ing)? able to)" },
];

/** The restated verb of `lead` as a pattern, or null when the lead ends with no verb this check knows. */
function restatedVerb(lead: string): string | null {
  const l = lead.trim().replace(/[\s.\u2026:]+$/, "");
  for (const v of LEAD_VERBS) if (v.lead.test(l)) return v.restated;
  return null;
}

/** Whether the answer starts with, or lists an item with, the verb its printed lead already gives. */
export function repeatsPrintedVerb(text: string, lead: string | null): boolean {
  const verb = lead ? restatedVerb(lead) : null;
  if (!verb) return false;
  const t = text.trim();
  return new RegExp(`^${verb}\\b`, "i").test(t) || new RegExp(`(?:,|\\band)\\s+${verb}\\b`, "i").test(t);
}

/**
 * The answer without the repeated verb: the leading one dropped, and a later item's ("…, returning to work", "… and
 * returning to work") dropped with it ("… and work"). Unchanged when it does not repeat the verb.
 */
export function withoutPrintedVerb(text: string, lead: string | null): string {
  const verb = lead ? restatedVerb(lead) : null;
  if (!verb || !repeatsPrintedVerb(text, lead)) return text;
  let t = text.trim().replace(new RegExp(`^${verb}\\s+`, "i"), "");
  t = t.replace(new RegExp(`,\\s+${verb}\\s+(?=\\S)`, "gi"), (_m: string, offset: number, whole: string) => (/,|\band\b/.test(whole.slice(offset + _m.length)) ? ", " : " and "));
  t = t.replace(new RegExp(`\\band\\s+${verb}\\s+`, "gi"), "and ");
  return t.trim();
}

export function printedLeadPart(input: ValidatorInput): DraftFitPart {
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f] as const));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      const field = fields.get(section.key);
      if (!field || section.paragraphs[0] !== p) return flags;
      const lead = printedLeadOf(field, input.form ? { analysis: input.form.analysis } : null);
      if (!lead || !repeatsPrintedVerb(p.text, lead)) return flags;
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "printed lead",
          message: `The form already prints “${lead} …”, so this answer would print the verb twice. Take it out (for example “work as a carer”, not “returning to work as a carer”).`,
        }),
      );
      return flags;
    },
  };
}
