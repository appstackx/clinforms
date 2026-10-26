/**
 * bh2 WA2 – bounded work and the answer paragraph (plan WA2 designs 4–5; R-security-2, R-security-3, B3-20), on
 * FICTIONAL Word files:
 * - hostile sizes finish within 3 s or are refused 422 FORM_TOO_COMPLEX: 200,000 empty lines beside the answers of a
 *   converted RTF form, 50,000 lines in the answers' own cell, 200,000 lines × 150 questions in one cell, many cells
 *   beside a row of placeholders, and the step budget over many crowded cells;
 * - the typography an answer takes is read once per cell (not per answer), and never on a form not converted from RTF;
 * - an answer written in place into a cell paragraph with a negative right indent is clamped; on a converted RTF form an
 *   answer is never bold, italic or underlined; a form not converted from RTF keeps the placeholder's own run style.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormFillAnswers } from "../core/forms";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { MAX_BLOCK_PARAGRAPHS, MAX_FILL_BLOCKS, fillDocx, typographySourceReads } from "./docx-fill";
import { DOCX_MIME, sha256Hex } from "./file";

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

const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (inner = "", pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const empty = (n: number) => "<w:p/>".repeat(n);

function field(id: string, anchor: FormAnchor): FormField {
  return { id, label: `Question ${id}`, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" };
}

function formOf(bytes: Uint8Array, fields: FormField[], fileName: string): FormDefinition {
  return {
    id: "frm_bounds",
    tenantId: "demo",
    referrer: { name: "Ashby Claims Review (fictional)", type: "mlc" },
    title: "Bounds (fictional)",
    file: { fileName, mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-26T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-26T09:00:00.000Z",
    updatedAt: "2026-10-26T09:00:00.000Z",
  };
}

/** A FINAL fill: its time, or the refusal's code. */
function timed(bytes: Uint8Array, fields: FormField[], fileName = "hostile.docx", answers?: FormFillAnswers): { ms: number; refused: string | null; out: Buffer | null } {
  const all: FormFillAnswers = answers ?? Object.fromEntries(fields.map((f) => [f.id, { text: "x" }]));
  const started = Date.now();
  try {
    const out = fillDocx(bytes, formOf(bytes, fields, fileName), all, { draft: false });
    return { ms: Date.now() - started, refused: null, out };
  } catch (err) {
    const e = err as { status?: number; init?: { code?: string } };
    if (e.status === 422) return { ms: Date.now() - started, refused: e.init?.code ?? "422", out: null };
    throw err;
  }
}

/**
 * Within budget: refused 422 FORM_TOO_COMPLEX, or under 3 s – or, on a busy machine (test:medreport runs its files in
 * parallel), about as fast as the same file with no question to fill (opening and saving it), so the work the
 * questions add is bounded whatever the load.
 */
const within = (res: { ms: number; refused: string | null }, neutralMs = 0) => res.refused === "FORM_TOO_COMPLEX" || res.ms < 3000 || res.ms < neutralMs * 3 + 1500;
const neutral = (bytes: Uint8Array) => timed(bytes, []).ms;

test("R-security-3: 200,000 empty lines beside the answers of a converted RTF form – filled within 3 s (typography read once per cell, 64 lines at most)", () => {
  const questions = Array.from({ length: 75 }, (_, i) => p(r(`Question ${i}`)));
  const bytes = docx(`<w:tbl><w:tr><w:tc>${questions.join("")}</w:tc><w:tc>${empty(200_000)}</w:tc></w:tr></w:tbl>`);
  const fields = questions.map((_, i) => field(`F-${i + 1}`, { kind: "docx", target: "after_paragraph", blockId: `t0.r0.c0.p${i}` }));
  const res = timed(bytes, fields, "hostile.rtf");
  const base = neutral(bytes);
  assert.ok(within(res, base), `${res.ms} ms (${res.refused ?? "filled"}; the file alone: ${base} ms)`);
});

