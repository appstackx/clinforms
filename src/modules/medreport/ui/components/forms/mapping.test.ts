import { test } from "node:test";
import assert from "node:assert/strict";
import { FormFieldSchema } from "../../../core/schemas";
import type { FormDefinition, FormField } from "../../../core/types";
import {
  anchorFromPick,
  describeAnchor,
  describeBlock,
  fillSourceOfKind,
  formatOptionFields,
  newField,
  nextFieldId,
  parseFieldNames,
  parseOptionFields,
  parseOptions,
  plainAnchorDescription,
  withOptionFields,
  withOptionLabel,
} from "./mapping";

test("describes Word block IDs for people (1-based)", () => {
  assert.equal(describeBlock("p12"), "Paragraph 13");
  assert.equal(describeBlock("t1.r3.c1"), "Table 2, row 4, cell 2");
  assert.equal(describeBlock("t0.r0.c0.t1.r2.c0.p1"), "Table 1, row 1, cell 1 › nested table 2, row 3, cell 1, line 2");
  assert.equal(describeAnchor({ kind: "docx", target: "replace_placeholder", blockId: "p4", placeholderText: "____" }), "Replaces “____” – Paragraph 5");
  assert.equal(describeAnchor({ kind: "pdf_field", fieldName: "txtPrognosis", fieldType: "text" }), "PDF field “txtPrognosis” (text)");
});

test("new fields get the next ID and a valid shape for each form kind", () => {
  const form = { kind: "docx", fields: [{ id: "F-01" }, { id: "F-09" }, { id: "F-10" }] } as unknown as FormDefinition;
  assert.equal(nextFieldId(form), "F-11");
  for (const kind of ["docx", "pdf_acroform", "pdf_flat"] as const) {
    const f = newField({ kind, fields: [] }, "Section B");
    assert.equal(f.id, "F-01");
    assert.ok(FormFieldSchema.safeParse(f).success, kind);
  }
});

test("a picked location becomes the field's anchor", () => {
  const cell = anchorFromPick({ kind: "docx", target: "after_paragraph", blockId: "p0" }, { kind: "docx", blockId: "t2.r1.c1", isCell: true, text: "" });
  assert.deepEqual(cell, { kind: "docx", target: "table_cell", blockId: "t2.r1.c1" });
  const kept = anchorFromPick({ kind: "docx", target: "replace_placeholder", blockId: "p3", placeholderText: "[…]" }, { kind: "docx", blockId: "p7", isCell: false, text: "" });
  assert.deepEqual(kept, { kind: "docx", target: "replace_placeholder", blockId: "p7", placeholderText: "[…]" });
  const pdf = anchorFromPick({ kind: "pdf_field", fieldName: "x", fieldType: "text" }, { kind: "pdf_field", fieldName: "radFit", fieldType: "radio", options: ["Yes", "No"] });
  assert.deepEqual(pdf, { kind: "pdf_field", fieldName: "radFit", fieldType: "radio", options: ["Yes", "No"] });
  const overlay = anchorFromPick({ kind: "pdf_overlay", page: 1, x: 0, y: 0, width: 100, height: 20 }, { kind: "pdf_overlay", page: 2, x: 72, y: 500 });
  assert.deepEqual(overlay, { kind: "pdf_overlay", page: 2, x: 72, y: 483, width: 100, height: 20 });
});

test("fill source switching and option parsing", () => {
  const current: FormField["fillSource"] = { kind: "notes_narrative" };
  assert.deepEqual(fillSourceOfKind("registration", current), { kind: "registration", path: "patient.fullName" });
  assert.deepEqual(fillSourceOfKind("notes_narrative", current), current);
  assert.deepEqual(parseOptions(" Yes \n\nNo\nYes"), ["Yes", "No"]);
  assert.equal(parseOptions("  \n"), undefined);
});

test("fillable-PDF answer spaces of several fields: descriptions, editing and picking", () => {
  const chars = { kind: "pdf_char_fields" as const, fieldNames: ["Text Field 3", "Text Field 4", "Text Field 5", "Text Field 6", "Text Field 7", "Text Field 8", "Text Field 9", "Text Field 10"], format: "DDMMYYYY" as const };
  assert.equal(describeAnchor(chars), "8 character boxes “Text Field 3” to “Text Field 10” (date as DDMMYYYY)");
  assert.equal(plainAnchorDescription({ anchor: chars, label: "Patient's date of birth" }), "The date written DD MM YYYY, one digit in each of the 8 boxes for “Patient's date of birth”");
  const yesNo = withOptionFields({ kind: "pdf_field", fieldName: "x", fieldType: "text" }, parseOptionFields("Yes = Check Box5\nNo = Check Box6\nnonsense line"));
  assert.deepEqual(yesNo, {
    kind: "pdf_field",
    fieldName: "Check Box5",
    fieldType: "checkbox",
    optionFields: [
      { option: "Yes", fieldName: "Check Box5" },
      { option: "No", fieldName: "Check Box6" },
    ],
  });
  assert.equal(plainAnchorDescription({ anchor: yesNo, label: "Other insurance?" }), "Ticks one of the boxes “Yes” / “No” (the others are left clear)");
  assert.equal(describeAnchor(yesNo), "PDF tick boxes “Check Box5” (Yes) / “Check Box6” (No)");
  assert.equal(formatOptionFields([{ option: "Yes", fieldName: "Check Box 13", onValue: "Yes" }, { option: "No", fieldName: "Check Box 13", onValue: "no" }]), "Yes = Check Box 13 [Yes]\nNo = Check Box 13 [no]");
  assert.deepEqual(parseOptionFields("No = Check Box 13 [no]"), [{ option: "No", fieldName: "Check Box 13", onValue: "no" }]);
  assert.equal(parseOptionFields("\n"), undefined);
  assert.deepEqual(withOptionFields(yesNo as Extract<typeof yesNo, { kind: "pdf_field" }>, undefined), { kind: "pdf_field", fieldName: "Check Box5", fieldType: "checkbox" });
  assert.deepEqual(parseFieldNames("A, B\nC\n\n"), ["A", "B", "C"]);

  const radio = { kind: "pdf_field" as const, fieldName: "Radio Button 1", fieldType: "radio" as const, options: ["Choice1", "Choice2"] };
  const labelled = withOptionLabel(radio, 1, "Dr");
  assert.deepEqual(labelled, { ...radio, optionLabels: ["", "Dr"] });
  assert.equal(describeAnchor(labelled), "PDF field “Radio Button 1” (radio): Choice1 = ?, Choice2 = Dr");
  assert.deepEqual(withOptionLabel(labelled as typeof radio, 1, ""), radio, "no labels left → none kept");

  // Picking one of the group's own boxes keeps the group; another field replaces it.
  assert.equal(anchorFromPick(chars, { kind: "pdf_field", fieldName: "Text Field 6", fieldType: "text" }), chars);
  assert.equal(anchorFromPick(yesNo, { kind: "pdf_field", fieldName: "Check Box6", fieldType: "checkbox" }), yesNo);
  assert.deepEqual(anchorFromPick(chars, { kind: "pdf_field", fieldName: "Text Field 40", fieldType: "text" }), { kind: "pdf_field", fieldName: "Text Field 40", fieldType: "text" });
});
