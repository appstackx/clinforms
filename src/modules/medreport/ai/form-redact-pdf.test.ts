/**
 * Data minimisation of PDF outlines (ai/form-redact.ts): "Label: value" counts as a filled-in answer
 * only inside an answer space (a fillable field's box, or a detected answer box) – the printed form text
 * around them ("Telephone numbers: Home", the insurer's "Registered address: …" footer) is the blank form
 * and raises no "already filled in" warning. A flat PDF with no detected boxes keeps the check on all its
 * text, minus footers and option words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PdfFormOutline } from "../core/types";
import { redactParsedForm } from "./form-redact";
import type { ParsedForm } from "./form-outline";

type Item = PdfFormOutline["pageText"][number]["items"][number];
const item = (str: string, x: number, y: number): Item => ({ str, x, y });

const PRINTED: Item[] = [
  item("Telephone numbers: Home", 40, 700),
  item("Registered address: 1 Example Street, Exampletown EX1 1AA. Company registration number: 01234567.", 40, 30),
  item("Registered office: 2 Sample Court, London EC1A 1AA", 40, 20),
];

const strs = (parsed: ParsedForm) => (parsed.kind === "docx" ? [] : parsed.pdf.pageText.flatMap((p) => p.items.map((i) => i.str)));

test("fillable PDF: printed text outside the fields is the blank form; text inside a field box is an answer", () => {
  const pdf: PdfFormOutline = {
    pages: 1,
    fields: [{ name: "name", type: "text", page: 1, rect: { x: 300, y: 640, width: 200, height: 16 }, nearbyText: "Patient's name" }],
    pageText: [{ page: 1, items: [...PRINTED, item("Patient's name", 40, 645)] }],
  };
  const blank = redactParsedForm({ kind: "pdf_acroform", pdf, warnings: [] });
  assert.deepEqual(blank.findings, [], "no false 'already filled in' warning");
  assert.ok(strs(blank.parsed).some((s) => s.startsWith("Telephone numbers: Home")));
  assert.ok(strs(blank.parsed).some((s) => /\[POSTCODE\]/.test(s)), "the referrer's own postcode is still masked, silently");

  // Text printed into the field's box (a form filled in and flattened over the fields).
  const filled = redactParsedForm({ kind: "pdf_acroform", pdf: { ...pdf, pageText: [{ page: 1, items: [...pdf.pageText[0].items, item("Patient name: Megan Hart", 305, 644)] }] }, warnings: [] });
  assert.deepEqual(filled.findings, ["a filled-in “Patient name”"]);
  assert.ok(strs(filled.parsed).includes("Patient name: [removed]"));
  assert.ok(!strs(filled.parsed).some((s) => s.includes("Megan Hart")));
});

test("flat PDF with detected answer boxes: only text inside a box can be an answer", () => {
  const pdf = {
    pages: 1,
    fields: [],
    pageText: [{ page: 1, items: [...PRINTED, item("Claimant name: Megan Hart", 210, 600), item("Claimant name:", 40, 560)] }],
    boxes: [
      { page: 1, x: 200, y: 590, width: 300, height: 20, kind: "box" },
      { page: 1, x: 200, y: 550, width: 300, height: 20, kind: "box" },
    ],
  } as PdfFormOutline;
  const res = redactParsedForm({ kind: "pdf_flat", pdf, warnings: [] });
  assert.deepEqual(res.findings, ["a filled-in “Claimant name”"]);
  const empty = redactParsedForm({ kind: "pdf_flat", pdf: { ...pdf, pageText: [{ page: 1, items: PRINTED }] } as PdfFormOutline, warnings: [] });
  assert.deepEqual(empty.findings, []);
});

test("flat PDF without detected boxes: footers and option words are not answers, typed-in details still are", () => {
  const pdf: PdfFormOutline = { pages: 1, fields: [], pageText: [{ page: 1, items: [...PRINTED, item("Mobile: Work", 40, 680)] }] };
  assert.deepEqual(redactParsedForm({ kind: "pdf_flat", pdf, warnings: [] }).findings, []);
  const typed: PdfFormOutline = { ...pdf, pageText: [{ page: 1, items: [...PRINTED, item("Claimant name: Megan Hart", 40, 600)] }] };
  assert.deepEqual(redactParsedForm({ kind: "pdf_flat", pdf: typed, warnings: [] }).findings, ["a filled-in “Claimant name”"]);
  // A date of birth is patient information wherever it is printed.
  const dob: PdfFormOutline = { ...pdf, pageText: [{ page: 1, items: [item("Date of birth 22/11/1991", 40, 600)] }] };
  assert.deepEqual(redactParsedForm({ kind: "pdf_flat", pdf: dob, warnings: [] }).findings, ["a date of birth"]);
});