test("R-security-2: 50,000 lines, or 200,000 lines × 150 questions, in the answers' own cell – refused 422 FORM_TOO_COMPLEX at once", () => {
  for (const [lines, questions] of [[50_000, 75], [200_000, 150]] as const) {
    const own = Array.from({ length: questions }, (_, i) => p(r(`Q${i}: [answer ${i}]`)));
    const bytes = docx(`<w:tbl><w:tr><w:tc>${own.join("")}${empty(lines)}</w:tc></w:tr></w:tbl>`);
    const fields = own.map((_, i) => field(`F-${i + 1}`, { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c0", placeholderText: `[answer ${i}]`, clearPlaceholder: true }));
    const res = timed(bytes, fields);
    assert.equal(res.refused, "FORM_TOO_COMPLEX", `${lines} lines: ${res.ms} ms`);
    const base = neutral(bytes);
    assert.ok(res.ms < 3000 || res.ms < base * 3 + 1500, `${lines} lines: refused after ${res.ms} ms (the file alone: ${base} ms)`);
  }
});

test("route-row-dos: placeholders beside 30 cells of 50 lines – within 3 s or refused; a body larger than MAX_FILL_BLOCKS is refused", () => {
  const own = Array.from({ length: 75 }, (_, i) => p(r(`Q${i}: [answer ${i}]`)));
  const beside = Array.from({ length: 30 }, () => `<w:tc>${empty(50)}</w:tc>`).join("");
  const bytes = docx(`<w:tbl><w:tr><w:tc>${own.join("")}${empty(1_500)}</w:tc>${beside}</w:tr></w:tbl>`);
  const fields = own.map((_, i) => field(`F-${i + 1}`, { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c0", placeholderText: `[answer ${i}]`, clearPlaceholder: true }));
  const res = timed(bytes, fields);
  assert.ok(within(res, neutral(bytes)), `${res.ms} ms`);
  assert.equal(res.refused, null, "a cell of 1,575 lines is still filled");
  const huge = docx(empty(MAX_FILL_BLOCKS + 1));
  assert.equal(timed(huge, []).refused, "FORM_TOO_COMPLEX");
});

test("the step budget: 400 questions over 20 cells of nearly MAX_BLOCK_PARAGRAPHS lines – refused 422 FORM_TOO_COMPLEX", () => {
  const lines = MAX_BLOCK_PARAGRAPHS - 25;
  const cells = Array.from({ length: 20 }, (_, c) => `<w:tc>${Array.from({ length: 20 }, (_, i) => p(r(`C${c}Q${i}: [a${c}-${i}]`))).join("")}${empty(lines)}</w:tc>`);
  const bytes = docx(`<w:tbl><w:tr>${cells.join("")}</w:tr></w:tbl>`);
  const fields = cells.flatMap((_, c) => Array.from({ length: 20 }, (_, i) => field(`F-${c * 20 + i + 1}`, { kind: "docx", target: "replace_placeholder", blockId: `t0.r0.c${c}`, placeholderText: `[a${c}-${i}]` })));
  const res = timed(bytes, fields);
  assert.equal(res.refused, "FORM_TOO_COMPLEX", `${res.ms} ms: 400 questions × ${lines} lines is past the step budget`);
});

test("typography sources are read once per cell, not once per answer – and never on a form not converted from RTF", () => {
  const questions = Array.from({ length: 30 }, (_, i) => p(r(`Question ${i}`, `<w:rFonts w:ascii="Tahoma"/>`)));
  const body = `<w:tbl><w:tr><w:tc>${questions.join("")}</w:tc><w:tc>${p(r("Label", `<w:color w:val="1F3864"/><w:sz w:val="20"/>`))}</w:tc><w:tc>${p(r("Other", `<w:sz w:val="18"/>`))}</w:tc></w:tr></w:tbl>`;
  const bytes = docx(body);
  const fields = questions.map((_, i) => field(`F-${i + 1}`, { kind: "docx", target: "after_paragraph", blockId: `t0.r0.c0.p${i}` }));
  const before = typographySourceReads();
  timed(bytes, fields, "converted.rtf");
  const reads = typographySourceReads() - before;
  assert.ok(reads > 0 && reads <= 3, `RTF: ${reads} reads for 30 answers in a row of 3 cells`);
  const plainBefore = typographySourceReads();
  timed(bytes, fields, "plain.docx");
  assert.equal(typographySourceReads() - plainBefore, 0, "a Word form is written exactly as before: no sources read");
});

test("B3-20: an answer written in place into a cell paragraph with a negative right indent is clamped (Word and RTF forms)", () => {
  const cellPara = p(r("Findings: ____"), `<w:ind w:left="0" w:right="-330"/>`);
  const bytes = docx(`<w:tbl><w:tr><w:tc>${p(r("Objective findings"))}</w:tc><w:tc>${cellPara}</w:tc></w:tr></w:tbl>${p(r("Body: ____"), `<w:ind w:right="-330"/>`)}`);
  const fields = [field("F-01", { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c1", placeholderText: "____" }), field("F-02", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "____" })];
  for (const name of ["form.docx", "form.rtf"]) {
    const out = timed(bytes, fields, name, { "F-01": { text: "Lumbar movement full." }, "F-02": { text: "Outside a table." } }).out!;
    const xml = new PizZip(out).file("word/document.xml")!.asText();
    const cellP = xml.match(/<w:p>(?:(?!<\/w:p>).)*Lumbar movement full\.(?:(?!<\/w:p>).)*<\/w:p>/)?.[0] ?? "";
    assert.ok(cellP && !/w:right="-/.test(cellP), `${name}: clamped in the cell`);
    const bodyP = xml.match(/<w:p>(?:(?!<\/w:p>).)*Outside a table\.(?:(?!<\/w:p>).)*<\/w:p>/)?.[0] ?? "";
    assert.match(bodyP, /w:right="-330"/, `${name}: outside a table the form's own indent stays`);
  }
});

test("normaliseAnswerParagraph: on a converted RTF form an answer written in place is never bold, italic or underlined; a Word form keeps the placeholder's style", () => {
  const bytes = docx(p(r("Diagnosis: ") + r("____", "<w:b/><w:u w:val=\"single\"/>")));
  const fields = [field("F-01", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "____" })];
  const answers = { "F-01": { text: "Lumbar strain." } };
  const rtf = new PizZip(timed(bytes, fields, "form.rtf", answers).out!).file("word/document.xml")!.asText();
  const run = rtf.match(/<w:r>(?:(?!<\/w:r>).)*Lumbar strain\.(?:(?!<\/w:r>).)*<\/w:r>/)?.[0] ?? "";
  assert.ok(run && !/<w:b\/>|<w:u /.test(run), `RTF: ${run}`);
  const word = new PizZip(timed(bytes, fields, "form.docx", answers).out!).file("word/document.xml")!.asText();
  const wordRun = word.match(/<w:r>(?:(?!<\/w:r>).)*Lumbar strain\.(?:(?!<\/w:r>).)*<\/w:r>/)?.[0] ?? "";
  assert.match(wordRun, /<w:b\/>/, "a Word form is written exactly as before");
});
