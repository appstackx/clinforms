/**
 * bh2 fix round 1 – R1T-WA2-01 (review RG-4): a Word content control in a box that issues nothing prints nothing on the
 * FINAL copy – never Word's "Click or tap here to enter text." prompt, while the review card says nothing is printed.
 *
 * On the bundled Meridian sample (public demo, fictional; its content controls as Word writes them): "Is any further
 * treatment or investigation recommended?" (F-12, ☐ Yes ☐ No) controls "If yes, please give details" (F-13, a content
 * control) through the report's frozen condition. The report is made the release way (core/report-factory.ts
 * createFormReport: reportModel 2, frozen conditions, the approver), answered, and filled FINAL through the real
 * answers path (core/forms buildFormAnswers – the box ruled out gives {text: "", blank: true, leftBlank: true}) and the
 * engine (forms/render-form.ts). Also the record-empty and left-blank shapes on the same control, and an answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORDED_FORM_ANALYSIS_SOURCES } from "../../src/modules/medreport/ai/recorded/forms";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { buildFormAnswers, type FormFillAnswers } from "../../src/modules/medreport/core/forms";
import { createFormReport } from "../../src/modules/medreport/core/report-factory";
import { FormDefinitionSchema } from "../../src/modules/medreport/core/schemas";
import type { FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { getDemoBundle } from "./dev-bundles";
import { buildDocxOutline } from "../../src/modules/medreport/forms/docx-outline";
import { fillDocxReport } from "../../src/modules/medreport/forms/docx-fill";
import { DOCX_MIME, sha256Hex } from "../../src/modules/medreport/forms/file";
import { renderFormFile } from "../../src/modules/medreport/forms/render-form";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";

const PROMPT = /Click or tap here/;
const RECEIPT = { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Physiotherapist" }, signedAt: "2026-10-27T10:00:00.000Z" };
const LINE = "None needed now; she will contact her GP if the headaches return.";

async function meridian(): Promise<{ form: FormDefinition; bytes: Uint8Array }> {
  const bytes = await getSampleForm("meridian-discharge-report")!.loadFile();
  const recorded = FormDefinitionSchema.parse((RECORDED_FORM_ANALYSIS_SOURCES["meridian-discharge-report"] as { form: unknown }).form);
  const form = withAttestedConfirmation({ ...recorded, status: "confirmed" }, "Sarah Reid", "2026-10-26T09:00:00.000Z");
  return { form, bytes };
}

/** The F-12 / F-13 block's printed text (one table cell holds the question, its tick boxes and the details line). */
function detailsBlock(docx: Uint8Array): string {
  const block = buildDocxOutline(docx).blocks.find((b) => /^t\d+\.r\d+\.c\d+$/.test(b.id) && /If yes, please give details/.test(b.text));
  assert.ok(block, "the details block is on the form");
  return block.text;
}

function report(form: FormDefinition, f12: boolean, f13: string | null): Report {
  const bundle = getDemoBundle("sim-pat-001");
  const r = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: new Date("2026-10-26T10:00:00Z"), approver: { memberId: "demo", name: "Sarah Reid", hcpc: "PH-DEMO-01" } });
  const by = { memberId: "demo", name: "Sarah Reid", role: "clinician" as const, canSign: true, hcpc: "PH-DEMO-01" };
  return {
    ...r,
    sections: r.sections.map((s) => {
      if (s.key === "F-12") return { ...s, answer: { kind: "yes_no" as const, value: f12 }, answerBy: by, paragraphs: [] };
      if (s.key === "F-13") return { ...s, paragraphs: f13 ? [{ id: "F-13-p1", text: f13, sourceIds: [], origin: "clinician" as const, by }] : [] };
      return s;
    }),
  };
}

async function finalOf(form: FormDefinition, bytes: Uint8Array, answers: FormFillAnswers): Promise<Uint8Array> {
  const out = await renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength }, answers, draft: false, format: "original", strict: false });
  return out.bytes;
}

test("RG-4: F-13 ruled out by its frozen condition (F-12 = No) prints nothing – not the approver's line, not Word's prompt", async () => {
  const { form, bytes } = await meridian();
  const r = report(form, false, LINE);
  assert.ok(r.sections.find((s) => s.key === "F-13")?.condition, "the release freezes F-13's condition at creation");
  const answers = buildFormAnswers(r, form, { receipt: RECEIPT });
  assert.deepEqual(answers["F-13"], { text: "", blank: true, leftBlank: true }, "the box is not asked: blank and left blank");
  const text = detailsBlock(await finalOf(form, bytes, answers));
  assert.doesNotMatch(text, PROMPT, text);
  assert.ok(!text.includes(LINE), text);
  const outcome = fillDocxReport(bytes, form, answers, { draft: false }).outcomes.find((o) => o.fieldId === "F-13");
  assert.deepEqual([outcome?.intended, outcome?.outcome, outcome?.fatal], ["blank", "cleared", false]);
});

test("F-12 = Yes: F-13 prints the approver's line in place of Word's prompt", async () => {
  const { form, bytes } = await meridian();
  const text = detailsBlock(await finalOf(form, bytes, buildFormAnswers(report(form, true, LINE), form, { receipt: RECEIPT })));
  assert.ok(text.includes(LINE), text);
  assert.doesNotMatch(text, PROMPT, text);
});

test("F-12 = Yes with F-13 left without an answer: prints nothing there, never Word's prompt", async () => {
  const { form, bytes } = await meridian();
  const text = detailsBlock(await finalOf(form, bytes, buildFormAnswers(report(form, true, null), form, { receipt: RECEIPT })));
  assert.doesNotMatch(text, PROMPT, text);
});

test("every shape of a box that issues nothing clears the content control: record empty, not asked, left blank", async () => {
  const { form, bytes } = await meridian();
  for (const answer of [{ text: "", blank: true }, { text: "", blank: true, leftBlank: true }, { leftBlank: true }]) {
    const out = fillDocxReport(bytes, form, { "F-13": answer }, { draft: false });
    const text = detailsBlock(out.bytes);
    assert.doesNotMatch(text, PROMPT, `${JSON.stringify(answer)}: ${text}`);
    const o = out.outcomes.find((x) => x.fieldId === "F-13");
    assert.equal(o?.outcome, "cleared", JSON.stringify(answer));
    assert.equal(o?.fatal, false, JSON.stringify(answer));
  }
  // A DRAFT of a box nobody has decided yet is the form as printed (the review preview): the prompt stays there.
  assert.match(detailsBlock(fillDocxReport(bytes, form, {}, { draft: true }).bytes), PROMPT);
});
