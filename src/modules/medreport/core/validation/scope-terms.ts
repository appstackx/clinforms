/**
 * SCOPE_TERM: out-of-scope terms (scopeExcludeTerms(template): `scope.excludeTerms` plus the terms
 * implied by `scope.excludeFields`) in any paragraph, whoever wrote it – the document must not
 * disclose them. Blocking; cannot be acknowledged (remove the wording). Declaration sections hold the
 * template's fixed text and are not checked.
 *
 * Owner: ai agent.
 */
import { scopeExcludeTerms, scopeTermRegex } from "../scope";
import type { ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

export function validateScopeTerms(input: ValidatorInput): ReportFlag[] {
  const terms = scopeExcludeTerms(input.template);
  if (terms.length === 0) return [];
  // Longest terms first, so "past medical history" wins over "medical history" at the same place.
  const matchers = terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((term) => ({ term, re: scopeTermRegex(term, "gi") }));
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p) || section.kind === "declaration") continue;
    const spans: Array<[number, number]> = [];
    for (const { term, re } of matchers) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p.text)) !== null) {
        const evidence = m[1] || term;
        const start = m.index + m[0].length - evidence.length;
        const end = start + evidence.length;
        if (spans.some(([s, e]) => start >= s && end <= e)) continue;
        spans.push([start, end]);
        flags.push(
          makeFlag({
            code: "SCOPE_TERM",
            severity: "blocking",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence,
            message: `"${evidence}" is out of scope for this ${input.template.documentTitle.toLowerCase()}, which must not disclose unrelated history. Remove it.`,
          }),
        );
      }
    }
  }
  return flags;
}
