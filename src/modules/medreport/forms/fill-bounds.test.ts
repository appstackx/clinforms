/**
 * bh2 WA2 – bounded work and the answer paragraph (plan WA2 designs 4–5; R-security-2, R-security-3, B3-20), on
 * FICTIONAL Word files:
 * - hostile sizes finish within 3 s or are refused 422 FORM_TOO_COMPLEX: 200,000 empty lines beside the answers of a
 *   converted RTF form, 50,000 lines in the answers' own cell, 200,000 lines × 150 questions in one cell, many cells
 *   beside a row of placeholders, and the step budget over many crowded cells;
 * - review 26/10 (check-WA2 major 1): the budget counts what the document holds, not lines – one line of 50,000 runs
 *   (the ADV-10 shape; the corpus case FILL-hostile-04 holds 200,000) is refused at once (the FINAL fill and the draft
 *   preview path), lines just under MAX_LINE_SIZE with many
 *   questions are refused by the budget, and copies, insertions and removals are counted (hostile run properties,
 *   answers of many paragraphs in a large body, answer lines of thousands of runs, thousands of text pieces);
 * - the typography an answer takes is read once per cell (not per answer), and never on a form not converted from RTF;
 * - an answer written in place into a cell paragraph with a negative right indent is clamped; on a converted RTF form an
 *   answer is never bold, italic or underlined; a form not converted from RTF keeps the placeholder's own run style.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormFillAnswers } from "../core/forms";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { MAX_BLOCK_PARAGRAPHS, MAX_FILL_BLOCKS, MAX_FILL_STEPS, MAX_LINE_SIZE, fillDocx, fillDocxReport } from "./docx-fill";
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
  // A crowded cell of a real size – 20 questions (the request cap per place) over 300 lines – is filled.
  const real = docx(`<w:tbl><w:tr><w:tc>${own.slice(0, 20).join("")}${empty(280)}</w:tc>${beside}</w:tr></w:tbl>`);
  assert.equal(timed(real, fields.slice(0, 20)).refused, null, "a cell of 300 lines with 20 questions is filled");
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
  const answers = Object.fromEntries(fields.map((f) => [f.id, { text: "x" }]));
  const reads = fillDocxReport(bytes, formOf(bytes, fields, "converted.rtf"), answers, { draft: false }).work.typographyReads;
  assert.ok(reads > 0 && reads <= 3, `RTF: ${reads} reads for 30 answers in a row of 3 cells`);
  assert.equal(fillDocxReport(bytes, formOf(bytes, fields, "plain.docx"), answers, { draft: false }).work.typographyReads, 0, "a Word form is written exactly as before: no sources read");
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

/* ------------------------------------------------------------------------------------------------
 * Review 26/10 (check-WA2 major 1): the budget counts what the document holds
 * ----------------------------------------------------------------------------------------------*/

const blanksLine = (runs: number, blanks: number) => p(Array.from({ length: runs }, (_, i) => (i % Math.floor(runs / blanks) === 0 ? r("……") : r("x"))).join(""));
const lineFields = (blocks: number, perBlock: number) => Array.from({ length: blocks }, (_, b) => Array.from({ length: perBlock }, (_, i) => field(`F-${b * perBlock + i + 1}`, { kind: "docx", target: "replace_placeholder", blockId: `p${b}`, placeholderText: "……" }))).flat();

