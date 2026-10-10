/**
 * Unit tests for the AcroForm answer helpers (forms/pdf-acro-fill.ts) and the text fitting of
 * forms/pdf-fill.ts: option choice by printed label, radio export values through optionLabels, dates in
 * 8 / 6-character boxes, spaces and separators taken out before a value is cut, one character per box,
 * unreadable (white) tick colours, two-line single-line boxes and the continuation markers, and text
 * fields whose default appearance is inherited (fillPdf must not throw on them).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import type { FormDefinition, PdfFieldAnchor } from "../core/types";
import {
  charFieldTexts,
  chooseOptionIndex,
  dateDigits,
  ensureTextFieldDA,
  fitMaxLength,
  isLightDaColour,
  labelsForExportValues,
  pickExportValue,
  wantedOf,
} from "./pdf-acro-fill";
import { fillPdf, fitText } from "./pdf-fill";

const BUPA_EXPORTS = ["Choice1", "Choice2", "Choice3", "Choice4", "Choice5", "Choice6"];
const BUPA_ANCHOR: PdfFieldAnchor = {
  kind: "pdf_field",
  fieldName: "Radio Button 1",
  fieldType: "radio",
  options: BUPA_EXPORTS,
  optionLabels: ["Other (please state)", "Dr", "Mr", "Ms", "Mrs", "Miss"],
};
const READING_ORDER = ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other (please state)"];

test("chooseOptionIndex: booleans pick Yes / No, text picks its option, unknown answers pick nothing", () => {
  assert.equal(chooseOptionIndex(["No", "Yes"], wantedOf({ value: true })), 1);
  assert.equal(chooseOptionIndex(["No", "Yes"], wantedOf({ value: false })), 0);
  assert.equal(chooseOptionIndex(["", ""], wantedOf({ value: true }), ["no", "Yes"]), 1, "falls back to the on-values");
  assert.equal(chooseOptionIndex(["Physiotherapist", "Osteopath"], wantedOf({ text: "osteopath" })), 1);
  assert.equal(chooseOptionIndex(["Physiotherapist", "Other, please specify below"], wantedOf({ text: "Other" })), 1, "start of one option");
  assert.equal(chooseOptionIndex(["Yes", "No"], wantedOf({ text: "Not recorded" })), -1);
  assert.equal(chooseOptionIndex(["Yes", "No"], wantedOf({ text: "" })), -1);
});

test("pickExportValue: the printed answer selects the export value printed with it (Bupa's right-to-left Choice1…6)", () => {
  const field = { options: READING_ORDER };
  assert.equal(pickExportValue(field, BUPA_ANCHOR, { text: "Mrs", value: "Mrs" }, BUPA_EXPORTS), "Choice5");
  assert.equal(pickExportValue(field, BUPA_ANCHOR, { text: "Miss", value: "Miss" }, BUPA_EXPORTS), "Choice6");
  assert.equal(pickExportValue(field, BUPA_ANCHOR, { text: "Other", value: "Other" }, BUPA_EXPORTS), "Choice1");
  assert.equal(pickExportValue({ options: [] }, BUPA_ANCHOR, { text: "Dr" }, BUPA_EXPORTS), "Choice2", "labels stand in for missing options");
  assert.equal(pickExportValue(field, BUPA_ANCHOR, { text: "Professor" }, BUPA_EXPORTS), null);
  assert.equal(pickExportValue(field, BUPA_ANCHOR, { text: "Unknown" }, BUPA_EXPORTS), null);
  // Export values that are the labels themselves, and a yes/no radio answered with a boolean.
  assert.equal(pickExportValue({ options: ["Yes", "No", "Modified duties"] }, null, { text: "Modified duties" }, ["Yes", "No", "Modified duties"]), "Modified duties");
  assert.equal(pickExportValue({ options: ["Yes", "No"] }, null, { value: false, text: "No" }, ["Yes", "No"]), "No");
  // Maps made before printed labels were read: the printed order still stands in for the export order.
  assert.equal(pickExportValue({ options: ["Mr", "Mrs"] }, null, { text: "Mrs" }, ["0", "1"]), "1");
});

test("labelsForExportValues: aligned through the anchor's options, or by position when they are absent", () => {
  assert.deepEqual(labelsForExportValues(BUPA_ANCHOR, ["Choice6", "Choice5"]), ["Miss", "Mrs"]);
  assert.deepEqual(labelsForExportValues({ ...BUPA_ANCHOR, options: undefined }, BUPA_EXPORTS), BUPA_ANCHOR.optionLabels);
  assert.deepEqual(labelsForExportValues({ ...BUPA_ANCHOR, options: undefined }, ["a", "b"]), [], "lengths differ: not aligned");
  assert.deepEqual(labelsForExportValues(null, BUPA_EXPORTS), []);
});

test("fitMaxLength: dates become DDMMYYYY / DDMMYY; spaces then separators go before anything is cut", () => {
  assert.deepEqual(fitMaxLength("14/02/1991", 8, "1991-02-14"), { text: "14021991", compacted: "date", cut: false });
  assert.deepEqual(fitMaxLength("09/10/2026", 6, "2026-10-09"), { text: "091026", compacted: "date", cut: false });
  assert.deepEqual(fitMaxLength("14/02/1991", 10, "1991-02-14"), { text: "14/02/1991", compacted: "", cut: false }, "fits as it is");
  assert.deepEqual(fitMaxLength("AB 12 34 56", 8, null), { text: "AB123456", compacted: "spaces", cut: false });
  assert.deepEqual(fitMaxLength("01632-960/101", 10, null), { text: "01632960101".slice(0, 10), compacted: "separators", cut: true });
  assert.deepEqual(fitMaxLength("MK9-2AB", 6, null), { text: "MK92AB", compacted: "separators", cut: false });
  assert.deepEqual(fitMaxLength("12", 3, null), { text: "12", compacted: "", cut: false });
  assert.equal(dateDigits("2026-10-09", "DDMMYYYY"), "09102026");
  assert.equal(dateDigits("2026-10-09", "DDMMYY"), "091026");
});

test("charFieldTexts: one character per box; a date format needs a date; too many characters is reported", () => {
  const date8 = { kind: "pdf_char_fields" as const, fieldNames: ["a", "b", "c", "d", "e", "f", "g", "h"], format: "DDMMYYYY" as const };
  assert.deepEqual(charFieldTexts(date8, { text: "14/02/1991", value: "1991-02-14" }, "14/02/1991"), { kind: "ok", chars: Array.from("14021991"), cut: false, value: "14021991" });
  assert.deepEqual(charFieldTexts(date8, { text: "14/02/1991" }, "14/02/1991").kind, "ok", "the text of a date works too");
  assert.deepEqual(charFieldTexts(date8, { text: "soon" }, "soon"), { kind: "not_a_date" });
  assert.deepEqual(charFieldTexts(date8, {}, ""), { kind: "none" });
  const chars = { kind: "pdf_char_fields" as const, fieldNames: ["a", "b", "c", "d", "e", "f"], format: "chars" as const };
  assert.deepEqual(charFieldTexts(chars, { text: "MK9 2AB" }, "MK9 2AB"), { kind: "ok", chars: Array.from("MK92AB"), cut: false, value: "MK92AB" });
  const cut = charFieldTexts(chars, { text: "ABCDEFGH" }, "ABCDEFGH");
  assert.ok(cut.kind === "ok" && cut.cut && cut.chars.join("") === "ABCDEF");
});

test("isLightDaColour: a white or near-white tick colour is caught; dark ones are not", () => {
  assert.equal(isLightDaColour("/ZaDb 0 Tf 1 g"), true);
  assert.equal(isLightDaColour("/ZaDb 0 Tf 0.9 0.9 0.95 rg"), true);
  assert.equal(isLightDaColour("0 0 0 0 k"), true);
  assert.equal(isLightDaColour("/ZaDb 0 Tf 0 g"), false);
  assert.equal(isLightDaColour("1 g /ZaDb 0 Tf 0 0 0.5 rg"), false, "the last colour counts");
  assert.equal(isLightDaColour(""), false);
});

test("fitText: a single-line box tall enough wraps to two lines at 8 pt or more before anything is cut", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const text = "Physiotherapy – follow-up treatment session (30 min)";
  const cell = { width: 176, height: 19 };
  const two = fitText(text, font, cell, 10, false, { allowTwoLines: true, lineHeightFactor: 1.2 });
  assert.deepEqual({ text: two.text, overflow: two.overflow, lines: two.lines }, { text, overflow: false, lines: 2 });
  assert.ok(two.size >= 8);
  // Without two lines allowed (or too low a box) the leading words stay, with the short marker.
  const one = fitText(text, font, cell, 10, false);
  assert.ok(one.overflow);
  assert.match(one.text, /^Physiotherapy.*… \(see continuation sheet\)$/);
  // Fix wave 3: the cut never ends with its own punctuation or dash before the ellipsis ("Physiotherapy –…").
  assert.doesNotMatch(one.text, /[–.,;:]…/);
  const low = fitText(text, font, { width: 176, height: 12 }, 10, false, { allowTwoLines: true, lineHeightFactor: 1.2 });
  assert.equal(low.lines, undefined);
  assert.match(low.text, /… \(see continuation sheet\)$/);
});

test("fitText: never only the marker in a box – shorter markers, then the leading characters of the first word", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  for (const width of [30, 46, 70, 120]) {
    const fit = fitText("Physiotherapy assessment and treatment", font, { width, height: 12 }, 10, false);
    assert.ok(fit.overflow);
    assert.doesNotMatch(fit.text, /^…|^\(|^ /, `width ${width}: “${fit.text}”`);
    assert.ok(font.widthOfTextAtSize(fit.text, 8) <= width, `width ${width}: “${fit.text}” fits`);
  }
  // Multi-line boxes keep the long marker.
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the answer.`).join(" ");
  const multi = fitText(long, font, { width: 200, height: 40 }, 9, true);
  assert.match(multi.text, /^Sentence 1 of the answer\.[\s\S]*… \(continued on the continuation sheet\)$/);
});

test("text fields whose /DA is inherited (widget, parent field, AcroForm) are filled, not a crash", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const names = ["Policy Number", "Widget DA", "No DA anywhere", "Colour only"];
  names.forEach((name, i) => form.createTextField(name).addToPage(page, { x: 100, y: 700 - i * 40, width: 200, height: 18, font }));
  const acroDict = (name: string) => form.getTextField(name).acroField.dict;
  // As on Allianz Care's form: no /DA on the field itself, one on the AcroForm dictionary.
  form.acroForm.dict.set(PDFName.of("DA"), PDFString.of("/Helv 9 Tf 0 0 0.5 rg"));
  acroDict("Policy Number").delete(PDFName.of("DA"));
  acroDict("Widget DA").delete(PDFName.of("DA"));
  form.getTextField("Widget DA").acroField.getWidgets()[0].setDefaultAppearance("/Helv 7 Tf 0 g");
  acroDict("Colour only").set(PDFName.of("DA"), PDFString.of("0.2 g"));
  const bytes = await doc.save();

  // The helper alone: the inherited value is copied onto the field, with a font operator.
  const reloaded = await PDFDocument.load(bytes);
  const f = reloaded.getForm();
  for (const name of names) ensureTextFieldDA(f, f.getTextField(name));
  assert.equal(f.getTextField("Policy Number").acroField.getDefaultAppearance(), "/Helv 9 Tf 0 0 0.5 rg");
  assert.equal(f.getTextField("Widget DA").acroField.getDefaultAppearance(), "/Helv 7 Tf 0 g");
  assert.equal(f.getTextField("Colour only").acroField.getDefaultAppearance(), "/Helv 9 Tf 0 0 0.5 rg", "the form's own font size and colour");

  // End to end: fillPdf writes every box.
  const fields = names.map((name, i) => ({
    id: `F-0${i + 1}`,
    label: name,
    guidance: "",
    answerType: "short_text" as const,
    anchor: { kind: "pdf_field" as const, fieldName: name, fieldType: "text" as const },
    fillSource: { kind: "notes_narrative" as const },
    required: true,
    confidence: "high" as const,
  }));
  const map = {
    id: "frm_da_test",
    tenantId: "demo",
    referrer: { name: "Test Insurer (fictional)", type: "insurer" },
    title: "DA test (fictional)",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-09T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
  } as FormDefinition;
  const answers = Object.fromEntries(fields.map((x) => [x.id, { text: `DEMO-${x.id}` }]));
  // A draft that is not flattened keeps the fields, so their values can be read back.
  const out = await fillPdf(bytes, map, answers, { draft: true, flatten: false });
  const filled = (await PDFDocument.load(out)).getForm();
  for (const x of fields) assert.equal(filled.getTextField(x.anchor.fieldName).getText(), `DEMO-${x.id}`);
});

test("fitText: a field that asks for less than 8 pt still takes a short answer whole, at 8 pt", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assert.deepEqual(fitText("DEMO-F-02", font, { width: 190, height: 14 }, 7, false), { size: 8, text: "DEMO-F-02", overflow: false });
  assert.equal(fitText("A short note.", font, { width: 190, height: 40 }, 6, true).overflow, false);
});

test("tick boxes with no border colour get no drawn border; one-character boxes are centred", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const cb = form.createCheckBox("physio");
  cb.addToPage(page, { x: 40, y: 700, width: 12, height: 12, borderWidth: 1 });
  // As AXA's: /MK /BC [] (transparent) – the box itself is printed on the page.
  cb.acroField.getWidgets()[0].getOrCreateAppearanceCharacteristics().dict.set(PDFName.of("BC"), doc.context.obj([]));
  const names = ["d1", "d2"];
  names.forEach((n, i) => form.createTextField(n).addToPage(page, { x: 100 + i * 16, y: 700, width: 16, height: 16, font }));
  const fields = [
    { id: "F-01", label: "Physiotherapist", guidance: "", answerType: "checkbox" as const, anchor: { kind: "pdf_field" as const, fieldName: "physio", fieldType: "checkbox" as const }, fillSource: { kind: "notes_narrative" as const }, required: true, confidence: "high" as const },
    { id: "F-02", label: "Code", guidance: "", answerType: "short_text" as const, anchor: { kind: "pdf_char_fields" as const, fieldNames: names, format: "chars" as const }, fillSource: { kind: "notes_narrative" as const }, required: true, confidence: "high" as const },
  ];
  const def = { id: "f", tenantId: "demo", referrer: { name: "Test (fictional)", type: "insurer" as const }, title: "t", file: { fileName: "t.pdf", mimeType: "application/pdf" as const, sha256: "0".repeat(64), sizeBytes: 1 }, kind: "pdf_acroform" as const, fields, status: "confirmed" as const, analysis: { mode: "rules" as const, promptVersion: "t", at: "2026-10-01T09:00:00.000Z", warnings: [] }, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" } as FormDefinition;
  const out = await PDFDocument.load(await fillPdf(await doc.save(), def, { "F-01": { text: "Yes", value: true }, "F-02": { text: "A7" } }, { draft: true, flatten: false }));
  const box = out.getForm().getCheckBox("physio").acroField.getWidgets()[0];
  assert.equal(box.getBorderStyle()?.getWidth(), 0, "no black border drawn around the printed box");
  assert.equal(out.getForm().getTextField("d1").getAlignment(), 1, "centred (TextAlignment.Center)");
});

test("character boxes for a date take the clinician's N/A when the date does not apply", () => {
  const anchor = { kind: "pdf_char_fields" as const, fieldNames: ["d1", "d2", "m1", "m2", "y1", "y2", "y3", "y4"], format: "DDMMYYYY" as const };
  assert.deepEqual(charFieldTexts(anchor, { text: "N/A", value: "N/A" }, "N/A"), { kind: "ok", chars: ["N", "/", "A"], cut: false, value: "N/A" });
  assert.deepEqual(charFieldTexts(anchor, { text: "not applicable", value: "not applicable" }, "not applicable").kind, "ok");
  assert.equal(charFieldTexts(anchor, { text: "soon", value: "soon" }, "soon").kind, "not_a_date", "any other word is still not a date");
});
