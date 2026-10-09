/**
 * Fillable-PDF correctness on structures copied from real insurer forms (scripts/medreport/
 * pdf-acro-fixtures.ts – synthetic, fictional): reading (printed labels per widget, one-character box
 * groups), mapping (rules mode and post-validation produce optionLabels, optionFields and
 * pdf_char_fields), filling (the right radio button and tick-box widget, visible ticks, DDMMYYYY dates,
 * one character per box, two-line cells, cut values reported as errors) and the final render refusing
 * a form with a cut value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, type PDFCheckBox } from "pdf-lib";
import { postValidateFields } from "@/modules/medreport/ai/form-postvalidate";
import { proposeFieldsByRules } from "@/modules/medreport/ai/form-rules";
import { renderPdfOutline, chunkPdfFields, type ParsedForm } from "@/modules/medreport/ai/form-outline";
import { HttpError } from "@/modules/medreport/api/http";
import { checkFormDefinition, formAnchorKey, formAnchorPdfFieldNames, type FormFillAnswers } from "@/modules/medreport/core/forms";
import type { FormAnchor, FormDefinition, FormField } from "@/modules/medreport/core/types";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { fillPdf } from "@/modules/medreport/forms/pdf-fill";
import { readPdfForm } from "@/modules/medreport/forms/pdf-outline";
import { loadPdfjs, pdfjsDocumentParams } from "@/modules/medreport/forms/pdfjs";
import { renderFormFile } from "@/modules/medreport/forms/render-form";
import { FIXTURE_RECTS, buildInsurerLikePdf, widgetStates } from "./pdf-acro-fixtures";

const fixture = buildInsurerLikePdf();

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function formOf(fields: FormField[], sha256 = "0".repeat(64)): FormDefinition {
  return {
    id: "frm_acro_test",
    tenantId: "demo",
    referrer: { name: "Test Insurer (fictional)", type: "insurer" },
    title: "Therapy plan (fictional)",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256, sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-09T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
  };
}

const TITLE = field(
  "F-01",
  "Title (please tick)",
  {
    kind: "pdf_field",
    fieldName: "Radio Button 1",
    fieldType: "radio",
    options: ["Choice1", "Choice2", "Choice3", "Choice4", "Choice5", "Choice6"],
    optionLabels: ["Other (please state)", "Dr", "Mr", "Ms", "Mrs", "Miss"],
  },
  { answerType: "single_choice", options: ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other (please state)"] },
);
const DOB = field("F-02", "Date of birth", { kind: "pdf_field", fieldName: "Text Field 3", fieldType: "text" }, { answerType: "date" });
const MEMBER = field("F-03", "Membership number", { kind: "pdf_field", fieldName: "Text Field 4", fieldType: "text" });
const REFERRED = field(
  "F-04",
  "Was the patient referred to you?",
  { kind: "pdf_field", fieldName: "Check Box 13", fieldType: "checkbox", options: ["no", "Yes"], optionLabels: ["No", "Yes"] },
  { answerType: "yes_no", options: ["Yes", "No"] },
);
const TYPE = field(
  "F-05",
  "Therapist type",
  {
    kind: "pdf_field",
    fieldName: "Check Box 4",
    fieldType: "checkbox",
    optionFields: [
      { option: "Physiotherapist", fieldName: "Check Box 4" },
      { option: "Chiropractor", fieldName: "Check Box 5" },
      { option: "Osteopath", fieldName: "Check Box 6" },
    ],
  },
  { answerType: "single_choice", options: ["Physiotherapist", "Chiropractor", "Osteopath"] },
);
const INSURED = field(
  "F-06",
  "Do you have any other health insurance?",
  {
    kind: "pdf_field",
    fieldName: "Check Box5",
    fieldType: "checkbox",
    optionFields: [
      { option: "Yes", fieldName: "Check Box5" },
      { option: "No", fieldName: "Check Box6" },
    ],
  },
  { answerType: "yes_no", options: ["Yes", "No"] },
);
const DIAGNOSED = field(
  "F-07",
  "Date of diagnosis",
  { kind: "pdf_char_fields", fieldNames: Array.from({ length: 8 }, (_, i) => `Text Field ${20 + i}`), format: "DDMMYYYY" },
  { answerType: "date" },
);
const SIGNED = field("F-08", "Date", { kind: "pdf_field", fieldName: "Text Field 30", fieldType: "text" }, { answerType: "date_signed", fillSource: { kind: "signoff", part: "date" } });
const TREATMENT = field("F-09", "Treatment received", { kind: "pdf_field", fieldName: "Treatment Row1", fieldType: "text" });
const AMOUNT = field("F-10", "Amount", { kind: "pdf_field", fieldName: "Amount Row1", fieldType: "text" });

const ANSWERS: FormFillAnswers = {
  "F-01": { text: "Mrs", value: "Mrs" },
  "F-02": { text: "14/02/1991", value: "1991-02-14" },
  "F-03": { text: "NA 4471 09" },
  "F-04": { text: "Yes", value: true },
  "F-05": { text: "Physiotherapist", value: "Physiotherapist" },
  "F-06": { text: "No", value: false },
  "F-07": { text: "02/09/2026", value: "2026-09-02" },
  "F-08": { text: "09/10/2026", value: "2026-10-09" },
  "F-09": { text: "Physiotherapy – follow-up treatment session (30 min)" },
};
const ALL = [TITLE, DOB, MEMBER, REFERRED, TYPE, INSURED, DIAGNOSED, SIGNED, TREATMENT, AMOUNT];

async function fill(answers: FormFillAnswers, opts: { flatten?: boolean; draft?: boolean } = {}) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const out = await fillPdf((await fixture).bytes, formOf(ALL), answers, {
    draft: opts.draft ?? true,
    flatten: opts.flatten ?? false,
    onWarning: (m) => warnings.push(m),
    onError: (m) => errors.push(m),
  });
  return { out, warnings, errors, form: (await PDFDocument.load(out)).getForm() };
}

/* ------------------------------------------------------------------------------------------------
 * Reading
 * ----------------------------------------------------------------------------------------------*/