test("ADV-10: one line of 50,000 runs with 20 blanks – refused 422 FORM_TOO_COMPLEX at once, FINAL and on the draft preview path", async () => {
  const { renderFormFile } = await import("./render-form");
  const bytes = docx(blanksLine(50_000, 20));
  const fields = lineFields(1, 20);
  const base = neutral(bytes);
  for (const answers of [undefined, Object.fromEntries(fields.map((f) => [f.id, { leftBlank: true }]))]) {
    const res = timed(bytes, fields, "hostile.docx", answers);
    assert.equal(res.refused, "FORM_TOO_COMPLEX", `${res.ms} ms`);
    assert.ok(res.ms < 3000 || res.ms < base * 3 + 1500, `refused after ${res.ms} ms (the file alone: ${base} ms)`);
  }
  const form = formOf(bytes, fields, "hostile.docx");
  const started = Date.now();
  await assert.rejects(
    () => renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength }, answers: Object.fromEntries(fields.map((f) => [f.id, { text: "Fictional answer" }])), draft: true, reviewMarkers: true, format: "original" }),
    (err: unknown) => (err as { init?: { code?: string; detail?: string } }).init?.code === "FORM_TOO_COMPLEX" && /A line of this Word file holds more than/.test((err as { init: { detail: string } }).init.detail),
  );
  const ms = Date.now() - started;
  assert.ok(ms < 3000 || ms < base * 3 + 1500, `the draft preview is refused after ${ms} ms (the file alone: ${base} ms)`);
});

test("lines are counted by their size: a line just under MAX_LINE_SIZE is filled, its steps counted in runs; just over it is refused", () => {
  const under = docx(blanksLine(1_500, 20));
  const out = fillDocxReport(under, formOf(under, lineFields(1, 20), "h.docx"), Object.fromEntries(lineFields(1, 20).map((f) => [f.id, { text: "Answer" }])), { draft: false });
  assert.ok(out.work.steps > 20 * 1_500, `${out.work.steps} steps for 20 questions in a line of 1,500 runs – counted in runs, not lines`);
  assert.ok(out.work.steps < MAX_FILL_STEPS);
  const over = docx(blanksLine(Math.ceil(MAX_LINE_SIZE / 3) + 50, 20));
  assert.equal(timed(over, lineFields(1, 20)).refused, "FORM_TOO_COMPLEX");
});

test("lines just under the cap, many questions: refused by the budget within 3 s", () => {
  const bytes = docx(Array.from({ length: 10 }, () => blanksLine(1_600, 20)).join(""));
  const res = timed(bytes, lineFields(10, 20));
  assert.equal(res.refused, "FORM_TOO_COMPLEX");
  assert.ok(within(res, neutral(bytes)), `${res.ms} ms`);
});

test("copies, insertions and removals are counted: run properties of thousands of children, answers of many paragraphs in a large body, answer lines of thousands of runs, thousands of text pieces", () => {
  const rPr = `<w:rPr>${"<w:noProof/>".repeat(4_900)}</w:rPr>`;
  const props = docx(Array.from({ length: 20 }, () => `<w:p><w:r>${rPr}<w:t xml:space="preserve">Label ……</w:t></w:r></w:p>`).join(""));
  const many = Array.from({ length: 60 }, (_, k) => `Line ${k}`).join("\n\n");
  const body = docx(Array.from({ length: 400 }, (_, i) => p(r(`Question ${i}`))).join("") + empty(100_000));
  const dots = docx(`<w:tbl><w:tr>${Array.from({ length: 20 }, () => `<w:tc>${p(r(".").repeat(1_600))}</w:tc>`).join("")}</w:tr></w:tbl>`);
  const pieces = docx(Array.from({ length: 20 }, () => `<w:p><w:r>${"<w:t>x</w:t>".repeat(2_400)}</w:r>${r(" ……")}</w:p>`).join(""));
  const shapes: Array<[string, Uint8Array, FormField[], FormFillAnswers | undefined]> = [
    ["run properties", props, lineFields(20, 1), undefined],
    ["a large body", body, Array.from({ length: 400 }, (_, i) => field(`F-${i + 1}`, { kind: "docx", target: "after_paragraph", blockId: `p${i}` })), Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`F-${i + 1}`, { text: many }]))],
    ["answer lines", dots, Array.from({ length: 20 }, (_, c) => field(`F-${c + 1}`, { kind: "docx", target: "table_cell", blockId: `t0.r0.c${c}` })), undefined],
    ["text pieces", pieces, lineFields(20, 1), undefined],
  ];
  for (const [label, bytes, fields, answers] of shapes) {
    const res = timed(bytes, fields, "hostile.docx", answers);
    assert.ok(within(res, neutral(bytes)), `${label}: ${res.ms} ms (${res.refused ?? "filled"})`);
  }
  // Answers of 60,000 lines each: the lines an answer makes are counted too – refused, not written.
  const cells = docx(`<w:tbl>${Array.from({ length: 20 }, (_, i) => `<w:tr><w:tc>${p(r(`Q${i}`))}</w:tc><w:tc>${p("")}</w:tc></w:tr>`).join("")}</w:tbl>`);
  const tall = Array.from({ length: 20 }, (_, i) => field(`F-${i + 1}`, { kind: "docx", target: "table_cell", blockId: `t0.r${i}.c1` }));
  const lines = Array.from({ length: 60_000 }, () => "a").join("\n");
  assert.equal(timed(cells, tall, "hostile.docx", Object.fromEntries(tall.map((f) => [f.id, { text: lines }]))).refused, "FORM_TOO_COMPLEX");
});

