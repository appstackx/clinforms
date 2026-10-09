/**
 * The recorded demo drafts are what a prospect sees first, so they must pass the same checks a live
 * draft gets – assembled exactly as the demo replays them (ai/draft-demo.ts → ai/assemble.ts):
 * every paragraph cited, no blocking flag other than the questions deliberately left for the clinician
 * (OPEN_GAP, MISSING_PLACEHOLDER) – so no unsupported date, opinion wording or corrupted clinical term
 * (TERM_NOT_IN_SOURCE) – and no record IDs, glossary abbreviations or "[CLAIMANT]" in answers or gaps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { assembleDraft } from "@/modules/medreport/ai/assemble";
import { draftDemo } from "@/modules/medreport/ai/draft-demo";
import { getRecordedFormAnalysis } from "@/modules/medreport/ai/recorded-forms";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { formToTemplate } from "@/modules/medreport/core/forms";
import { createFormReport, createReport, planDraftGroups } from "@/modules/medreport/core/report-factory";
import type { FormDefinition, ReportTemplate } from "@/modules/medreport/core/types";
import { CLINICAL_ABBREVIATIONS } from "@/modules/medreport/core/voice";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { getDemoBundle } from "./dev-bundles";

const DIR = "src/modules/medreport/ai/demo-drafts";
const TEMPLATES: ReportTemplate[] = [SOLICITOR_RTA_TEMPLATE, EMPLOYER_FFW_TEMPLATE];
const ALLOWED_BLOCKING = new Set(["OPEN_GAP", "MISSING_PLACEHOLDER"]);
const RECORD_ID = /(^|[^\w/-])(N-\d{3}|FACT-[A-Za-z]+|REG)(?![\w/])/;
const ABBREVIATION = new RegExp(`(^|[^A-Za-z0-9/\\-–.])(${CLINICAL_ABBREVIATIONS.map(([a]) => a).join("|")})(?![A-Za-z0-9/\\-–])`);

test("every recorded demo draft passes the draft checks once assembled", async () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 8);
  const all: string[] = [];
  for (const name of files) {
    const recorded = JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as { patientId: string; templateId: string; sampleId?: string; formSha256?: string };
    const bundle = getDemoBundle(recorded.patientId);
    const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
    const now = new Date("2026-10-06T10:00:00Z");
    let form: FormDefinition | undefined;
    let template: ReportTemplate;
    if (recorded.sampleId) {
      const entry = getSampleForm(recorded.sampleId);
      form = (await entry?.loadForm?.()) ?? (await entry?.loadPrewrittenAnalysis?.()) ?? getRecordedFormAnalysis(recorded.formSha256 ?? "")?.form;
      assert.ok(form, `${name}: a map of the form`);
      template = formToTemplate(form);
    } else {
      const found = TEMPLATES.find((t) => t.id === recorded.templateId);
      assert.ok(found, `${name}: template ${recorded.templateId}`);
      template = found;
    }
    const report = form
      ? createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts, now })
      : createReport({ template, bundle, instructingParty: bundle.referral, computedFacts, now });
    const problems: string[] = [];
    for (const keys of planDraftGroups(report, template)) {
      const drafted = await draftDemo({ template, bundle, instructingParty: bundle.referral, computedFacts, mode: "demo", form, sectionKeys: keys });
      const a = assembleDraft({ template, bundle, instructingParty: bundle.referral, sectionKeys: keys, computedFacts, output: drafted.output, meta: drafted.meta, form, idSeed: "q" });
      for (const f of a.flags) {
        if (f.severity === "blocking" && !ALLOWED_BLOCKING.has(f.code)) problems.push(`${f.code} ${f.sectionKey}: ${f.evidence ?? f.message}`);
        if (f.code === "UNKNOWN_SOURCE_ID") problems.push(`${f.code} ${f.sectionKey}: ${f.evidence}`);
      }
      for (const s of a.sections) {
        for (const p of s.paragraphs) {
          if (p.sourceIds.length === 0) problems.push(`${s.key}: uncited paragraph "${p.text.slice(0, 60)}"`);
          for (const [what, re] of [["record ID", RECORD_ID], ["abbreviation", ABBREVIATION], ["placeholder", /\[CLAIMANT\]/i]] as const) {
            const m = p.text.match(re);
            if (m) problems.push(`${s.key}: ${what} "${m[2] ?? m[0]}" in the answer`);
          }
        }
      }
      for (const g of a.gaps) {
        const text = `${g.issue} ${g.suggestedQuestion}`;
        for (const [what, re] of [["record ID", RECORD_ID], ["abbreviation", ABBREVIATION], ["placeholder", /\[CLAIMANT\]/i]] as const) {
          const m = text.match(re);
          if (m) problems.push(`${g.sectionKey}: ${what} "${m[2] ?? m[0]}" in a gap`);
        }
      }
    }
    all.push(...problems.map((p) => `${name} ${p}`));
  }
  assert.deepEqual(all, [], `\n  ${all.join("\n  ")}`);
});