test("readPdfForm: printed label per radio export value and per tick-box widget; multi-widget on-values as options", async () => {
  const outline = await readPdfForm((await fixture).bytes);
  const by = Object.fromEntries(outline.fields.map((f) => [f.name, f]));
  assert.deepEqual(by["Radio Button 1"].options, ["Choice1", "Choice2", "Choice3", "Choice4", "Choice5", "Choice6"]);
  assert.deepEqual(by["Radio Button 1"].optionLabels, ["Other (please state)", "Dr", "Mr", "Ms", "Mrs", "Miss"]);
  assert.match(by["Radio Button 1"].nearbyText, /^Title \(please tick\)/, "the question leads, not the option labels");
  assert.deepEqual(by["Check Box 13"].options, ["no", "Yes"]);
  assert.deepEqual(by["Check Box 13"].optionLabels, ["No", "Yes"]);
  assert.match(by["Check Box 13"].nearbyText, /^Was the patient referred to you\?/);
  assert.deepEqual(by["Check Box 4"].optionLabels, ["Physiotherapist"]);
  assert.deepEqual(by["Check Box5"].optionLabels, ["Yes"], "label printed LEFT of the box");
  assert.deepEqual(by["Check Box6"].optionLabels, ["No"]);
  assert.equal(by["Check Box 10"].optionLabels, undefined, "nothing printed beside it");
  assert.equal(by["Check Box 4"].options, undefined, "a single tick box has no options");
});

