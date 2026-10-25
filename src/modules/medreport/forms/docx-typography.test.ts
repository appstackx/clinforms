/**
 * Fix round 1 (B0-13, B0-31): answers take the typography of the form around them on a form converted from RTF – never
 * the converter's Times New Roman 12 pt defaults, never a label's bold – and never a negative right indent in a table
 * cell. Any other Word form is written exactly as before. Small FICTIONAL documents that mimic Physio-Link's and
 * JJ Physio's converted templates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { fillDocx } from "./docx-fill";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function docx(body: string): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

const TAHOMA = '<w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma"/>';
const CALIBRI = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
const BLUE = '<w:color w:val="1F497D"/>';
const SZ22 = '<w:sz w:val="22"/><w:szCs w:val="22"/>';
const run = (text: string, rPr: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (pPr: string, ...runs: string[]) => `<w:p><w:pPr>${pPr}</w:pPr>${runs.join("")}</w:p>`;
const cell = (...paras: string[]) => `<w:tc>${paras.join("")}</w:tc>`;

const BODY = [
  // Physio-Link: an empty answer cell whose paragraph mark holds only the size; its typed space is Tahoma.
  `<w:tbl><w:tr>${cell(para(`<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`, run(" ", `${TAHOMA}${SZ22}`)))}</w:tr></w:tbl>`,
  // JJ Physio: a bold dark-blue "1." label with a negative right indent, the answer on a new line after it.
  `<w:tbl><w:tr>${cell(para(`<w:ind w:right="-330"/><w:rPr>${CALIBRI}<w:b/><w:bCs/>${BLUE}${SZ22}</w:rPr>`, run("1.", `${CALIBRI}<w:b/><w:bCs/>${BLUE}${SZ22}`)))}</w:tr></w:tbl>`,
  // Physio-Link: an answer written after a bold printed label.
  para(`<w:rPr>${SZ22}</w:rPr>`, run("Initial Assessment Date:", `${TAHOMA}<w:b/><w:bCs/>${SZ22}`)),
  // JJ Physio: printed default comments replaced by a two-paragraph answer – the second keeps the first's colour.
  para(`<w:rPr>${CALIBRI}${SZ22}</w:rPr>`, run("The patient has been advised to continue.", `${CALIBRI}${BLUE}${SZ22}`)),
].join("");

function field(id: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label: id, guidance: "", answerType: "long_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function form(fileName: string): FormDefinition {
  return {
    id: "frm_typography",
    tenantId: "demo",
    referrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" },
    title: "Typography (fictional)",
    file: { fileName, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields: [
      field("F-01", { kind: "docx", target: "table_cell", blockId: "t0.r0.c0" }),
      field("F-02", { kind: "docx", target: "after_paragraph", blockId: "t1.r0.c0.p0" }),
      field("F-03", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "Initial Assessment Date:", writeAfter: true }, { answerType: "date" }),
      field("F-04", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "The patient has been advised to continue." }),
    ],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  };
}

const ANSWERS = {
  "F-01": { text: "Acute non-specific low back pain (fictional)." },
  "F-02": { text: "Neck pain after a road traffic accident (fictional)." },
  "F-03": { text: "15/07/2026", value: "2026-07-15" },
  "F-04": { text: "First paragraph (fictional).\n\nSecond paragraph (fictional)." },
};

const xmlOf = (bytes: Uint8Array) => new PizZip(bytes).file("word/document.xml")!.asText();
/** The run properties of the run holding `text`. */
function rPrOf(xml: string, text: string): string {
  const at = xml.indexOf(`>${text}</w:t>`);
  assert.ok(at > 0, `“${text}” is written`);
  const start = xml.lastIndexOf("<w:r>", at);
  return /<w:rPr>(.*?)<\/w:rPr>/.exec(xml.slice(start, at))?.[1] ?? "";
}

