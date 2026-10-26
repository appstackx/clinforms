/**
 * bh2 WA2 – the fill reports what it did (plan WA2 designs 1–6), on small FICTIONAL Word documents:
 *
 * - every anchor type × what a form prints there (a pre-printed mark, a ☒, an option list, a default, a merge code, a
 *   sentence frame, a content-control prompt, a form field's default) × what the box issues (an answer, left blank, not
 *   applicable, an unknown answer, an answer that is none of the options): the outcome, its residue and whether it is
 *   fatal – a FINAL copy never issues a decided box as printed;
 * - residue planted on purpose (the leave-blank hook disabled) is found; rows left off before a decided answer give no
 *   false fatal; not found and two answers in one place are fatal;
 * - strict FINAL (render-form.ts): refused 422 with one issue per field; report-only and drafts are not refused; the
 *   outcomes header;
 * - choiceAnswerMatches (forms/choice-marks.ts, WA1's approval check) on the same reading;
 * - the request caps (forms/request-caps.ts);
 * - review 26/10 (check-WA2): a blank left printed never takes a later answer's place; "No" + missing knowledge and
 *   several options of a single choice are never a choice; a chosen mark cleared later is caught; record-empty and
 *   undecided FINAL boxes are checked; report-only FINAL still refuses a merge code; labels ending in a preposition stay;
 *   a word repeated across the blank is caught; PDF outcomes are recorded where the problem is met.
 *
 * Fictional data only; ClinForms' own wording.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormFillAnswers } from "../core/forms";
import type { BoxState, FillOutcome } from "../core/issue-types";
import type { FormAnchor, FormAnswer, FormDefinition, FormField } from "../core/types";
import { withHookDisabled } from "../core/validation/registry";
import { buildDocxOutline } from "./docx-outline";
import { FILL_LEAVE_BLANK_HOOK, fillDocxReport, leadBefore, openerLead, repeatedLead } from "./docx-fill";
import { choiceAnswerMatches, resolveChoice } from "./choice-marks";
import { DOCX_MIME, sha256Hex } from "./file";
import { FillRefusedError, fillOutcomesHeader, renderFormFile } from "./render-form";
import { MAX_FIELDS_PER_BLOCK, MAX_REQUEST_FIELDS, formRequestCapIssues } from "./request-caps";
import { HEADERS } from "../api/contract";

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

const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const tc = (...paras: string[]) => `<w:tc>${paras.join("") || p("")}</w:tc>`;
const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;
const cell = (text: string) => tc(text ? p(r(text)) : p(""));
const control = (prompt: string) => `<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:t xml:space="preserve">${prompt}</w:t></w:r></w:sdtContent></w:sdt>`;
const formText = (name: string, value: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(value)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}

function formOf(bytes: Uint8Array, fields: FormField[], fileName = "fictional.docx"): FormDefinition {
  return {
    id: "frm_outcomes",
    tenantId: "demo",
    referrer: { name: "Harwood Case Partners (fictional)", type: "mlc" },
    title: "Outcome checks (fictional)",
    file: { fileName, mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-26T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-26T09:00:00.000Z",
    updatedAt: "2026-10-26T09:00:00.000Z",
  };
}

const texts = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));
const xmlOf = (bytes: Uint8Array) => new PizZip(bytes).file("word/document.xml")!.asText();

/* ------------------------------------------------------------------------------------------------
 * The fictional form: one row per anchor type and printed residue
 * ----------------------------------------------------------------------------------------------*/

const FORM_BYTES = docx(
  tbl(
    tr(cell("Home exercises given"), cell("☒ Yes  ☐ No")), // r0: pre-ticked glyph
    tr(cell("Sleep affected (mark one)"), cell("Not at all"), cell("A little"), cell("A lot")), // r1: grid header
    tr(cell("Sleep affected"), cell(""), cell("x"), cell("")), // r2: pre-printed mark
    tr(cell("Main treatment (strike out the others)"), cell("Exercise / Manual therapy / Taping")), // r3: inline list
    tr(cell("Session length"), cell("30 minutes")), // r4: printed default
    tr(cell("Further comments"), cell("&lt;&lt;P_COMMENTS&gt;&gt;")), // r5: merge code
    tr(cell("Next step"), cell("To return to …")), // r6: sentence opener
    tr(cell("Assessor"), cell("Name of physiotherapist ……")), // r7: a label, not an opener
    tr(cell("Pain score"), cell("Pain is …/10 at rest")), // r8: a frame with words after the blank
    tr(cell("Report reference"), tc(p(control("Click or tap here to enter text.")))), // r9: content control
    tr(cell("Clinic code"), tc(p(formText("Code1", "ZZ-000")))), // r10: Word form field with a default
    tr(cell("Objective findings"), cell("")), // r11: plain answer cell
    tr(cell("Areas affected (tick all that apply)"), cell("Neck"), cell("Back"), cell("Knee")), // r12: text grid header
    tr(cell("Areas affected"), cell("x"), cell(""), cell("")), // r13: text grid with a default mark
  ),
);

