/**
 * Unit tests for the AcroForm answer helpers (forms/pdf-acro-fill.ts) and the text fitting of
 * forms/pdf-fill.ts: option choice by printed label, radio export values through optionLabels, dates in
 * 8 / 6-character boxes, spaces and separators taken out before a value is cut, one character per box,
 * unreadable (white) tick colours, two-line single-line boxes and the continuation markers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PdfFieldAnchor } from "../core/types";
import { charFieldTexts, chooseOptionIndex, dateDigits, fitMaxLength, isLightDaColour, labelsForExportValues, pickExportValue, wantedOf } from "./pdf-acro-fill";
import { fitText } from "./pdf-fill";

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
  assert.deepEqual(fitMaxLength("01908-555/0101", 11, null), { text: "019085550101".slice(0, 11), compacted: "separators", cut: true });
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
  assert.match(one.text, /^Physiotherapy –.*… \(see continuation sheet\)$/);
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