/* ------------------------------------------------------------------------------------------------
 * Harden 26/10 (check2-WA2 major N-1, minor N-2): the instructions pass is counted; long ordinary forms are filled
 * ----------------------------------------------------------------------------------------------*/

const note = (tabs: number) => `<w:p><w:r><w:t xml:space="preserve">Sample line (delete this text)</w:t></w:r><w:r>${"<w:tab/>".repeat(tabs)}</w:r></w:p>`;
const nameLine = p(r("Name ______"));
const nameField = (blockId: string) => [field("F-01", { kind: "docx", target: "replace_placeholder", blockId, placeholderText: "______" })];

test("N-1: a form author's note beside one run of 40,000 tabs is left as printed at once – FINAL, draft and the preview path", async () => {
  const { renderFormFile } = await import("./render-form");
  const bytes = docx(note(40_000) + nameLine);
  const fields = nameField("p1");
  const base = neutral(bytes);
  const res = timed(bytes, fields);
  assert.equal(res.refused, null);
  assert.ok(res.ms < 3000 || res.ms < base * 3 + 1500, `${res.ms} ms (the file alone: ${base} ms)`);
  const xml = new PizZip(res.out!).file("word/document.xml")!.asText();
  assert.match(xml, /Sample line \(delete this text\)/, "a line past MAX_LINE_SIZE keeps its note (as a question's line would be refused)");
  assert.match(xml, /<w:t[^>]*>x<\/w:t>/, "the question is answered");
  assert.doesNotMatch(xml, /______/);
  const form = formOf(bytes, fields, "hostile.docx");
  const started = Date.now();
  await renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength }, answers: { "F-01": { text: "Fictional name" } }, draft: true, reviewMarkers: true, format: "original" });
  const ms = Date.now() - started;
  assert.ok(ms < 3000 || ms < base * 3 + 1500, `the draft preview: ${ms} ms (the file alone: ${base} ms)`);
});

test("N-1: notes beside runs just under the line cap – the work of leaving them off is counted: refused 422 within 3 s; an ordinary note is still left off, its work counted", () => {
  for (const [lines, tabs] of [[10, 4_900], [200, 1_000]] as const) {
    const bytes = docx(note(tabs).repeat(lines) + nameLine);
    const res = timed(bytes, nameField(`p${lines}`));
    assert.equal(res.refused, "FORM_TOO_COMPLEX", `${lines} × ${tabs}: ${res.ms} ms`);
    assert.ok(within(res, neutral(bytes)), `${lines} × ${tabs}: ${res.ms} ms`);
  }
  const plain = docx(`<w:p><w:r><w:t xml:space="preserve">Sample line</w:t></w:r><w:r>${"<w:tab/>".repeat(40)}</w:r></w:p>` + nameLine);
  const noted = docx(note(40) + nameLine);
  const answers = { "F-01": { text: "Fictional name" } };
  const without = fillDocxReport(plain, formOf(plain, nameField("p1"), "a.docx"), answers, { draft: false });
  const withNote = fillDocxReport(noted, formOf(noted, nameField("p1"), "a.docx"), answers, { draft: false });
  assert.doesNotMatch(new PizZip(withNote.bytes).file("word/document.xml")!.asText(), /delete this text/, "the note is left off");
  assert.ok(withNote.work.steps > without.work.steps, `leaving the note off is counted: ${withNote.work.steps} > ${without.work.steps} steps`);
});

