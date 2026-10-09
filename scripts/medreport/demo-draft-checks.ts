/**
 * The checks every prepared demo draft must pass, shared by scripts/medreport/demo-draft-quality.test.ts
 * (the bundled drafts in ai/demo-drafts) and scripts/medreport/check-demo-assets.ts (`npm run
 * demo:check`, the local demonstration drafts in MEDREPORT_DEMO_ASSETS_DIR/drafts).
 *
 * The draft is replayed exactly as the demo does (ai/draft-demo.ts draftDemo → ai/assemble.ts
 * assembleDraft, group by group as core/report-factory.ts planDraftGroups plans them) and must have:
 * every paragraph cited; no blocking flag other than the questions deliberately left for the clinician
 * (OPEN_GAP, MISSING_PLACEHOLDER) – so no unsupported date, opinion wording or corrupted clinical term
 * (TERM_NOT_IN_SOURCE); no unknown source IDs; no record IDs, glossary abbreviations or "[CLAIMANT]"
 * in answers or gaps; and an answer for every planned group (a group without one would be left for the
 * clinician in the Studio – "NO_DEMO_DRAFT").
 */
import { assembleDraft } from "@/modules/medreport/ai/assemble";
import { draftDemo } from "@/modules/medreport/ai/draft-demo";
import { DraftGenerationError } from "@/modules/medreport/ai/types";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { createFormReport, createReport, planDraftGroups } from "@/modules/medreport/core/report-factory";
import type { EpisodeBundle, FormDefinition, ReportTemplate } from "@/modules/medreport/core/types";
import { CLINICAL_ABBREVIATIONS } from "@/modules/medreport/core/voice";

export const ALLOWED_BLOCKING: ReadonlySet<string> = new Set(["OPEN_GAP", "MISSING_PLACEHOLDER"]);
export const RECORD_ID = /(^|[^\w/-])(N-\d{3}|FACT-[A-Za-z]+|REG)(?![\w/])/;
export const ABBREVIATION = new RegExp(`(^|[^A-Za-z0-9/\\-–.])(${CLINICAL_ABBREVIATIONS.map(([a]) => a).join("|")})(?![A-Za-z0-9/\\-–])`);
const PLACEHOLDER = /\[CLAIMANT\]/i;

/** The reference date the demo drafts are checked against (the fixtures' fetchedAt day). */
export const DEMO_CHECK_AS_OF = "2026-10-06";
export const DEMO_CHECK_NOW = new Date("2026-10-06T10:00:00Z");

function textProblems(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [what, re] of [["record ID", RECORD_ID], ["abbreviation", ABBREVIATION], ["placeholder", PLACEHOLDER]] as const) {
    const m = text.match(re);
    if (m) out.push([what, m[2] ?? m[0]]);
  }
  return out;
}

/**
 * Every problem of the prepared demo draft for this record and form (or built-in template), as one line
 * each ("F-07: uncited paragraph …"). [] = it passes.
 */
export async function demoDraftProblems(input: { bundle: EpisodeBundle; template: ReportTemplate; form?: FormDefinition }): Promise<string[]> {
  const { bundle, template, form } = input;
  const computedFacts = computeFacts(bundle, { asOf: DEMO_CHECK_AS_OF });
  const report = form
    ? createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts, now: DEMO_CHECK_NOW })
    : createReport({ template, bundle, instructingParty: bundle.referral, computedFacts, now: DEMO_CHECK_NOW });
  const problems: string[] = [];
  for (const keys of planDraftGroups(report, template)) {
    let drafted;
    try {
      drafted = await draftDemo({ template, bundle, instructingParty: bundle.referral, computedFacts, mode: "demo", form, sectionKeys: keys });
    } catch (err) {
      if (err instanceof DraftGenerationError && err.code === "NO_DEMO_DRAFT") {
        problems.push(`${keys.join("+")}: no prepared answer for this group (${err.message})`);
        continue;
      }
      throw err;
    }
    const a = assembleDraft({ template, bundle, instructingParty: bundle.referral, sectionKeys: keys, computedFacts, output: drafted.output, meta: drafted.meta, form, idSeed: "q" });
    for (const f of a.flags) {
      if (f.severity === "blocking" && !ALLOWED_BLOCKING.has(f.code)) problems.push(`${f.code} ${f.sectionKey}: ${f.evidence ?? f.message}`);
      if (f.code === "UNKNOWN_SOURCE_ID") problems.push(`${f.code} ${f.sectionKey}: ${f.evidence}`);
    }
    for (const s of a.sections) {
      for (const p of s.paragraphs) {
        if (p.sourceIds.length === 0) problems.push(`${s.key}: uncited paragraph "${p.text.slice(0, 60)}"`);
        for (const [what, found] of textProblems(p.text)) problems.push(`${s.key}: ${what} "${found}" in the answer`);
      }
    }
    for (const g of a.gaps) {
      for (const [what, found] of textProblems(`${g.issue} ${g.suggestedQuestion}`)) problems.push(`${g.sectionKey}: ${what} "${found}" in a gap`);
    }
  }
  return problems;
}