test("fix round 1: on a converted RTF form, answers take the form's font, size and colour – never Times New Roman, never a label's bold", () => {
  const xml = xmlOf(fillDocx(docx(BODY), form("(Physio-Link) - IA -.rtf"), ANSWERS, { draft: false }));
  const diagnosis = rPrOf(xml, "Acute non-specific low back pain (fictional).");
  assert.match(diagnosis, /w:ascii="Tahoma"/, "the cell's typed space gives the font (the mark only gives the size)");
  assert.match(diagnosis, /<w:sz w:val="18"\/>/, "the mark's size is kept");
  const problem = rPrOf(xml, "Neck pain after a road traffic accident (fictional).");
  assert.match(problem, /w:ascii="Calibri"/);
  assert.match(problem, /<w:color w:val="1F497D"\/>/, "dark blue like the form, not black");
  assert.match(problem, /<w:sz w:val="22"\/>/, "11 pt like the form, not the converter's 12 pt");
  assert.doesNotMatch(problem, /<w:b\/>/, "not bold like the “1.” label");
  const date = rPrOf(xml, " 15/07/2026");
  assert.doesNotMatch(date, /<w:b\/>/, "written after a bold label, not bold");
  assert.match(date, /w:ascii="Tahoma"/);
  assert.match(rPrOf(xml, "Second paragraph (fictional)."), /<w:color w:val="1F497D"\/>/, "every paragraph of the answer in the same colour");
});

test("fix round 1: an answer paragraph in a table cell never keeps a negative right indent", () => {
  const xml = xmlOf(fillDocx(docx(BODY), form("(JJ Physio) - IA -.rtf"), ANSWERS, { draft: false }));
  const answerPara = xml.slice(xml.lastIndexOf("<w:p>", xml.indexOf("Neck pain after")), xml.indexOf("Neck pain after"));
  assert.match(answerPara, /<w:ind w:right="0"\/>/);
  assert.match(xml, /<w:ind w:right="-330"\/><w:rPr>/, "the printed label keeps its own indent");
});

test("fix round 1: a Word form that was not converted from RTF is written exactly as before (no typography taken from labels)", () => {
  const xml = xmlOf(fillDocx(docx(BODY), form("referrer-form.docx"), ANSWERS, { draft: false }));
  assert.doesNotMatch(rPrOf(xml, "Acute non-specific low back pain (fictional)."), /Tahoma/);
  const problem = rPrOf(xml, "Neck pain after a road traffic accident (fictional).");
  assert.doesNotMatch(problem, /1F497D/);
  assert.doesNotMatch(rPrOf(xml, "Second paragraph (fictional)."), /1F497D/);
});

test("fix round 2 (B1-8): an answer on a new line after an uncoloured instruction in a cell takes the navy of the cell's label – every paragraph", () => {
  // JJ Physio IA "Clinical Impression": a bold navy label, then the instruction paragraph "Please give clinical details
  // in this box" with no colour on its mark or its run; the answer goes on a new line after the instruction.
  const body = `<w:tbl><w:tr>${cell(
    para(`<w:rPr>${CALIBRI}<w:b/><w:bCs/>${BLUE}${SZ22}</w:rPr>`, run("Clinical Impression:", `${CALIBRI}<w:b/><w:bCs/>${BLUE}${SZ22}`)),
    para(`<w:rPr>${CALIBRI}${SZ22}</w:rPr>`, run("Please give clinical details in this box", `${CALIBRI}${SZ22}`)),
  )}${cell(para("", run("Upper Limb / Lower Limb", `${CALIBRI}${BLUE}${SZ22}`)))}</w:tr></w:tbl>`;
  const jj: FormDefinition = { ...form("(JJ Physio) - IA -.rtf"), fields: [field("F-10", { kind: "docx", target: "after_paragraph", blockId: "t0.r0.c0.p1" })] };
  const answers = { "F-10": { text: "Right knee pain on the inner side after a twist (fictional).\n\nStairs and squatting provoke it (fictional)." } };
  const xml = xmlOf(fillDocx(docx(body), jj, answers, { draft: false }));
  for (const text of ["Right knee pain on the inner side after a twist (fictional).", "Stairs and squatting provoke it (fictional)."]) {
    const rPr = rPrOf(xml, text);
    assert.match(rPr, /<w:color w:val="1F497D"\/>/, `navy like the form: ${text}`);
    assert.doesNotMatch(rPr, /<w:b\/>/, "not the label's bold");
    assert.match(rPr, /w:ascii="Calibri"/);
  }
  // Any other Word form: as before.
  const plain = xmlOf(fillDocx(docx(body), { ...jj, file: { ...jj.file, fileName: "referrer-form.docx" } }, answers, { draft: false }));
  assert.doesNotMatch(rPrOf(plain, "Stairs and squatting provoke it (fictional)."), /1F497D/);
});
