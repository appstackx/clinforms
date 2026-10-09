/**
^ * Option matching for structured answers (core/forms.ts matchOption / parseFormAnswerValue /
 * isUnknownAnswer) and the Word tick-box fill that uses it: an answer meaning "not known" must stay
 * blank – it must never tick "No" – and prefixes must not pick a different option.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { buildDocxOutline } from "./docx-outline";
import { fillDocx } from "./docx-fill";
import type { FormDefinition, FormField } from "../core/types";
import { isUnknownAnswer, matchOption, parseFormAnswerValue } from "../core/forms";

const YES_NO = { answerType: "yes_no" as const, options: ["Yes", "No"] };

test("'not known' answers never become Yes or No", () => {
  for (const raw of ["Not recorded", "Not known", "Nothing documented", "Unknown", "N/A", "n/a", "No information recorded", "Not documented in the notes", "Unable to say", "Cannot comment", "Unclear"]) {
    assert.equal(isUnknownAnswer(raw), true, raw);
    assert.equal(parseFormAnswerValue(YES_NO, raw).value, null, raw);
    assert.equal(matchOption(["Yes", "No"], raw), null, raw);
  }
});

test("prefixes do not pick a different option", () => {
  assert.equal(parseFormAnswerValue(YES_NO, "Yesterday").value, null);
  assert.equal(matchOption(["Yes", "No"], "Yesterday"), null);
  assert.equal(matchOption(["None", "Some", "Severe"], "N"), null);
  assert.equal(matchOption(["Fit for normal duties", "Fit with adjustments", "Not fit"], "Fit"), null, "ambiguous");
  assert.equal(matchOption(["Normal", "Restricted"], "No"), null);
});

test("legitimate answers still match", () => {
  assert.equal(parseFormAnswerValue(YES_NO, "Yes").value, true);
  assert.equal(parseFormAnswerValue(YES_NO, "no").value, false);
  assert.equal(parseFormAnswerValue(YES_NO, "Y").value, true);
  assert.equal(parseFormAnswerValue(YES_NO, "N").value, false);
  assert.equal(parseFormAnswerValue({ answerType: "yes_no", options: ["Yes – see below", "No"] }, "Yes").value, true);
  assert.equal(matchOption(["Yes", "No"], "Yes – see the discharge note"), "Yes");
  assert.equal(matchOption(["Yes", "No"], "No, not at present"), "No");
  assert.equal(matchOption(["Fit for normal duties", "Fit with adjustments", "Not fit"], "fit with adjustments"), "Fit with adjustments");
  assert.equal(matchOption(["Fit for normal duties", "Fit with adjustments", "Not fit"], "Fit with"), "Fit with adjustments");
  assert.equal(parseFormAnswerValue({ answerType: "single_choice", options: ["None", "Some", "Severe"] }, "Some").value, "Some");
  assert.equal(parseFormAnswerValue({ answerType: "single_choice", options: ["None", "Some", "Severe"] }, "N").value, null);
});

/* Word tick boxes ------------------------------------------------------------------------------ */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function yesNoDocx(): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Fit for normal duties?</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">☐ Yes  ☐ No</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array" });
}

function yesNoForm(): FormDefinition {
  const field: FormField = {
    id: "F-01",
    label: "Fit for normal duties?",
    guidance: "",
    answerType: "yes_no",
    options: ["Yes", "No"],
    anchor: {
      kind: "docx",
      target: "checkbox_glyph",
      blockId: "p1",
      optionGlyphs: [
        { option: "Yes", blockId: "p1", glyphIndex: 0 },
        { option: "No", blockId: "p1", glyphIndex: 1 },
      ],
    },
    fillSource: { kind: "clinician_opinion" },
    required: true,
    confidence: "high",
  };
  return {
    id: "frm_opt",
    tenantId: "demo",
    referrer: { name: "Test (fictional)", type: "employer" },
    title: "Test",
    file: { fileName: "t.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields: [field],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

const boxes = (bytes: Uint8Array) => buildDocxOutline(bytes).blocks.find((b) => b.id === "p1")?.text;

test("Word tick boxes: 'Not recorded' ticks nothing; 'No' and 'Yes' tick the right box", () => {
  const doc = yesNoDocx();
  const form = yesNoForm();
  assert.equal(boxes(fillDocx(doc, form, { "F-01": { text: "Not recorded" } }, { draft: false })), "☐ Yes  ☐ No");
  assert.equal(boxes(fillDocx(doc, form, { "F-01": { text: "No information recorded" } }, { draft: false })), "☐ Yes  ☐ No");
  assert.equal(boxes(fillDocx(doc, form, { "F-01": { text: "Yesterday" } }, { draft: false })), "☐ Yes  ☐ No");
  assert.equal(boxes(fillDocx(doc, form, { "F-01": { text: "No", value: false } }, { draft: false })), "☐ Yes  ☒ No");
  assert.equal(boxes(fillDocx(doc, form, { "F-01": { text: "Yes", value: true } }, { draft: false })), "☒ Yes  ☐ No");
});

test("a printed option that reads like 'not known' is still a real answer", () => {
  const field = { answerType: "single_choice" as const, options: ["Yes, with the adjustments below", "No", "Not applicable"] };
  assert.equal(parseFormAnswerValue(field, "Not applicable").value, "Not applicable");
  assert.equal(matchOption(field.options, "not applicable"), "Not applicable");
  assert.equal(isUnknownAnswer("Not applicable", field.options), false);
  assert.equal(isUnknownAnswer("Not applicable"), true);
});