const F = {
  glyph: field("F-01", "Home exercises given", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r0.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r0.c1", glyphIndex: 0 }, { option: "No", blockId: "t0.r0.c1", glyphIndex: 1 }] }, { answerType: "yes_no", options: ["Yes", "No"] }),
  mark: field("F-02", "Sleep affected", { kind: "docx", target: "mark_cell", blockId: "t0.r2.c1", optionCells: [{ option: "Not at all", blockId: "t0.r2.c1" }, { option: "A little", blockId: "t0.r2.c2" }, { option: "A lot", blockId: "t0.r2.c3" }], mark: "x" }, { answerType: "single_choice", options: ["Not at all", "A little", "A lot"] }),
  list: field("F-03", "Main treatment", { kind: "docx", target: "delete_options", blockId: "t0.r3.c1", placeholderText: "Exercise / Manual therapy / Taping" }, { answerType: "single_choice", options: ["Exercise", "Manual therapy", "Taping"] }),
  dflt: field("F-04", "Session length", { kind: "docx", target: "replace_placeholder", blockId: "t0.r4.c1", placeholderText: "30 minutes" }),
  code: field("F-05", "Further comments", { kind: "docx", target: "replace_placeholder", blockId: "t0.r5.c1", placeholderText: "<<P_COMMENTS>>" }),
  opener: field("F-06", "Next step – to return to", { kind: "docx", target: "replace_placeholder", blockId: "t0.r6.c1", placeholderText: "…" }),
  label: field("F-07", "Assessor", { kind: "docx", target: "replace_placeholder", blockId: "t0.r7.c1", placeholderText: "……" }),
  frame: field("F-08", "Pain score", { kind: "docx", target: "replace_placeholder", blockId: "t0.r8.c1", placeholderText: "…" }),
  ctrl: field("F-09", "Report reference", { kind: "docx", target: "content_control", blockId: "t0.r9.c1" }),
  legacy: field("F-10", "Clinic code", { kind: "docx", target: "legacy_form_field", blockId: "t0.r10.c1", placeholderText: "Code1" }),
  cell: field("F-11", "Objective findings", { kind: "docx", target: "table_cell", blockId: "t0.r11.c1" }, { answerType: "long_text" }),
  grid: field("F-12", "Areas affected", { kind: "docx", target: "mark_cell", blockId: "t0.r13.c1", optionCells: [{ option: "Neck", blockId: "t0.r13.c1" }, { option: "Back", blockId: "t0.r13.c2" }, { option: "Knee", blockId: "t0.r13.c3" }], mark: "x" }),
};
const FIELDS = Object.values(F);
const FORM = formOf(FORM_BYTES, FIELDS);

/** FINAL fill (fillDocxReport never refuses – the outcomes say what is wrong). */
function fill(answers: FormFillAnswers, opts: { states?: Record<string, BoxState>; draft?: boolean; form?: FormDefinition; bytes?: Uint8Array } = {}) {
  const out = fillDocxReport(opts.bytes ?? FORM_BYTES, opts.form ?? FORM, answers, { draft: opts.draft ?? false, ...(opts.states ? { states: opts.states } : {}) });
  const by = Object.fromEntries(out.outcomes.map((o) => [o.fieldId, o])) as Record<string, FillOutcome>;
  return { ...out, by, t: texts(out.bytes), xml: xmlOf(out.bytes) };
}

const ALL_BLANK: FormFillAnswers = Object.fromEntries(FIELDS.map((f) => [f.id, { leftBlank: true }]));
const NOT_APPLICABLE: Record<string, BoxState> = Object.fromEntries(FIELDS.map((f) => [f.id, { kind: "not_applicable", reason: "condition" } as BoxState]));

test("answered: every anchor is written, choices end explicit, nothing is fatal", () => {
  const out = fill({
    "F-01": { text: "No", value: false },
    "F-02": { text: "A lot", value: "A lot" },
    "F-03": { text: "Taping", value: "Taping" },
    "F-04": { text: "45 minutes" },
    "F-05": { text: "Discharged with a home programme." },
    "F-06": { text: "lighter duties" },
    "F-07": { text: "Sarah Reid" },
    "F-08": { text: "3" },
    "F-09": { text: "ZZ-REF-7" },
    "F-10": { text: "ZZ-123" },
    "F-11": { text: "Lumbar flexion full." },
    "F-12": { text: "Back, Knee" },
  });
  for (const o of out.outcomes) {
    assert.equal(o.outcome, "written", `${o.fieldId}: ${JSON.stringify(o)}`);
    assert.equal(o.fatal, false, o.fieldId);
    assert.equal(o.intended, "answer");
  }
  assert.equal(out.t["t0.r0.c1"], "☐ Yes  ☒ No", "the chosen box ticked, the pre-ticked one cleared");
  assert.deepEqual([out.t["t0.r2.c1"], out.t["t0.r2.c2"], out.t["t0.r2.c3"]], ["", "", "x"], "the default mark moved to the chosen column");
  assert.equal(out.t["t0.r3.c1"], "Taping");
  assert.equal(out.t["t0.r4.c1"], "45 minutes");
  assert.equal(out.t["t0.r6.c1"], "To return to lighter duties");
  assert.equal(out.t["t0.r8.c1"], "Pain is 3/10 at rest");
  assert.ok(out.xml.includes("ZZ-REF-7") && !out.xml.includes("Click or tap here"));
  assert.ok(out.xml.includes("ZZ-123") && !out.xml.includes("ZZ-000"));
  assert.deepEqual([out.t["t0.r13.c1"], out.t["t0.r13.c2"], out.t["t0.r13.c3"]], ["", "x", "x"]);
});

test("left blank (FINAL, approved): nothing reads as an answer – marks, ticks, lists, defaults, opener, prompt, form field cleared; a merge code is fatal", () => {
  const out = fill(ALL_BLANK);
  assert.equal(out.t["t0.r0.c1"], "☐ Yes  ☐ No", "the pre-ticked box is cleared");
  assert.deepEqual([out.t["t0.r2.c1"], out.t["t0.r2.c2"], out.t["t0.r2.c3"]], ["", "", ""]);
  assert.equal(out.t["t0.r3.c1"], "", "the option list is removed");
  assert.equal(out.t["t0.r4.c1"], "", "the printed default is removed");
  assert.equal(out.t["t0.r6.c1"], "", "Khuram 26/10 (B3-19): the opener loses its printed lead and dots");
  assert.equal(out.t["t0.r7.c1"], "Name of physiotherapist ……", "a label line is not an opener: left as printed");
  assert.equal(out.t["t0.r8.c1"], "Pain is …/10 at rest", "a frame with words after its blank stays as printed");
  assert.ok(!out.xml.includes("Click or tap here"), "the content control's prompt is gone");
  assert.ok(!out.xml.includes("ZZ-000"), "the Word form field's default is gone");
  assert.deepEqual([out.t["t0.r13.c1"], out.t["t0.r13.c2"], out.t["t0.r13.c3"]], ["", "", ""]);
  assert.equal(out.t["t0.r5.c1"], "<<P_COMMENTS>>", "a merge code in a box left blank stays…");
  assert.equal(out.by["F-05"].fatal, true, "…and is fatal: the copy is refused (validators block approval before that)");
  assert.match(out.by["F-05"].residue?.[0] ?? "", /your clinic system's placeholder “P_COMMENTS” is still on the form \(a mail-merge field\)/);
  for (const o of out.outcomes.filter((x) => x.fieldId !== "F-05")) {
    assert.equal(o.fatal, false, `${o.fieldId}: ${JSON.stringify(o)}`);
    assert.equal(o.intended, "blank");
  }
  assert.equal(out.by["F-01"].outcome, "cleared");
  assert.equal(out.by["F-02"].outcome, "cleared");
  assert.equal(out.by["F-03"].outcome, "cleared");
  assert.equal(out.by["F-04"].outcome, "cleared");
  assert.equal(out.by["F-06"].outcome, "removed");
  assert.equal(out.by["F-07"].outcome, "as_printed");
  assert.equal(out.by["F-09"].outcome, "cleared");
  assert.equal(out.by["F-10"].outcome, "cleared");
  assert.equal(out.by["F-11"].outcome, "as_printed");
});

test("not applicable (WA1's state): prints nothing, and its merge code is cleared – nothing is fatal", () => {
  const out = fill({ "F-05": { text: "An answer typed into a box that does not apply." } }, { states: NOT_APPLICABLE });
  assert.equal(out.t["t0.r5.c1"], "", "the merge code of a box that is not asked is cleared – and its answer never printed");
  assert.equal(out.t["t0.r6.c1"], "");
  assert.equal(out.t["t0.r0.c1"], "☐ Yes  ☐ No");
  for (const o of out.outcomes) {
    assert.equal(o.fatal, false, `${o.fieldId}: ${JSON.stringify(o)}`);
    assert.equal(o.intended, "not_applicable");
  }
  assert.equal(out.by["F-05"].outcome, "cleared");
});

test("record empty: the placeholder (a clinic system's code) is removed, never left", () => {
  const out = fill({ "F-05": { text: "", blank: true } });
  assert.equal(out.t["t0.r5.c1"], "");
  assert.deepEqual([out.by["F-05"].intended, out.by["F-05"].outcome, out.by["F-05"].fatal], ["blank", "cleared", false]);
});

test("Q-1: an unknown or unmatched answer on a choice field leaves the options as printed – never a guess – and is fatal", () => {
  for (const text of ["Not recorded", "Sometimes"]) {
    const out = fill({ "F-01": { text }, "F-02": { text, value: text }, "F-03": { text, value: text } });
    assert.equal(out.t["t0.r0.c1"], "☒ Yes  ☐ No", `${text}: as printed`);
    assert.equal(out.t["t0.r2.c2"], "x");
    assert.equal(out.t["t0.r3.c1"], "Exercise / Manual therapy / Taping");
    for (const id of ["F-01", "F-02", "F-03"]) {
      assert.equal(out.by[id].fatal, true, `${text} ${id}`);
      assert.equal(out.by[id].intended, "answer");
      assert.equal(out.by[id].outcome, "as_printed");
    }
  }
  // A "tick all that apply" text naming nothing printed: nothing marked – the default mark too – and informational only.
  const grid = fill({ "F-12": { text: "Elbow" } });
  assert.deepEqual([grid.t["t0.r13.c1"], grid.t["t0.r13.c2"], grid.t["t0.r13.c3"]], ["", "", ""]);
  assert.equal(grid.by["F-12"].fatal, false);
  assert.match(grid.by["F-12"].note ?? "", /not one of the printed columns/);
});

test("FINAL never gives as_printed on a decided box with something printed there that reads as an answer", () => {
  const cases: FormFillAnswers[] = [ALL_BLANK, { "F-01": { text: "Unknown" } }, { "F-02": { value: "Very little", text: "Very little" } }, { "F-03": { value: "Hydrotherapy", text: "Hydrotherapy" } }];
  for (const answers of cases) {
    const out = fill(answers);
    for (const o of out.outcomes) {
      const f = FIELDS.find((x) => x.id === o.fieldId)!;
      const decided = Boolean(answers[o.fieldId]);
      if (!decided || o.outcome !== "as_printed") continue;
      // As printed is only ever a box with nothing to clear (an empty cell, a label, a frame) – or fatal.
      const harmless = ["F-07", "F-08", "F-11"].includes(f.id);
      assert.ok(harmless || o.fatal, `${o.fieldId}: ${JSON.stringify(o)}`);
    }
  }
});

test("a planted residue is detected: with the leave-blank hook disabled every residue is found and fatal", async () => {
  await withHookDisabled(FILL_LEAVE_BLANK_HOOK, async () => {
    const out = fill(ALL_BLANK);
    const fatal = out.outcomes.filter((o) => o.fatal).map((o) => o.fieldId);
    assert.deepEqual(fatal, ["F-01", "F-02", "F-03", "F-04", "F-05", "F-06", "F-09", "F-10", "F-12"], JSON.stringify(out.outcomes));
    assert.match(out.by["F-01"].residue?.[0] ?? "", /“Yes” is ticked/);
    assert.match(out.by["F-02"].residue?.[0] ?? "", /a mark is printed in “A little”/);
    assert.match(out.by["F-03"].residue?.[0] ?? "", /printed options/);
    assert.match(out.by["F-04"].residue?.[0] ?? "", /printed default “30 minutes”/);
    assert.match(out.by["F-06"].residue?.[0] ?? "", /To return to …/);
  });
  // A residue the fill did not plant: an answer written, the other column's printed mark still there.
  const grid = docx(tbl(tr(cell("Sleep"), cell("x"), cell("x"))));
  const f = field("F-01", "Sleep", { kind: "docx", target: "mark_cell", blockId: "t0.r0.c1", optionCells: [{ option: "Good", blockId: "t0.r0.c1" }, { option: "Poor", blockId: "t0.r0.c2" }], mark: "x" }, { answerType: "single_choice", options: ["Good", "Poor"] });
  const ok = fill({ "F-01": { value: "Good", text: "Good" } }, { form: formOf(grid, [f]), bytes: grid });
  assert.equal(ok.by["F-01"].fatal, false, "the other column's mark is cleared");
  assert.deepEqual([ok.t["t0.r0.c1"], ok.t["t0.r0.c2"]], ["x", ""]);
});

test("rows left off before a decided answer give no false fatal; the answer is still found", () => {
  const red = (t: string) => `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const bytes = docx(
    tbl(tr(cell("Session"), cell("Date")), tr(cell("1"), cell("")), tr(cell("1"), cell("")), tr(cell("1"), cell("")), tr(tc(p(red("Delete unused cells"))), cell(""))) + tbl(tr(cell("Comments"), cell(""))),
  );
  const fields = [
    field("F-01", "Session 1 date", { kind: "docx", target: "table_cell", blockId: "t0.r1.c1" }),
    field("F-02", "Session 2 date", { kind: "docx", target: "table_cell", blockId: "t0.r2.c1" }),
    field("F-03", "Session 3 date", { kind: "docx", target: "table_cell", blockId: "t0.r3.c1" }),
    field("F-04", "Comments", { kind: "docx", target: "table_cell", blockId: "t1.r0.c1" }),
  ];
  const out = fill({ "F-01": { text: "18/03/2026" }, "F-02": { leftBlank: true }, "F-03": { leftBlank: true }, "F-04": { text: "Discharged." } }, { form: formOf(bytes, fields), bytes });
  assert.ok(out.xml.includes("Discharged.") && out.xml.includes("18/03/2026"));
  assert.ok(!out.xml.includes("Delete unused cells"));
  assert.deepEqual(out.outcomes.map((o) => [o.fieldId, o.outcome, o.fatal]), [["F-01", "written", false], ["F-02", "as_printed", false], ["F-03", "as_printed", false], ["F-04", "written", false]]);
});

test("not found and collision are fatal: a place not on the form, a placeholder not there, two answers in one place", () => {
  const missing = field("F-20", "Not on this file", { kind: "docx", target: "table_cell", blockId: "t9.r0.c0" });
  const noPlaceholder = field("F-21", "Placeholder gone", { kind: "docx", target: "replace_placeholder", blockId: "t0.r11.c1", placeholderText: "[Insert value]" });
  const twice = field("F-22", "Same cell again", { kind: "docx", target: "table_cell", blockId: "t0.r11.c1" });
  const form = formOf(FORM_BYTES, [...FIELDS, missing, noPlaceholder, twice]);
  const out = fill({ "F-11": { text: "One." }, "F-20": { text: "x" }, "F-21": { text: "y" }, "F-22": { text: "Two." } }, { form });
  assert.deepEqual([out.by["F-20"].outcome, out.by["F-20"].fatal], ["not_found", true]);
  assert.deepEqual([out.by["F-21"].outcome, out.by["F-21"].fatal], ["not_found", true]);
  assert.deepEqual([out.by["F-22"].outcome, out.by["F-22"].fatal], ["collision", true]);
  assert.deepEqual([out.by["F-11"].outcome, out.by["F-11"].fatal], ["collision", true], "both answers mapped to one place are fatal");
  // A left-blank box whose place is missing is fatal too: the map does not fit this file.
  const blank = fill({ "F-20": { leftBlank: true } }, { form });
  assert.equal(blank.by["F-20"].fatal, true);
  // More answers than the blanks of one placeholder in that place: a collision.
  const two = field("F-23", "Second answer for the opener", { kind: "docx", target: "replace_placeholder", blockId: "t0.r6.c1", placeholderText: "…" });
  const over = fill({ "F-06": { text: "work" }, "F-23": { text: "sport" } }, { form: formOf(FORM_BYTES, [...FIELDS, two]) });
  assert.equal(over.by["F-23"].outcome, "collision");
  assert.equal(over.by["F-23"].fatal, true);
});

test("an answer never takes a placeholder inside another answer (masked search); two blanks of one sentence fill in order", () => {
  const bytes = docx(p(r("He reported … and … since the fall.")));
  const fields = [field("F-01", "First", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "…" }), field("F-02", "Second", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "…" })];
  const out = fill({ "F-01": { text: "neck pain…" }, "F-02": { text: "stiffness" } }, { form: formOf(bytes, fields), bytes });
  assert.equal(out.t.p0, "He reported neck pain… and stiffness since the fall.");
  assert.ok(out.outcomes.every((o) => o.outcome === "written" && !o.fatal));
});

test("repeated printed words: an answer repeating the opener's lead is fatal residue (B2-8, B3-8) – one repeated word too (review 26/10)", () => {
  const out = fill({ "F-06": { text: "return to lighter duties" } });
  assert.equal(out.by["F-06"].fatal, true);
  assert.match(out.by["F-06"].residue?.[0] ?? "", /“return to” are repeated/);
  assert.equal(repeatedLead("To return to", "return to work"), "return to");
  assert.equal(repeatedLead("To return to", "lighter duties"), "");
  assert.equal(repeatedLead("Since", "since March"), "since");
  // ADV-6: one word printed twice across the blank ("To return to to work", "fit in in 6 weeks") is never right.
  assert.equal(repeatedLead("To return to", "to work"), "to");
  assert.equal(repeatedLead("Expected to be fit in", "in 6 weeks"), "in");
  const once = fill({ "F-06": { text: "to work" } });
  assert.equal(once.by["F-06"].fatal, true);
  assert.match(once.by["F-06"].residue?.[0] ?? "", /the printed words “to” are repeated by the answer/);
});

test("the printed lead of a blank: a sentence opener ends in a word that needs one more; a label does not", () => {
  assert.equal(leadBefore("To return to …", 13), "To return to");
  assert.equal(leadBefore("Expected outcome – to return to …", 32), "to return to");
  assert.equal(leadBefore("Plan B. To resume work at …", 25), "To resume work at");
  assert.equal(leadBefore("Date: ……", 6), "", "after a colon: a label");
  assert.equal(openerLead("To return to"), "To return to");
  assert.equal(openerLead("He has been off work since"), "He has been off work since");
  assert.equal(openerLead("Name of physiotherapist"), "");
  assert.equal(openerLead("Date"), "");
  // ADV-5 (review 26/10): a sentence opener reads as a clause – an auxiliary, or "to" before a verb; a label ending in a
  // preposition after a participle or noun is a label.
  assert.equal(openerLead("Expected to be fit in"), "Expected to be fit in");
  assert.equal(openerLead("Pain is"), "Pain is");
  for (const label of ["Assessed by", "Referred by", "Referred to", "Signed on behalf of", "Copy to", "Date of", "Name of"]) assert.equal(openerLead(label), "", label);
  // The map's printedLeads entry is used when the line ends with it.
  const known = formOf(FORM_BYTES, FIELDS);
  known.analysis.printedLeads = { "F-07": "Name of physiotherapist" };
  const out = fill({ "F-07": { leftBlank: true } }, { form: known });
  assert.equal(out.t["t0.r7.c1"], "", "a lead the map records is dropped with its dots");
  assert.equal(out.by["F-07"].outcome, "removed");
});

test("sign-off values are decided answers: written, or fatal when their place is missing", () => {
  const bytes = docx(tbl(tr(cell("Name"), cell("")), tr(cell("Date"), cell(""))));
  const fields = [field("F-01", "Name", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, { fillSource: { kind: "signoff", part: "name" }, answerType: "clinician_name" }), field("F-02", "Date", { kind: "docx", target: "table_cell", blockId: "t0.r5.c1" }, { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed" })];
  const out = fill({ "F-01": { text: "Sarah Reid" }, "F-02": { text: "26/10/2026", value: "2026-10-26" } }, { form: formOf(bytes, fields), bytes });
  assert.deepEqual(out.outcomes.map((o) => [o.fieldId, o.intended, o.outcome, o.fatal]), [["F-01", "signoff", "written", false], ["F-02", "signoff", "not_found", true]]);
  // A draft has no receipt: sign-off fields are not decided, never fatal.
  const draft = fill({}, { form: formOf(bytes, fields), bytes, draft: true });
  assert.ok(draft.outcomes.every((o) => !o.fatal));
});

test("a draft reports the same outcomes and is never refused; undecided boxes (no answer yet) are never fatal", async () => {
  const draft = await renderFormFile({ form: FORM, file: { bytes: FORM_BYTES, mimeType: DOCX_MIME, sha256: FORM.file.sha256, sizeBytes: FORM_BYTES.byteLength }, answers: { "F-01": { text: "Not recorded" } }, draft: true, format: "original" });
  assert.equal(draft.outcomes?.find((o) => o.fieldId === "F-01")?.fatal, true);
  assert.ok(draft.outcomes?.filter((o) => o.fieldId !== "F-01").every((o) => !o.fatal));
});

test("strict FINAL: refused 422 with one issue per field and the outcomes; report-only makes the copy", async () => {
  const file = { bytes: FORM_BYTES, mimeType: DOCX_MIME, sha256: FORM.file.sha256, sizeBytes: FORM_BYTES.byteLength };
  const answers: FormFillAnswers = { ...ALL_BLANK, "F-05": { text: "None." }, "F-02": { text: "Very little", value: "Very little" } };
  await assert.rejects(
    () => renderFormFile({ form: FORM, file, answers, draft: false, format: "original" }),
    (err: unknown) => {
      assert.ok(err instanceof FillRefusedError);
      assert.equal(err.status, 422);
      assert.equal(err.init.code, "FORM_INVALID");
      assert.deepEqual(err.init.issues?.map((i) => i.path), ["fields.F-02"]);
      assert.match(err.init.issues?.[0].message ?? "", /F-02 \(“Sleep affected”\): the answer “Very little” is none of the printed options/);
      assert.ok(err.outcomes.length === FIELDS.length);
      return true;
    },
  );
  const reportOnly = await renderFormFile({ form: FORM, file, answers, draft: false, format: "original", strict: false });
  assert.equal(reportOnly.outcomes?.filter((o) => o.fatal).length, 1);
  const clean = await renderFormFile({ form: FORM, file, answers: { ...ALL_BLANK, "F-05": { text: "None." } }, draft: false, format: "original" });
  assert.ok(clean.outcomes?.every((o) => !o.fatal));
});

test("the outcomes header: URI-encoded JSON, fatal first when the list must be cut, never over the size cap", () => {
  assert.deepEqual(fillOutcomesHeader([]), {});
  const one: FillOutcome[] = [{ fieldId: "F-01", intended: "answer", outcome: "written", fatal: false }];
  assert.deepEqual(JSON.parse(decodeURIComponent(fillOutcomesHeader(one)[HEADERS.fillOutcomes])), one);
  const many: FillOutcome[] = Array.from({ length: 400 }, (_, i) => ({ fieldId: `F-${String(i + 1).padStart(3, "0")}`, intended: "answer", outcome: "written", fatal: i === 399, note: i === 399 ? "x".repeat(500) : undefined }));
  const header = fillOutcomesHeader(many)[HEADERS.fillOutcomes];
  assert.ok(header.length <= 7_000);
  const parsed = JSON.parse(decodeURIComponent(header)) as FillOutcome[];
  assert.ok(parsed.some((o) => o.fieldId === "F-400" && o.fatal && (o.note ?? "").length <= 120), "the fatal outcome is kept, its note cut");
  assert.deepEqual(parsed.map((o) => o.fieldId), parsed.map((o) => o.fieldId).slice().sort(), "in form order");
});

test("choiceAnswerMatches (WA1's approval check, Q-1): the engine's own reading – unknown and unmatched answers, text on choice anchors too", () => {
  const yn = F.glyph;
  const answer = (kind: FormAnswer["kind"], value: FormAnswer["value"]): FormAnswer => ({ kind, value });
  assert.equal(choiceAnswerMatches(yn, answer("yes_no", true)), true);
  assert.equal(choiceAnswerMatches(yn, answer("yes_no", null)), true, "no answer yet: placeholders' job");
  assert.equal(choiceAnswerMatches(F.mark, answer("choice", "A lot")), true);
  assert.equal(choiceAnswerMatches(F.mark, answer("choice", "Very little")), false);
  assert.equal(choiceAnswerMatches(F.list, answer("choice", "Hydrotherapy")), false);
  // Q-1: a TEXT answer on a choice anchor is read the way the fill reads it.
  assert.equal(choiceAnswerMatches(F.glyph, answer("text", "Not recorded")), false);
  assert.equal(choiceAnswerMatches(F.glyph, answer("text", "Yes – see notes")), true);
  assert.equal(choiceAnswerMatches(F.mark, answer("text", "Not recorded")), false);
  assert.equal(choiceAnswerMatches(F.grid, answer("text", "Neck, Knee")), true);
  assert.equal(choiceAnswerMatches(F.grid, answer("text", "None")), true, "“None” names no printed column: nothing marked");
  assert.equal(choiceAnswerMatches(F.grid, answer("text", "Elbow")), false);
  assert.equal(choiceAnswerMatches(F.cell, answer("text", "Anything at all")), true, "free text on a text box");
  // The same reading as the engine's.
  assert.deepEqual(resolveChoice(F.glyph, { value: false }, ["Yes", "No"]), { kind: "chosen", options: ["No"] });
  assert.deepEqual(resolveChoice(F.glyph, { value: true }, ["Yes"]), { kind: "chosen", options: ["Yes"] });
  assert.deepEqual(resolveChoice(F.glyph, { value: false }, ["Yes"]), { kind: "chosen", options: [] }, "No on a single box: left unticked");
  assert.deepEqual(resolveChoice(F.glyph, { value: true }, ["Full duties", "Lighter duties"]), { kind: "unmatched", text: "Yes" });
  assert.deepEqual(resolveChoice(F.mark, { text: "Not recorded" }, ["Not at all", "A little"]), { kind: "unknown", text: "Not recorded" });
});

test("request caps: at most 400 questions and 20 sharing a place; Blue Heart-like shared lines are fine", () => {
  const many = Array.from({ length: MAX_REQUEST_FIELDS + 1 }, (_, i) => field(`F-${i + 1}`, `Q${i}`, { kind: "docx", target: "table_cell", blockId: `t0.r${i}.c1` }));
  assert.equal(formRequestCapIssues({ fields: many.slice(0, MAX_REQUEST_FIELDS) }).length, 0);
  assert.match(formRequestCapIssues({ fields: many })[0].message, /401 questions; a form can have at most 400/);
  const crowded = Array.from({ length: MAX_FIELDS_PER_BLOCK + 1 }, (_, i) => field(`F-${i + 1}`, `Q${i}`, { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "____" }));
  assert.equal(formRequestCapIssues({ fields: crowded.slice(0, MAX_FIELDS_PER_BLOCK) }).length, 0, "20 blanks on one line are allowed");
  assert.match(formRequestCapIssues({ fields: crowded })[0].message, /21 questions have their place in the same part of the form \(p0\)/);
  // Option cells count in their own blocks.
  const grid = field("F-01", "Grid", { kind: "docx", target: "mark_cell", blockId: "t0.r0.c1", optionCells: [{ option: "A", blockId: "t0.r0.c1" }, { option: "B", blockId: "t0.r0.c2" }] });
  assert.equal(formRequestCapIssues({ fields: [grid] }).length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Review 26/10 (check-WA2): the minors
 * ----------------------------------------------------------------------------------------------*/

test("ADV-11: a blank left printed is skipped – a later answer mapped to the same placeholder takes the next blank", () => {
  const bytes = docx(tbl(tr(cell("Signed"), cell("Name ______ Date ______"))));
  const fields = [
    field("F-01", "Name", { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c1", placeholderText: "______" }),
    field("F-02", "Date", { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c1", placeholderText: "______" }),
  ];
  const form = formOf(bytes, fields);
  const want = "Name ______ Date 26/10/2026";
  const out = fill({ "F-01": { leftBlank: true }, "F-02": { text: "26/10/2026" } }, { form, bytes });
  assert.equal(out.t["t0.r0.c1"], want, "left blank");
  assert.ok(out.outcomes.every((o) => !o.fatal), JSON.stringify(out.outcomes));
  const na = fill({ "F-02": { text: "26/10/2026" } }, { form, bytes, states: { "F-01": { kind: "not_applicable", reason: "condition" } } });
  assert.equal(na.t["t0.r0.c1"], want, "not applicable");
  // The record has nothing for it: its blank is removed (as a clinic system's code is), the date still in its own place.
  const empty = fill({ "F-01": { text: "", blank: true }, "F-02": { text: "26/10/2026" } }, { form, bytes });
  assert.equal(empty.t["t0.r0.c1"], "Name  Date 26/10/2026", "record empty");
  // The draft shows it the same way.
  assert.equal(fill({ "F-02": { text: "26/10/2026" } }, { form, bytes, draft: true }).t["t0.r0.c1"], want, "draft");
});

test("Q-1 (ADV-1): “No” followed by words for missing knowledge is not a definite No – as printed, fatal, and the approval check refuses it", () => {
  const unknowns = ["No idea", "No info", "No mention in the notes", "No answer recorded", "No recollection", "No response from patient", "No notes on this"];
  const options = ["Yes", "No"];
  for (const text of unknowns) {
    assert.equal(resolveChoice(F.glyph, { text }, options).kind, "unknown", text);
    assert.equal(resolveChoice(F.glyph, { text, value: false }, options).kind, "unknown", `${text}: a value read from the text is not trusted`);
    assert.equal(choiceAnswerMatches(F.glyph, { kind: "text", value: text }), false, text);
    const out = fill({ "F-01": { text } });
    assert.equal(out.t["t0.r0.c1"], "☒ Yes  ☐ No", `${text}: as printed`);
    assert.equal(out.by["F-01"].fatal, true, text);
  }
  // A clinical negative is still a No.
  for (const text of ["No", "No pain", "No restrictions", "No evidence of instability", "No – full range"]) assert.deepEqual(resolveChoice(F.glyph, { text }, options), { kind: "chosen", options: ["No"] }, text);
});

test("ADV-2: an answer naming several options of a single choice is none of them – never the first only; a yes beside a no reads as its first", () => {
  const options = ["Exercise", "Manual therapy", "Taping"];
  for (const text of ["Exercise and taping", "Manual therapy, exercise", "Taping / Exercise"]) {
    assert.equal(resolveChoice(F.list, { text }, options).kind, "unmatched", text);
    const out = fill({ "F-03": { text } });
    assert.equal(out.t["t0.r3.c1"], "Exercise / Manual therapy / Taping", `${text}: as printed`);
    assert.equal(out.by["F-03"].fatal, true, text);
  }
  assert.deepEqual(resolveChoice(F.list, { text: "Manual therapy" }, options), { kind: "chosen", options: ["Manual therapy"] });
  assert.deepEqual(resolveChoice(F.list, { text: "Taping – left knee" }, options), { kind: "chosen", options: ["Taping"] });
  const yn = { ...F.glyph, answerType: "single_choice" as const };
  assert.deepEqual(resolveChoice(yn, { text: "Yes – no restrictions" }, ["Yes", "No"]), { kind: "chosen", options: ["Yes"] });
  // A "tick all that apply" row still takes several.
  assert.deepEqual(resolveChoice(F.grid, { text: "Neck and back" }, ["Neck", "Back", "Knee"]), { kind: "chosen", options: ["Neck", "Back"] });
});

test("ADV-7b: a chosen column's mark cleared later by another answer mapped onto the same cell is fatal", () => {
  const misMapped = field("F-13", "Mis-mapped", { kind: "docx", target: "mark_cell", blockId: "t0.r2.c1", optionCells: [{ option: "Yes", blockId: "t0.r2.c1" }, { option: "No", blockId: "t0.r13.c2" }], mark: "x" }, { answerType: "single_choice", options: ["Yes", "No"] });
  const form = formOf(FORM_BYTES, [...FIELDS, misMapped]);
  const out = fill({ "F-12": { text: "Neck, Back" }, "F-13": { text: "Yes", value: "Yes" } }, { form });
  assert.equal(out.t["t0.r13.c2"], "", "Back's mark was cleared by the mis-mapped question");
  assert.equal(out.by["F-12"].fatal, true);
  assert.match((out.by["F-12"].residue ?? []).join(" "), /the chosen “Back” is not marked/);
  // Mapped correctly, both hold.
  const ok = fill({ "F-12": { text: "Neck, Back" } });
  assert.equal(ok.by["F-12"].fatal, false);
});

test("ADV-3: a record-empty choice box is a blank box (pre-printed tick cleared); an undecided FINAL box keeps its print but a pre-printed tick refuses it", () => {
  const empty = fill({}, { states: { "F-01": { kind: "blank", reason: "record_empty" } } });
  assert.equal(empty.t["t0.r0.c1"], "☐ Yes  ☐ No");
  assert.deepEqual([empty.by["F-01"].outcome, empty.by["F-01"].fatal], ["cleared", false]);
  const blankText = fill({ "F-01": { text: "", blank: true }, "F-02": { text: "", blank: true } });
  assert.equal(blankText.t["t0.r0.c1"], "☐ Yes  ☐ No");
  assert.equal(blankText.t["t0.r2.c2"], "", "the pre-printed mark is cleared");
  // {} on a FINAL copy (a box without a report section): written as before – but what it issues reads as an answer.
  const undecided = fill({});
  assert.equal(undecided.t["t0.r0.c1"], "☒ Yes  ☐ No", "nothing is cleared");
  assert.equal(undecided.by["F-01"].fatal, true);
  assert.match(undecided.by["F-01"].residue?.[0] ?? "", /“Yes” is ticked/);
  assert.equal(undecided.by["F-02"].fatal, true, "the pre-printed mark");
  assert.equal(undecided.by["F-04"].fatal, true, "its default “30 minutes”");
  for (const id of ["F-03", "F-06", "F-07", "F-08", "F-11"]) assert.equal(undecided.by[id].fatal, false, `${id}: a list, opener, label, frame or empty cell left as printed is not an answer`);
  // A draft: no answer yet, never fatal.
  assert.ok(fill({}, { draft: true }).outcomes.every((o) => !o.fatal));
});

test("ADV-4: report-only (strict: false) never makes a FINAL copy that prints a mail-merge field", async () => {
  const bytes = docx(p(r("Reference: &lt;&lt;P_REF&gt;&gt;")) + tbl(tr(cell("Findings"), cell(""))));
  const form = formOf(bytes, [field("F-01", "Findings", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" })]);
  const file = { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength };
  for (const strict of [true, false]) {
    await assert.rejects(() => renderFormFile({ form, file, answers: { "F-01": { text: "Full range." } }, draft: false, format: "original", strict }), /mail-merge field/, `strict ${strict}`);
  }
  const draft = await renderFormFile({ form, file, answers: { "F-01": { text: "Full range." } }, draft: true, format: "original", strict: false });
  assert.match(draft.warnings[0] ?? "", /mail-merge field/);
});

test("ADV-5: left blank, a label ending in a preposition stays whole; an opener in a printed question stays", () => {
  const bytes = docx(tbl(tr(cell("Assessment"), cell("Assessed by ……")), tr(cell("Copy"), cell("Copy to …")), tr(cell("Work"), cell("Was she able to …?")), tr(cell("Plan"), cell("Expected to be fit in …"))));
  const ids = ["F-01", "F-02", "F-03", "F-04"];
  const placeholders = ["……", "…", "…", "…"];
  const fields = ids.map((id, i) => field(id, `Box ${i}`, { kind: "docx", target: "replace_placeholder", blockId: `t0.r${i}.c1`, placeholderText: placeholders[i] }));
  const out = fill(Object.fromEntries(ids.map((id) => [id, { leftBlank: true }])), { form: formOf(bytes, fields), bytes });
  assert.equal(out.t["t0.r0.c1"], "Assessed by ……");
  assert.equal(out.t["t0.r1.c1"], "Copy to …");
  assert.equal(out.t["t0.r2.c1"], "Was she able to …?");
  assert.equal(out.t["t0.r3.c1"], "", "a clause opener still goes (B3-19)");
  assert.ok(out.outcomes.every((o) => !o.fatal), JSON.stringify(out.outcomes));
});
