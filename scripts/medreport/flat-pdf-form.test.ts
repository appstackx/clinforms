/**
 * The flat (non-fillable) PDF sample – Ashcroft Medical Reporting (fictional): its pre-written map is
 * returned when the file is uploaded (not seeded into the library), every answer space is a blank area
 * of the page (no printed text underneath), and a completed FINAL copy has the answers written onto
 * the page at those spaces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import { draftDemo } from "@/modules/medreport/ai/draft-demo";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { buildFormAnswers, checkFormDefinition, formToTemplate } from "@/modules/medreport/core/forms";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { fillPdf } from "@/modules/medreport/forms/pdf-fill";
import { readPdfForm } from "@/modules/medreport/forms/pdf-outline";
import { ASHCROFT_FORM } from "@/modules/medreport/forms/samples/maps/ashcroft";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { getDemoBundle } from "./dev-bundles";

const file = async () => getSampleForm("ashcroft-update-report")!.loadFile();

test("the Ashcroft form is a flat PDF and its map is valid, with every answer space clear of printed text", async () => {
  const bytes = await file();
  const read = await readPdfForm(bytes);
  assert.equal(read.classification, "flat");
  assert.equal(read.fields.length, 0);
  assert.deepEqual(checkFormDefinition(ASHCROFT_FORM), []);
  for (const f of ASHCROFT_FORM.fields) {
    if (f.anchor.kind !== "pdf_overlay") throw new Error(`${f.id} is not an overlay`);
    const a = f.anchor;
    const items = read.pageText.find((p) => p.page === a.page)?.items ?? [];
    const inside = items.filter((it) => it.x >= a.x && it.x <= a.x + a.width && it.y >= a.y && it.y <= a.y + a.height);
    assert.deepEqual(inside.map((i) => i.str), [], `${f.id} “${f.label}” overlaps printed text`);
  }
});

test("uploading it in demo mode returns the pre-written map as a proposal to confirm", async () => {
  const bytes = await file();
  const result = await analyseFormFile({ file: decodeFormFile(Buffer.from(bytes).toString("base64")), fileName: "ashcroft.pdf", mode: "demo" });
  assert.equal(result.form.kind, "pdf_flat");
  assert.equal(result.form.status, "proposed");
  assert.equal(result.form.analysis.mode, "demo_prewritten");
  assert.equal(result.form.fields.length, ASHCROFT_FORM.fields.length);
  assert.ok(result.trace.some((s) => /Pre-written map of this bundled sample form/.test(s.detail ?? "")));
});

test("case A on the flat form: pre-written answers, gaps for the opinions, answers written onto the page", async () => {
  const bundle = getDemoBundle("megan-hart");
  const facts = computeFacts(bundle, { asOf: "2026-10-07" });
  const report = createFormReport({ form: ASHCROFT_FORM, bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date("2026-10-07T10:00:00Z") });
  // "Instructing solicitor's reference": the referral party's reference, filled by code.
  assert.equal(report.sections.find((s) => s.key === "F-03")?.paragraphs[0]?.text, "HP/RTA/2291");
  assert.deepEqual(report.gaps, []);
  const drafted = await draftDemo({ template: formToTemplate(ASHCROFT_FORM), bundle, instructingParty: bundle.referral, computedFacts: facts, mode: "demo", form: ASHCROFT_FORM, sectionKeys: ["F-05", "F-06", "F-08", "F-09"] });
  assert.equal(drafted.meta.mode, "demo_prewritten");
  assert.ok(drafted.output.sections.find((s) => s.sectionKey === "F-05")!.paragraphs.length > 0);
  assert.equal(drafted.output.sections.find((s) => s.sectionKey === "F-09")!.paragraphs.length, 0, "no prognosis was recorded");
  assert.ok(drafted.output.gaps.some((g) => g.sectionKey === "F-09"));

  const answers = buildFormAnswers(report, ASHCROFT_FORM, { receipt: { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, signedAt: "2026-10-07T11:00:00.000Z" } });
  const out = await fillPdf(await file(), ASHCROFT_FORM, answers, { draft: false, flatten: true });
  const text = (await readPdfForm(out)).pageText.flatMap((p) => p.items.map((i) => i.str)).join(" ");
  for (const expected of ["Megan Hart", "22/11/1991", "HP/RTA/2291", "12/03/2026", "Sarah Reid", "PH-DEMO-01", "07/10/2026"]) assert.ok(text.includes(expected), expected);
});