/** A long ordinary questionnaire (fictional): `lines` printed lines, `questions` answered after their line with `paras` paragraphs, a table of `rows` rows. */
function longForm(lines: number, questions: number, paras: number, rows: number): { bytes: Uint8Array; fields: FormField[]; answers: FormFillAnswers } {
  const every = Math.floor(lines / questions);
  const body: string[] = [];
  const fields: FormField[] = [];
  const answers: FormFillAnswers = {};
  const sentence = "The fictional patient reports steady progress with the home programme and has returned to light duties.";
  for (let i = 0; i < lines; i++) {
    if (i % every === 0 && fields.length < questions) {
      const id = `F-${fields.length + 1}`;
      body.push(p(r(`Question ${fields.length + 1} of the fictional form:`)));
      fields.push({ ...field(id, { kind: "docx", target: "after_paragraph", blockId: `p${i}` }), answerType: "long_text" });
      answers[id] = { text: Array.from({ length: paras }, () => sentence).join("\n\n") };
    } else body.push(p(r(`Printed line ${i + 1} of the fictional form.`)));
  }
  const table = rows ? `<w:tbl>${Array.from({ length: rows }, (_, k) => `<w:tr><w:tc>${p(r(`Item ${k + 1}`))}</w:tc><w:tc>${p("")}</w:tc></w:tr>`).join("")}</w:tbl>` : "";
  for (let k = 0; k < rows; k++) {
    fields.push(field(`T-${k + 1}`, { kind: "docx", target: "table_cell", blockId: `t0.r${k}.c1` }));
    answers[`T-${k + 1}`] = { text: "Fictional short answer" };
  }
  return { bytes: docx(table + body.join("")), fields, answers };
}

test("N-2: long ordinary questionnaires are filled, well inside the budget (re-indexing is counted at its cost, not one step per child)", () => {
  for (const [lines, questions, paras, rows, most] of [[2_000, 300, 3, 100, 0.25], [1_500, 200, 6, 0, 0.25], [3_000, 300, 10, 0, 0.75]] as const) {
    const { bytes, fields, answers } = longForm(lines, questions, paras, rows);
    const out = fillDocxReport(bytes, formOf(bytes, fields, "long.docx"), answers, { draft: false });
    assert.ok(out.work.steps < MAX_FILL_STEPS * most, `${lines} lines, ${questions} × ${paras} paragraphs, ${rows} rows: ${out.work.steps} steps`);
    assert.ok(out.outcomes.every((o) => !o.fatal), `${lines} lines: no fatal outcome`);
  }
});

test("note (check2-WA2): a line after a question holding more than MAX_LINE_SIZE (a drawing group anchored there) ends the answer space – the form is not refused", () => {
  const big = `<w:p>${Array.from({ length: Math.ceil(MAX_LINE_SIZE / 3) + 50 }, () => r("·")).join("")}</w:p>`;
  const bytes = docx(p(r("Question of the fictional form:")) + big + p(r("Next printed line.")));
  const fields = [field("F-01", { kind: "docx", target: "after_paragraph", blockId: "p0" })];
  const res = timed(bytes, fields, "neighbour.docx", { "F-01": { text: "Fictional answer." } });
  assert.equal(res.refused, null);
  assert.match(new PizZip(res.out!).file("word/document.xml")!.asText(), /Fictional answer\./);
});