test("readPdfForm: eight touching one-character boxes are one group, labelled with the drop cap rejoined and the D/M/Y hint", async () => {
  const outline = await readPdfForm((await fixture).bytes);
  const cells = outline.fields.filter((f) => f.charGroup);
  assert.deepEqual(cells.map((f) => f.name).sort(), Array.from({ length: 8 }, (_, i) => `Text Field ${20 + i}`).sort());
  assert.ok(cells.every((f) => f.charGroup === "Text Field 20"));
  assert.equal(cells[0].nearbyText, "Date of diagnosis (dd/mm/yyyy) | DDMMYYYY");
  for (const name of ["Text Field 3", "Text Field 4", "Text Field 15", "Treatment Row1"]) {
    assert.equal(outline.fields.find((f) => f.name === name)?.charGroup, undefined, `${name} is not a character box`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Mapping (rules mode → post-validation) and the outline the live analysis sees
 * ----------------------------------------------------------------------------------------------*/

test("rules mode: radio labels, one question per option group / Yes-No pair / multi-widget box, one date for the character boxes", async () => {
  const outline = await readPdfForm((await fixture).bytes);
  const parsed: ParsedForm = { kind: "pdf_acroform", pdf: outline, warnings: [] };
  const res = postValidateFields(parsed, proposeFieldsByRules(parsed), { confidenceCap: "low" });
  const byField = (name: string) => res.fields.find((f) => formAnchorPdfFieldNames(f.anchor).includes(name))!;

  const title = byField("Radio Button 1");
  assert.equal(title.answerType, "single_choice");
  assert.deepEqual(title.options, ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other (please state)"], "printed options, in reading order");
  assert.deepEqual(title.anchor.kind === "pdf_field" && title.anchor.optionLabels, ["Other (please state)", "Dr", "Mr", "Ms", "Mrs", "Miss"]);

  const referred = byField("Check Box 13");
  assert.equal(referred.answerType, "yes_no");
  assert.deepEqual(referred.options, ["Yes", "No"]);
  assert.deepEqual(referred.anchor, { kind: "pdf_field", fieldName: "Check Box 13", fieldType: "checkbox", options: ["no", "Yes"], optionLabels: ["No", "Yes"] });

  const type = byField("Check Box 4");
  assert.equal(type.label, "Therapist type");
  assert.equal(type.answerType, "single_choice");
  assert.deepEqual(
    type.anchor.kind === "pdf_field" && type.anchor.optionFields,
    [
      { option: "Physiotherapist", fieldName: "Check Box 4" },
      { option: "Chiropractor", fieldName: "Check Box 5" },
      { option: "Osteopath", fieldName: "Check Box 6" },
    ],
  );
  assert.equal(byField("Check Box 6"), type, "all three boxes belong to the one question");

  const contact = byField("Check Box 10");
  assert.equal(contact.label, "Please tick your preferred method of contact");
  assert.deepEqual(contact.options, ["Telephone number", "Email"], "options from the boxes to the left");

  const insured = byField("Check Box5");
  assert.equal(insured.answerType, "yes_no");
  assert.match(insured.label, /^Do you have any other health insurance/);
  assert.deepEqual(insured.anchor.kind === "pdf_field" && insured.anchor.optionFields, [
    { option: "Yes", fieldName: "Check Box5" },
    { option: "No", fieldName: "Check Box6" },
  ]);

  // A checklist stays two separate tick boxes.
  assert.notEqual(byField("Check Box 2"), byField("Check Box 3"));
  assert.equal(byField("Check Box 2").answerType, "checkbox");

  const diagnosed = byField("Text Field 23");
  assert.equal(diagnosed.label, "Date of diagnosis");
  assert.equal(diagnosed.answerType, "date");
  assert.deepEqual(diagnosed.anchor, { kind: "pdf_char_fields", fieldNames: Array.from({ length: 8 }, (_, i) => `Text Field ${20 + i}`), format: "DDMMYYYY" });

  // Every field is used exactly once, and the map passes the confirmation checks.
  const used = res.fields.flatMap((f) => formAnchorPdfFieldNames(f.anchor));
  assert.equal(new Set(used).size, used.length);
  assert.deepEqual(used.slice().sort(), outline.fields.map((f) => f.name).sort());
  assert.equal(res.dropped, 0);
  assert.deepEqual(checkFormDefinition(formOf(res.fields)), []);
});

test("post-validation: a live proposal naming one character box maps the whole run; repeats of its boxes are dropped", async () => {
  const outline = await readPdfForm((await fixture).bytes);
  const parsed: ParsedForm = { kind: "pdf_acroform", pdf: outline, warnings: [] };
  const base = {
    section: "",
    guidance: "",
    options: [],
    placeholderText: "",
    optionAnchors: [],
    overlay: { page: 0, x: 0, y: 0, width: 0, height: 0 },
    fillSource: "notes_narrative" as const,
    registrationPath: "none" as const,
    computedFact: "none" as const,
    computedFormat: "none" as const,
    signoffPart: "none" as const,
    required: true,
    confidence: "high" as const,
    note: "",
  };
  const res = postValidateFields(parsed, [
    { ...base, label: "Date of diagnosis", answerType: "short_text", anchorTarget: "pdf_field", anchorRef: "Text Field 22" },
    { ...base, label: "Date of diagnosis (month)", answerType: "short_text", anchorTarget: "pdf_field", anchorRef: "Text Field 23" },
  ]);
  assert.equal(res.fields.length, 1);
  assert.equal(res.fields[0].answerType, "date", "the boxes are printed D D M M Y Y Y Y");
  assert.deepEqual(res.fields[0].anchor.kind === "pdf_char_fields" && res.fields[0].anchor.fieldNames.length, 8);
  assert.equal(res.dropped, 1);
});

test("the outline for the live analysis: printed labels per value, the character boxes as one answer space, never split across chunks", async () => {
  const outline = await readPdfForm((await fixture).bytes);
  const text = renderPdfOutline(outline, "pdf_acroform");
  assert.match(text, /field "Radio Button 1" radio .* options=\["Choice1",.*\] printed=\["Other \(please state\)","Dr","Mr","Ms","Mrs","Miss"\]/);
  assert.match(text, /field "Check Box 13" checkbox .* options=\["no","Yes"\] printed=\["No","Yes"\]/);
  assert.match(text, /field "Text Field 20" character-boxes=8 \(one character per box, "Text Field 20" to "Text Field 27": map as ONE question/);
  assert.doesNotMatch(text, /field "Text Field 21"/);
  for (const chunk of chunkPdfFields(outline)) {
    if (chunk.kind !== "fields") continue;
    const cells = chunk.names.filter((n) => /^Text Field 2\d$/.test(n) && Number(n.slice(11)) >= 20);
    assert.ok(cells.length === 0 || cells.length === 8, "a run of character boxes stays in one chunk");
  }
});

/* ------------------------------------------------------------------------------------------------
 * Filling
 * ----------------------------------------------------------------------------------------------*/

test("fill: the radio button printed with the answer is selected, through its label (Mrs → Choice5, not Choice2)", async () => {
  const { form, warnings } = await fill({ "F-01": { text: "Mrs", value: "Mrs" } });
  assert.equal(form.getRadioGroup("Radio Button 1").getSelected(), "Choice5");
  assert.deepEqual(warnings, []);
  for (const [answer, want] of [
    ["Miss", "Choice6"],
    ["Other (please state)", "Choice1"],
    ["Dr", "Choice2"],
  ] as const) {
    assert.equal((await fill({ "F-01": { text: answer, value: answer } })).form.getRadioGroup("Radio Button 1").getSelected(), want, answer);
  }
});

test("fill: a tick box with a widget per option ticks the widget of the answer, and Yes / No both work", async () => {
  const yes = await fill({ "F-04": { text: "Yes", value: true } });
  const cb = yes.form.getCheckBox("Check Box 13");
  assert.equal(String(cb.acroField.dict.get(PDFName.of("V"))), "/Yes");
  assert.deepEqual(widgetStates(cb), ["no->Off", "Yes->Yes"]);
  const no = await fill({ "F-04": { text: "No", value: false } });
  assert.deepEqual(widgetStates(no.form.getCheckBox("Check Box 13")), ["no->no", "Yes->Off"]);
  assert.equal(String(no.form.getCheckBox("Check Box 13").acroField.dict.get(PDFName.of("V"))), "/no");
});

test("fill: a ticked box is redrawn with a visible tick (the form's own white tick is replaced)", async () => {
  const { whiteAppearances } = await fixture;
  const { form } = await fill({ "F-04": { text: "Yes", value: true } });
  const yesWidget = (form.getCheckBox("Check Box 13") as PDFCheckBox).acroField.getWidgets()[1];
  const normal = yesWidget.dict.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"), PDFDict);
  const ref = normal.get(PDFName.of("Yes"));
  assert.ok(ref instanceof PDFRef);
  assert.ok(!whiteAppearances.includes(ref.toString()), "the white on-appearance is gone");
  const stream = yesWidget.dict.context.lookup(ref);
  assert.ok(stream instanceof PDFRawStream);
  const ops = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.match(ops, /0 0 0 RG\s+1\.5 w[\s\S]*\bS\b/, "the tick is stroked in black");
  assert.doesNotMatch(ops, /1 G/, "nothing is drawn over it in white");
});

test("fill (pdf.js render): the ticked widget shows dark pixels, the cleared one does not", async (t) => {
  let createCanvas: (w: number, h: number) => { getContext(k: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
  try {
    ({ createCanvas } = (await import("@napi-rs/canvas")) as unknown as { createCanvas: typeof createCanvas });
  } catch {
    t.skip("@napi-rs/canvas is not installed here");
    return;
  }
  const { out } = await fill({ "F-04": { text: "Yes", value: true } }, { flatten: true, draft: false });
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(out));
  try {
    const page = await (await task.promise).getPage(1);
    const scale = 3;
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise;
    const dark = (r: { x: number; y: number; width: number; height: number }) => {
      const x = Math.round((r.x + 2) * scale);
      const y = Math.round((vp.height / scale - (r.y + r.height - 2)) * scale);
      const { data } = ctx.getImageData(x, y, Math.round((r.width - 4) * scale), Math.round((r.height - 4) * scale));
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 200) n += 1;
      return n;
    };
    assert.ok(dark(FIXTURE_RECTS.referredYes) > 10, "a tick is visible in the Yes box");
    assert.equal(dark(FIXTURE_RECTS.referredNo), 0, "the No box stays clear");
  } finally {
    await task.destroy();
  }
});

test("fill: one question across separate tick boxes ticks the matching box and clears the others", async () => {
  const { form } = await fill({ "F-05": { text: "Chiropractor", value: "Chiropractor" }, "F-06": { text: "No", value: false } });
  assert.deepEqual(
    ["Check Box 4", "Check Box 5", "Check Box 6"].map((n) => form.getCheckBox(n).isChecked()),
    [false, true, false],
  );
  assert.equal(form.getCheckBox("Check Box5").isChecked(), false, "No: the Yes box is clear");
  assert.equal(form.getCheckBox("Check Box6").isChecked(), true, "…and the No box ticked");
  const yes = await fill({ "F-06": { text: "Yes", value: true } });
  assert.deepEqual([yes.form.getCheckBox("Check Box5").isChecked(), yes.form.getCheckBox("Check Box6").isChecked()], [true, false]);
  // No answer leaves the boxes alone; an answer that is not an option warns and ticks nothing.
  const none = await fill({ "F-05": { text: "Podiatrist", value: "Podiatrist" } });
  assert.ok(none.warnings.some((w) => /F-05 .*does not match any of the form's tick boxes/.test(w)));
  assert.ok(["Check Box 4", "Check Box 5", "Check Box 6"].every((n) => !none.form.getCheckBox(n).isChecked()));
});

test("fill: dates in 8 / 6-character boxes are written DDMMYYYY / DDMMYY – never cut to “14/02/19”", async () => {
  const { form, errors, warnings } = await fill({ "F-02": ANSWERS["F-02"], "F-08": ANSWERS["F-08"] });
  assert.equal(form.getTextField("Text Field 3").getText(), "14021991");
  assert.equal(form.getTextField("Text Field 30").getText(), "091026");
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("fill: one character per box for a date in character boxes", async () => {
  const { form, errors } = await fill({ "F-07": ANSWERS["F-07"] });
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => form.getTextField(`Text Field ${20 + i}`).getText()),
    ["0", "2", "0", "9", "2", "0", "2", "6"],
  );
  assert.deepEqual(errors, []);
});

test("fill: a value too long for its box loses spaces first; anything still cut is an ERROR, not a warning", async () => {
  const fits = await fill({ "F-03": { text: "NA 4471 09" } });
  assert.equal(fits.form.getTextField("Text Field 4").getText(), "NA447109");
  assert.deepEqual(fits.errors, []);
  assert.ok(fits.warnings.some((w) => /F-03 .*without spaces/.test(w)));
  const cut = await fill({ "F-03": { text: "NA-4471-0912-77" } });
  assert.equal(cut.errors.length, 1);
  assert.match(cut.errors[0], /^F-03 .*at most 8 characters, so “NA-4471-0912-77” would be written as “NA447109” – the completed form would be wrong/);
});

test("fill: a single-line cell tall enough for two lines wraps; a cut answer keeps its leading words with a short marker", async () => {
  const two = await fill({ "F-09": ANSWERS["F-09"] });
  const cell = two.form.getTextField("Treatment Row1");
  assert.equal(cell.getText(), "Physiotherapy – follow-up treatment session (30 min)");
  assert.equal(cell.isMultiline(), true, "written on two lines");
  assert.deepEqual(two.warnings, []);

  const long = await fill({ "F-09": { text: "Physiotherapy – initial assessment and treatment session including an exercise programme, advice and a written home exercise plan" } });
  const text = long.form.getTextField("Treatment Row1").getText() ?? "";
  assert.match(text, /^Physiotherapy – initial assessment .*… \(see continuation sheet\)$/);
  assert.ok(long.warnings.some((w) => /F-09 .*continuation sheet/.test(w)));

  const narrow = await fill({ "F-10": { text: "£45.00 paid by card on the day of the session" } });
  const amount = narrow.form.getTextField("Amount Row1").getText() ?? "";
  assert.match(amount, /^£45\.00/, `leading words kept: “${amount}”`);
  assert.doesNotMatch(amount, /^\(?continued/);
});

/* ------------------------------------------------------------------------------------------------
 * Final render
 * ----------------------------------------------------------------------------------------------*/

test("renderFormFile: a cut value is listed first on a draft and stops the final copy (422 FORM_INVALID)", async () => {
  const bytes = (await fixture).bytes;
  const file = decodeFormFile(Buffer.from(bytes).toString("base64"));
  const form = formOf(ALL, file.sha256);
  const answers: FormFillAnswers = { ...ANSWERS, "F-03": { text: "NA-4471-0912-77" } };
  const draft = await renderFormFile({ form, file, answers, draft: true, format: "original" });
  assert.equal(draft.errors?.length, 1);
  assert.match(draft.warnings[0], /^F-03 .*would be wrong/);
  await assert.rejects(renderFormFile({ form, file, answers, draft: false, format: "original" }), (err) => err instanceof HttpError && err.status === 422 && err.init.code === "FORM_INVALID");
  // Without the cut value the final copy is made, flattened.
  const final = await renderFormFile({ form, file, answers: ANSWERS, draft: false, format: "original" });
  assert.equal(final.errors, undefined);
  assert.equal((await PDFDocument.load(final.bytes)).getForm().getFields().length, 0);
});

test("answer-space keys: plain fields keep “pdf:<name>”; option groups and character boxes name every box", () => {
  assert.equal(formAnchorKey(DOB.anchor), "pdf:Text Field 3");
  assert.equal(formAnchorKey(REFERRED.anchor), "pdf:Check Box 13");
  assert.equal(formAnchorKey(INSURED.anchor), "pdfopts:Check Box5+Check Box6");
  assert.equal(formAnchorKey(DIAGNOSED.anchor), `pdfchars:${Array.from({ length: 8 }, (_, i) => `Text Field ${20 + i}`).join("+")}`);
  assert.deepEqual(checkFormDefinition(formOf(ALL)), []);
  const broken = formOf([
    { ...DIAGNOSED, answerType: "short_text" },
    { ...INSURED, anchor: { ...INSURED.anchor, optionFields: [{ option: "Yes", fieldName: "Check Box5" }, { option: "No", fieldName: "Check Box5" }] } as FormAnchor },
  ]);
  const problems = checkFormDefinition(broken);
  assert.ok(problems.some((p) => /F-07 .*answer type must be a date/.test(p)));
  assert.ok(problems.some((p) => /F-06 .*linked to more than one option/.test(p)));
});
