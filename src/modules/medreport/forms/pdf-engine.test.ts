/**
 * PDF engine unit tests (forms/pdf-outline.ts, pdf-fill.ts): AcroForm reading with nearby labels,
 * filling text / multi-line / tick box / radio / dropdown fields, flattening, DRAFT watermark,
 * continuation sheet for long answers, flat-PDF overlays and Windows-1252 transliteration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { HttpError } from "../api/http";
import { fillPdf, makeEncoder } from "./pdf-fill";
import { readPdfForm } from "./pdf-outline";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";

async function fillableForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  page.drawText("Claimant name", { x: 40, y: 760, size: 9, font });
  form.createTextField("name").addToPage(page, { x: 120, y: 754, width: 200, height: 18, font });
  page.drawText("Prognosis", { x: 40, y: 720, size: 9, font });
  const prog = form.createTextField("prognosis");
  prog.enableMultiline();
  prog.addToPage(page, { x: 40, y: 640, width: 300, height: 70, font });
  form.createCheckBox("discharged").addToPage(page, { x: 40, y: 600, width: 11, height: 11 });
  page.drawText("Discharged", { x: 56, y: 602, size: 9, font });
  const rg = form.createRadioGroup("fit");
  rg.addOptionToPage("Yes", page, { x: 40, y: 570, width: 11, height: 11 });
  rg.addOptionToPage("No", page, { x: 100, y: 570, width: 11, height: 11 });
  page.drawText("Fit for work?", { x: 40, y: 590, size: 9, font });
  const dd = form.createDropdown("outcome");
  dd.addOptions(["Goals achieved", "Plateaued", "Self-discharged"]);
  dd.addToPage(page, { x: 40, y: 530, width: 150, height: 18, font });
  return doc.save();
}

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function form(fields: FormField[], kind: FormDefinition["kind"] = "pdf_acroform"): FormDefinition {
  return {
    id: "frm_pdf_test",
    tenantId: "demo",
    referrer: { name: "Test Insurer (fictional)", type: "insurer" },
    title: "Test PDF form",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind,
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

const FIELDS = [
  field("F-01", "Claimant name", { kind: "pdf_field", fieldName: "name", fieldType: "text" }),
  field("F-02", "Prognosis", { kind: "pdf_field", fieldName: "prognosis", fieldType: "text" }, { answerType: "long_text" }),
  field("F-03", "Discharged", { kind: "pdf_field", fieldName: "discharged", fieldType: "checkbox" }, { answerType: "checkbox" }),
  field("F-04", "Fit for work?", { kind: "pdf_field", fieldName: "fit", fieldType: "radio", options: ["Yes", "No"] }, { answerType: "yes_no", options: ["Yes", "No"] }),
  field("F-05", "Outcome", { kind: "pdf_field", fieldName: "outcome", fieldType: "dropdown" }, { answerType: "single_choice", options: ["Goals achieved", "Plateaued", "Self-discharged"] }),
];

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  await task.destroy();
  return out;
}

test("readPdfForm: fields, types, options, page, rect and nearby labels; flat PDFs classified", async () => {
  const outline = await readPdfForm(await fillableForm());
  assert.equal(outline.classification, "acroform");
  assert.equal(outline.pages, 1);
  const by = Object.fromEntries(outline.fields.map((f) => [f.name, f]));
  assert.equal(by.name.type, "text");
  assert.match(by.name.nearbyText, /^Claimant name/);
  assert.match(by.prognosis.nearbyText, /Prognosis/);
  assert.equal(by.discharged.type, "checkbox");
  assert.match(by.discharged.nearbyText, /Discharged/);
  assert.equal(by.fit.type, "radio");
  assert.deepEqual(by.fit.options, ["Yes", "No"]);
  assert.equal(by.outcome.type, "dropdown");
  assert.equal(by.name.page, 1);
  assert.ok(Math.abs(by.name.rect.x - 120) < 2 && by.name.rect.width > 195);
  assert.ok(outline.pageText[0].items.some((i) => i.str === "Prognosis"));

  const flat = await PDFDocument.create();
  flat.addPage([595, 842]).drawText("Prognosis:", { x: 40, y: 700, size: 10 });
  const flatOutline = await readPdfForm(await flat.save());
  assert.equal(flatOutline.classification, "flat");
  assert.ok(flatOutline.warnings.some((w) => /no fillable fields/.test(w)));
});

test("readPdfForm: not a PDF → 422 FORM_INVALID", async () => {
  await assert.rejects(readPdfForm(new TextEncoder().encode("%PDF-1.7 broken")), (err) => err instanceof HttpError && err.init.code === "FORM_INVALID");
});

test("fillPdf DRAFT: fields set (not flattened), watermark on every page, sign-off untouched", async () => {
  const warnings: string[] = [];
  const out = await fillPdf(
    await fillableForm(),
    form(FIELDS),
    {
      "F-01": { text: "Megan Hart" },
      "F-02": { text: "Good recovery expected → full function ≥ 3 months." },
      "F-03": { text: "Yes", value: true },
      "F-04": { text: "No", value: false },
      "F-05": { text: "Plateaued", value: "Plateaued" },
    },
    { draft: true, flatten: false, onWarning: (m) => warnings.push(m) },
  );
  assert.deepEqual(warnings, []);
  const doc = await PDFDocument.load(out);
  const f = doc.getForm();
  assert.equal(f.getTextField("name").getText(), "Megan Hart");
  assert.equal(f.getTextField("prognosis").getText(), "Good recovery expected -> full function >= 3 months.", "transliterated to Windows-1252");
  assert.equal(f.getCheckBox("discharged").isChecked(), true);
  assert.equal(f.getRadioGroup("fit").getSelected(), "No");
  assert.deepEqual(f.getDropdown("outcome").getSelected(), ["Plateaued"]);
  const text = (await pageTexts(out)).join(" ");
  assert.match(text, /DRAFT - NOT APPROVED/);
  assert.match(text, /awaiting clinician approval/);
});

test("fillPdf FINAL: flattened (no fields left), answers printed, no watermark", async () => {
  const out = await fillPdf(await fillableForm(), form(FIELDS), { "F-01": { text: "Daniel Brooks" }, "F-04": { value: true, text: "Yes" } }, { draft: false, flatten: true });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getForm().getFields().length, 0);
  const text = (await pageTexts(out)).join(" ");
  assert.match(text, /Daniel Brooks/);
  assert.doesNotMatch(text, /DRAFT/);
  for (const page of doc.getPages()) assert.equal(page.node.Annots()?.size() ?? 0, 0, "no dangling widget annotations");
});

test("fillPdf: an answer too long for its box continues on a continuation sheet, with a warning", async () => {
  const long = Array.from({ length: 160 }, (_, i) => `Sentence ${i + 1} of a very long recorded answer.`).join(" ");
  const warnings: string[] = [];
  const out = await fillPdf(await fillableForm(), form(FIELDS), { "F-02": { text: long } }, { draft: false, flatten: true, onWarning: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /F-02 .*continuation sheet/);
  const pages = await pageTexts(out);
  assert.ok(pages.length >= 2);
  assert.match(pages[0], /continued on the continuation sheet/);
  assert.match(pages.slice(1).join(" "), /Continuation sheet/);
  assert.match(pages.slice(1).join(" "), /Sentence 160 of a very long recorded answer\./);
});

test("fillPdf: flat PDF overlays draw the answer in its box; unknown fields warn", async () => {
  const flat = await PDFDocument.create();
  flat.addPage([595, 842]).drawText("Prognosis:", { x: 40, y: 700, size: 10 });
  const fields = [
    field("F-01", "Prognosis", { kind: "pdf_overlay", page: 1, x: 110, y: 640, width: 300, height: 70 }, { answerType: "long_text" }),
    field("F-02", "Missing", { kind: "pdf_field", fieldName: "nope", fieldType: "text" }),
  ];
  const warnings: string[] = [];
  const out = await fillPdf(await flat.save(), form(fields, "pdf_flat"), { "F-01": { text: "Expected to settle within 3 months." }, "F-02": { text: "x" } }, { draft: false, flatten: true, onWarning: (m) => warnings.push(m) });
  assert.match((await pageTexts(out))[0], /Expected to settle within 3 months\./);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no field called “nope”/);
});

test("makeEncoder keeps Windows-1252 text and transliterates the rest", async () => {
  const doc = await PDFDocument.create();
  const enc = makeEncoder(await doc.embedFont(StandardFonts.Helvetica));
  assert.equal(enc("Flexion 30° – “mild” £5 café"), "Flexion 30° – “mild” £5 café");
  assert.equal(enc("NDI 42% → 12% ✓ ☐"), "NDI 42% -> 12% Yes [ ]");
  assert.equal(enc("Łódź"), "Lódz", "ó is in Windows-1252; Ł and ź are not");
});

test("fillPdf: characters the form's font cannot print are reported, never silently replaced", async () => {
  const warnings: string[] = [];
  await fillPdf(await fillableForm(), form(FIELDS), { "F-01": { text: "Wang 王 Ωmega" } }, { draft: false, flatten: true, onWarning: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^F-01 .*2 characters \(“王”, “Ω”\) cannot be printed/);
});

test("fillPdf: long answers are never shrunk below 8 pt – they continue on the continuation sheet", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long answer.`).join(" ");
  const warnings: string[] = [];
  const out = await fillPdf(await fillableForm(), form(FIELDS), { "F-02": { text: long } }, { draft: true, flatten: false, onWarning: (m) => warnings.push(m) });
  const f = (await PDFDocument.load(out)).getForm();
  const da = f.getTextField("prognosis").acroField.getDefaultAppearance() ?? "";
  const size = Number(/(\d+(?:\.\d+)?)\s+Tf/.exec(da)?.[1] ?? "0");
  assert.ok(size >= 8, `font size ${size}`);
  assert.ok(warnings.some((w) => /continuation sheet/.test(w)));
});
