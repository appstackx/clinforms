/**
 * Recorded demo drafts are bound to the exact record they were recorded from (ai/bundle-fingerprint.ts):
 * an upload that reuses a demo patient ID, or a record whose notes differ, never receives them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoDraftAvailability, draftDemo, hasDemoDraft } from "@/modules/medreport/ai/draft-demo";
import { DraftGenerationError } from "@/modules/medreport/ai/types";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { getDemoBundle } from "./dev-bundles";

test("the simulated-TM3 demo record gets its recorded drafts", () => {
  const bundle = getDemoBundle("megan-hart");
  assert.ok(hasDemoDraft(bundle, SOLICITOR_RTA_TEMPLATE.id));
  assert.ok(demoDraftAvailability(bundle).templateIds.includes(SOLICITOR_RTA_TEMPLATE.id));
});

test("an upload reusing the demo patient ID gets nothing", async () => {
  const upload = getDemoBundle("megan-hart");
  upload.source = { ...upload.source, connectorId: "file-import" };
  assert.equal(hasDemoDraft(upload, SOLICITOR_RTA_TEMPLATE.id), false);
  assert.deepEqual(demoDraftAvailability(upload), { templateIds: [], formSha256s: [] });
  await assert.rejects(
    draftDemo({
      template: SOLICITOR_RTA_TEMPLATE,
      bundle: upload,
      instructingParty: upload.referral,
      sectionKeys: ["incident_history"],
      computedFacts: computeFacts(upload),
      mode: "demo",
    }),
    (err: unknown) => err instanceof DraftGenerationError && err.code === "NO_DEMO_DRAFT",
  );
});

test("the same patient ID with different notes gets nothing", () => {
  const changed = getDemoBundle("megan-hart");
  changed.notes = changed.notes.map((n, i) => (i === 0 ? { ...n, subjective: `${n.subjective ?? ""} Changed.` } : n));
  assert.equal(hasDemoDraft(changed, SOLICITOR_RTA_TEMPLATE.id), false);
  assert.deepEqual(demoDraftAvailability(changed).templateIds, []);
});

test("every bundled form demo draft answers every question the planner sends for drafting", async () => {
  const { getSampleForm } = await import("@/modules/medreport/forms/samples/registry");
  const { getRecordedFormAnalysis } = await import("@/modules/medreport/ai/recorded-forms");
  const { formToTemplate } = await import("@/modules/medreport/core/forms");
  const { createFormReport, planDraftGroups } = await import("@/modules/medreport/core/report-factory");
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = "src/modules/medreport/ai/demo-drafts";
  const files = readdirSync(dir).filter((f) => /__form-.+\.json$/.test(f));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const recorded = JSON.parse(readFileSync(`${dir}/${name}`, "utf8")) as { patientId: string; sampleId: string; formSha256: string };
    const entry = getSampleForm(recorded.sampleId);
    assert.ok(entry, `${name}: sample ${recorded.sampleId}`);
    const form = (await entry.loadForm?.()) ?? (await entry.loadPrewrittenAnalysis?.()) ?? getRecordedFormAnalysis(recorded.formSha256)?.form;
    assert.ok(form, `${name}: a map of the form`);
    const bundle = getDemoBundle(recorded.patientId);
    const facts = computeFacts(bundle, { asOf: "2026-10-06" });
    const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date("2026-10-06T10:00:00Z") });
    const template = formToTemplate(form);
    for (const keys of planDraftGroups(report, template)) {
      const drafted = await draftDemo({ template, bundle, instructingParty: bundle.referral, computedFacts: facts, mode: "demo", form, sectionKeys: keys });
      const got = drafted.output.sections.map((s) => s.sectionKey);
      assert.deepEqual(got, keys, `${name}: group ${keys.join("+")}`);
    }
  }
});
