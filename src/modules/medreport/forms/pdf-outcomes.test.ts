/**
 * bh2 WA2 – PDF fill outcomes (plan WA2 design 1; review 26/10, check-WA2 minor 10), on a FICTIONAL fillable PDF:
 * - outcomes are recorded where the fill meets the problem, never read back from a warning's words: a field not on the
 *   form, an answer none of the options takes, a page that does not exist – fatal on a decided answer;
 * - an answer whose characters the form's font cannot print (they would show as "?") is fatal too;
 * - the table and tick helpers' warnings fail safe: only "continues on the continuation sheet" is informational.
 *
 * Fictional data only; ClinForms' own wording.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { fillPdfReport, helperWarningFault } from "./pdf-fill";

async function fillable(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  page.drawText("Claimant name", { x: 40, y: 760, size: 9, font });
  form.createTextField("name").addToPage(page, { x: 120, y: 754, width: 200, height: 18, font });
  const rg = form.createRadioGroup("fit");
  rg.addOptionToPage("Yes", page, { x: 40, y: 570, width: 11, height: 11 });
  rg.addOptionToPage("No", page, { x: 100, y: 570, width: 11, height: 11 });
  return doc.save();
}

function field(id: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label: `Box ${id}`, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}

function formOf(fields: FormField[]): FormDefinition {
  return {
    id: "frm_pdf_outcomes",
    tenantId: "demo",
    referrer: { name: "Pellham Claims (fictional)", type: "insurer" },
    title: "PDF outcomes (fictional)",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-26T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-26T09:00:00.000Z",
    updatedAt: "2026-10-26T09:00:00.000Z",
  };
}

const FIELDS = [
  field("F-01", { kind: "pdf_field", fieldName: "name", fieldType: "text" }),
  field("F-02", { kind: "pdf_field", fieldName: "nope", fieldType: "text" }),
  field("F-03", { kind: "pdf_field", fieldName: "fit", fieldType: "radio" }, { answerType: "single_choice", options: ["Yes", "No"] }),
  field("F-04", { kind: "pdf_overlay", page: 9, x: 40, y: 40, width: 100, height: 14 }),
];

test("PDF outcomes are recorded where the problem is met: not on the form, no option, no page – fatal; written otherwise", async () => {
  const out = await fillPdfReport(await fillable(), formOf(FIELDS), { "F-01": { text: "Megan Hart" }, "F-02": { text: "x" }, "F-03": { text: "Sometimes" }, "F-04": { text: "y" } }, { draft: false, flatten: true });
  const by = Object.fromEntries(out.outcomes.map((o) => [o.fieldId, o]));
  assert.deepEqual([by["F-01"].outcome, by["F-01"].fatal], ["written", false]);
  assert.deepEqual([by["F-02"].outcome, by["F-02"].fatal, by["F-02"].note], ["not_found", true, "its place is not on this PDF form"]);
  assert.deepEqual([by["F-03"].outcome, by["F-03"].fatal, by["F-03"].note], ["as_printed", true, "the answer matches none of the form's boxes or options"]);
  assert.deepEqual([by["F-04"].outcome, by["F-04"].fatal], ["not_found", true]);
  // Nothing to write: as printed, never fatal (PDF leftBlank is phase 2).
  const blank = await fillPdfReport(await fillable(), formOf(FIELDS), {}, { draft: false, flatten: true });
  assert.ok(blank.outcomes.every((o) => o.outcome === "as_printed" && !o.fatal));
});

test("an answer whose characters the form's font cannot print is fatal – never issued with “?”", async () => {
  const out = await fillPdfReport(await fillable(), formOf(FIELDS.slice(0, 1)), { "F-01": { text: "Wang 王 Ωmega" } }, { draft: false, flatten: true });
  assert.equal(out.outcomes[0].fatal, true);
  assert.match(out.outcomes[0].note ?? "", /2 characters of the answer \(“王”, “Ω”\) cannot be printed with the form's font and would show as “\?”/);
});

test("the helpers' warnings fail safe: only an answer continued on the continuation sheet is informational", () => {
  assert.equal(helperWarningFault("F-01 (“Rows”): the table on the form has 3 rows; the other 2 rows are on the continuation sheet at the end of the form."), null);
  assert.equal(helperWarningFault("F-01 (“Rows”): 2 rows were too long for the table's cells; they are shortened on the form and printed in full on the continuation sheet."), null);
  assert.deepEqual(helperWarningFault("F-01 (“Rows”): page 4 does not exist in this PDF."), { outcome: "not_found", problem: "its place is not on this PDF form" });
  assert.deepEqual(helperWarningFault("F-01 (“Rows”): this PDF has no field called “row9”."), { outcome: "not_found", problem: "its place is not on this PDF form" });
  // A warning in words nobody listed – reworded, or new – refuses rather than passes.
  assert.equal(helperWarningFault("F-01 (“Ticks”): some new problem nobody listed.")?.outcome, "as_printed");
});

test("harden 26/10 (check2-WA2 N-5): a character the font cannot print in a table cell is fatal, as in a single box – never a silent “?”", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("Sessions", { x: 40, y: 400, size: 9, font });
  const bytes = await doc.save();
  const table = field("F-01", { kind: "pdf_overlay_table", page: 1, columns: [{ key: "date", header: "Date", x: 40, width: 80 }, { key: "service", header: "Treatment", x: 120, width: 300 }], rowTops: [380, 360], rowHeight: 20 } as FormAnchor, { answerType: "table", fillSource: { kind: "appointments_table", columns: { date: "date", service: "service" } } as never });
  const box = field("F-02", { kind: "pdf_overlay", page: 1, x: 40, y: 300, width: 300, height: 14 });
  const form = { ...formOf([table, box]), kind: "pdf_flat" as const };
  const bad = "Wrote 痛 on the chart (fictional)";
  const out = await fillPdfReport(bytes, form, { "F-01": { text: "", rows: [{ date: "18/03/2026", service: bad }] }, "F-02": { text: bad } }, { draft: false, flatten: true });
  const by = Object.fromEntries(out.outcomes.map((o) => [o.fieldId, o]));
  assert.equal(by["F-02"].fatal, true, "a single box");
  assert.equal(by["F-01"].fatal, true, "a table cell");
  assert.match(by["F-01"].note ?? "", /cannot be printed with the form's font/);
  const fine = await fillPdfReport(bytes, form, { "F-01": { text: "", rows: [{ date: "18/03/2026", service: "Exercise and advice" }] } }, { draft: false, flatten: true });
  assert.equal(fine.outcomes.find((o) => o.fieldId === "F-01")?.fatal, false);
});
