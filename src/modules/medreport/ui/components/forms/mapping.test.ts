import { test } from "node:test";
import assert from "node:assert/strict";
import { FormFieldSchema } from "../../../core/schemas";
import type { FormDefinition, FormField } from "../../../core/types";
import { anchorFromPick, describeAnchor, describeBlock, fillSourceOfKind, newField, nextFieldId, parseOptions } from "./mapping";

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
