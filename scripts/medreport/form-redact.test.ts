/**
 * Data minimisation for form analysis (ai/form-redact.ts, forms/pdf-blank.ts): the bundled blank sample
 * forms pass untouched (no false alarm); a form that arrives already filled in has the patient's details
 * removed before anything could reach the AI, and the proposed map carries a warning to upload the
 * blank form.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { analyseFormFile, parseFormFile } from "@/modules/medreport/ai/analyse-form";
import { buildOutlineBlock } from "@/modules/medreport/ai/form-analysis";
import { redactParsedForm, redactText } from "@/modules/medreport/ai/form-redact";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { blankPdfFormValues } from "@/modules/medreport/forms/pdf-blank";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

test("the blank sample forms raise no patient-data finding", async () => {
  for (const sample of SAMPLE_FORMS) {
    const file = decodeFormFile(b64(await sample.loadFile()));
    const parsed = await parseFormFile(file);
    assert.deepEqual(redactParsedForm(parsed).findings, [], sample.id);
    if (parsed.kind === "pdf_acroform") assert.deepEqual((await blankPdfFormValues(file.bytes)).prefilled, [], sample.id);
  }
});

function filledDocx(): Uint8Array {
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:t>Medical report request</w:t></w:r></w:p>` +
      `<w:tbl>${row(cell("Claimant name"), cell("Megan Hart"))}${row(cell("Date of birth"), cell("22/11/1991"))}${row(cell("Address"), cell("(include postcode)"))}</w:tbl>` +
      `<w:p><w:r><w:t xml:space="preserve">NHS number: 943 476 5919</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Prognosis: ________________</w:t></w:r></w:p>` +
      `<w:sectPr/></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

test("a Word form that arrives filled in is emptied before analysis, with a warning", async () => {
  const file = decodeFormFile(b64(filledDocx()));
  const parsed = await parseFormFile(file);
  const { parsed: clean, findings } = redactParsedForm(parsed);
  const outline = buildOutlineBlock(clean);
  for (const secret of ["Megan Hart", "22/11/1991", "943 476 5919"]) assert.ok(!outline.includes(secret), `${secret} must not reach the AI`);
  assert.ok(outline.includes("Claimant name") && outline.includes("Prognosis"), "questions are kept");
  assert.ok(outline.includes("(include postcode)"), "printed instructions are not mistaken for answers");
  assert.ok(findings.length >= 2, findings.join("; "));

  const result = await analyseFormFile({ file, fileName: "request.docx", mode: "demo" });
  assert.ok(result.form.analysis.warnings.some((w) => /already contains details that look like patient information/.test(w)));
  assert.ok(result.trace.some((s) => s.label === "Removed any patient details before analysis" && s.status === "warning"));
});

test("a fillable PDF that arrives filled in: the copy for the AI has its fields emptied", async () => {
  const northfield = SAMPLE_FORMS.find((s) => s.id === "northfield-rehab-progress")!;
  const doc = await PDFDocument.load(await northfield.loadFile());
  doc.getForm().getTextField("txtClaimant").setText("Megan Hart");
  doc.getForm().getTextField("txtPolicyNo").setText("NA-PI-77310");
  const filled = await doc.save();
  const blanked = await blankPdfFormValues(filled);
  assert.deepEqual(blanked.prefilled.sort(), ["txtClaimant", "txtPolicyNo"]);
  const after = await PDFDocument.load(blanked.bytes);
  assert.equal(after.getForm().getTextField("txtClaimant").getText() ?? "", "");
  assert.ok(!Buffer.from(blanked.bytes).toString("latin1").includes("Megan Hart"));

  const file = decodeFormFile(b64(filled));
  const result = await analyseFormFile({ file, fileName: "northfield.pdf", mode: "demo" });
  assert.ok(result.form.analysis.warnings.some((w) => /2 filled-in fillable fields/.test(w)));
});

test("free-text masking keeps labels and drops values", () => {
  const found = new Set<string>();
  assert.equal(redactText("DOB: 22/11/1991, tel 01908 123456, MK9 3AB, a@b.co", found), "DOB: [DOB], tel [PHONE], [POSTCODE], [EMAIL]");
  assert.deepEqual(Array.from(found), ["a date of birth"]);
});
