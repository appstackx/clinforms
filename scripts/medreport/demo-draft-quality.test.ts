/**
 * The recorded demo drafts are what a prospect sees first, so they must pass the same checks a live
 * draft gets – assembled exactly as the demo replays them (ai/draft-demo.ts → ai/assemble.ts):
 * every paragraph cited, no blocking flag other than the questions deliberately left for the clinician
 * (OPEN_GAP, MISSING_PLACEHOLDER) – so no unsupported date, opinion wording or corrupted clinical term
 * (TERM_NOT_IN_SOURCE) – and no record IDs, glossary abbreviations or "[CLAIMANT]" in answers or gaps.
 * The checks themselves live in ./demo-draft-checks.ts, so `npm run demo:check` applies exactly the same
 * ones to the local demonstration drafts (MEDREPORT_DEMO_ASSETS_DIR).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { getRecordedFormAnalysis } from "@/modules/medreport/ai/recorded-forms";
import { formToTemplate } from "@/modules/medreport/core/forms";
import type { FormDefinition, ReportTemplate } from "@/modules/medreport/core/types";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { demoDraftProblems } from "./demo-draft-checks";
import { getDemoBundle } from "./dev-bundles";

const DIR = "src/modules/medreport/ai/demo-drafts";
const TEMPLATES: ReportTemplate[] = [SOLICITOR_RTA_TEMPLATE, EMPLOYER_FFW_TEMPLATE];

test("every recorded demo draft passes the draft checks once assembled", async () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 8);
  const all: string[] = [];
  for (const name of files) {
    const recorded = JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as { patientId: string; templateId: string; sampleId?: string; formSha256?: string };
    const bundle = getDemoBundle(recorded.patientId);
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
    const problems = await demoDraftProblems({ bundle, template, form });
    all.push(...problems.map((p) => `${name} ${p}`));
  }
  assert.deepEqual(all, [], `\n  ${all.join("\n  ")}`);
});
