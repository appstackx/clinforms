/**
 * Choice layouts of clinic templates kept in a practice system (10/2026, product gaps P17 / P18), on small FICTIONAL
 * Word documents that mimic each pattern:
 *
 * - typed tick boxes "[ ]" / "[]" / "[x]" (in one cell, across cells, split over runs) are tick boxes: read as such by
 *   the outline (never as placeholders) and ticked / cleared in the form's own style;
 * - "mark the column" tables (mark_cell): the chosen column's cell is marked, a printed default mark in another column
 *   is removed, a cell that prints the option itself gets the mark after it, a "tick all that apply" row marks every
 *   named option – and never the wrong column;
 * - "delete as necessary" lists (delete_options): only the chosen option is kept, the others are removed (inline lists,
 *   one option per line, a single item kept or deleted);
 * - the map checks, the approval check (choice-marks) and the rules reading's proposals for all three.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { checkFormDefinition, namedOptions } from "../core/forms";
import type { FormAnchor, FormDefinition, FormField, Report } from "../core/types";
import { validateChoiceMarks } from "../core/validation/choice-marks";
import { buildDocxOutline } from "./docx-outline";
import { fillDocx } from "./docx-fill";
import { bracketBoxText, findPlaceholders, withBracketBoxesAsGlyphs } from "./docx-dom";
import { postValidateFields } from "../ai/form-postvalidate";
import { proposeFieldsByRules } from "../ai/form-rules";
import type { ValidatorInput } from "../core/validation";

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

const p = (inner: string) => `<w:p>${inner}</w:p>`;
const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const tc = (...paras: string[]) => `<w:tc>${paras.join("") || p("")}</w:tc>`;
const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;
const cell = (text: string) => tc(text ? p(r(text)) : p(""));

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function form(fields: FormField[]): FormDefinition {
  return {
    id: "frm_choices",
    tenantId: "demo",
    referrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" },
    title: "Choice layouts (fictional)",
    file: { fileName: "t.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-24T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-24T09:00:00.000Z",
    updatedAt: "2026-10-24T09:00:00.000Z",
  };
}

const texts = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));
const outlineOf = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b]));

/* ------------------------------------------------------------------------------------------------
 * Typed tick boxes
 * ----------------------------------------------------------------------------------------------*/

const TYPED = docx(
  [
    tbl(
      tr(cell("Any warning signs found"), cell("Yes [] No [x]")),
      tr(cell("Back at work now?"), cell("Yes [x]"), cell("No[]"), cell("If not, when?")),
      tr(cell("How often"), cell("Daily [x]"), cell("Weekly [ ]"), cell("Monthly [ ]")),
      // A box Word split over two runs.
      tr(cell("Consent seen"), tc(p(r("Yes [") + r("x]")))),
    ),
    p(r("Reference: [Insert reference]")),
  ].join(""),
);

test("typed tick boxes: the outline counts them as tick boxes, never as placeholders; other brackets stay placeholders", () => {
  const ol = outlineOf(TYPED);
  assert.equal(ol["t0.r0.c1"].checkboxGlyphs, 2);
  assert.equal(ol["t0.r0.c1"].hasPlaceholder, false, "“[]” / “[x]” are not fill-in placeholders");
  assert.equal(ol["t0.r1.c1"].checkboxGlyphs, 1);
  assert.equal(ol["t0.r1.c2"].checkboxGlyphs, 1);
  assert.equal(ol["t0.r3.c1"].checkboxGlyphs, 1, "a box split over runs is one box");
  assert.equal(ol.p0.hasPlaceholder, true);
  assert.equal(ol.p0.placeholderText, "[Insert reference]");
  assert.deepEqual(findPlaceholders("Name: [x] and [ ] and [Insert name]").map((m) => m.text), ["[Insert name]"]);
  assert.equal(withBracketBoxesAsGlyphs("Yes [] No [x] [ ] [X] [Case_ID]"), "Yes ☐ No ☒ ☐ ☒ [Case_ID]");
  assert.equal(bracketBoxText("[]", true), "[x]");
  assert.equal(bracketBoxText("[ x ]", false), "[ ]");
  assert.equal(bracketBoxText("[X]", true), "[X]");
  assert.equal(bracketBoxText("[]", false), "[]");
});

test("typed tick boxes: the answer is ticked in the form's own style and the default tick is cleared", () => {
  const f = form([
    field("F-01", "Any warning signs found", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r0.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r0.c1", glyphIndex: 0 }, { option: "No", blockId: "t0.r0.c1", glyphIndex: 1 }] }, { answerType: "yes_no", options: ["Yes", "No"] }),
    field("F-02", "Back at work now?", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r1.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r1.c1", glyphIndex: 0 }, { option: "No", blockId: "t0.r1.c2", glyphIndex: 0 }] }, { answerType: "yes_no", options: ["Yes", "No"] }),
    field("F-03", "How often", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r2.c1", optionGlyphs: ["Daily", "Weekly", "Monthly"].map((option, i) => ({ option, blockId: `t0.r2.c${i + 1}`, glyphIndex: 0 })) }, { answerType: "single_choice", options: ["Daily", "Weekly", "Monthly"] }),
    field("F-04", "Consent seen", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r3.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r3.c1", glyphIndex: 0 }] }, { answerType: "checkbox", options: ["Yes"] }),
  ]);
  const out = fillDocx(TYPED, f, { "F-01": { text: "Yes", value: true }, "F-02": { text: "No", value: false }, "F-03": { text: "Weekly", value: "Weekly" }, "F-04": { text: "No", value: false } }, { draft: false });
  const t = texts(out);
  assert.equal(t["t0.r0.c1"], "Yes [x] No [ ]");
  assert.equal(t["t0.r1.c1"], "Yes [ ]");
  assert.equal(t["t0.r1.c2"], "No[x]");
  assert.equal(t["t0.r2.c1"], "Daily [ ]");
  assert.equal(t["t0.r2.c2"], "Weekly [x]");
  assert.equal(t["t0.r2.c3"], "Monthly [ ]");
  assert.equal(t["t0.r3.c1"], "Yes [ ]", "a box split over runs is cleared as one box");
  assert.equal(t.p0, "Reference: [Insert reference]");
  // Unanswered: every box stays as printed.
  assert.deepEqual(texts(fillDocx(TYPED, f, {}, { draft: false })), texts(TYPED));
});

/* ------------------------------------------------------------------------------------------------
 * Mark the column
 * ----------------------------------------------------------------------------------------------*/

const GRID = docx(
  [
    tbl(
      tr(cell(""), cell("Yes"), cell("No"), cell(""), cell("")),
      tr(cell("Saw a doctor"), cell(""), cell(""), cell("Details if yes"), cell("")),
      tr(cell("Went to A&amp;E"), cell("x"), cell(""), cell("Details if yes"), cell("")),
    ),
    tbl(tr(cell("0%"), cell("20%"), cell("40%"), cell("100%"))),
    tbl(
      tr(cell(""), cell("Neck"), cell("Back"), cell("Shoulder")),
      tr(cell("Stiffness"), cell(""), cell(""), cell("")),
    ),
    tbl(tr(cell("Taping"), cell("x")), tr(cell("Hydrotherapy"), cell(""))),
  ].join(""),
);

const yesNoRow = (id: string, label: string, row: number): FormField =>
  field(id, label, { kind: "docx", target: "mark_cell", blockId: `t0.r${row}.c1`, optionCells: [{ option: "Yes", blockId: `t0.r${row}.c1` }, { option: "No", blockId: `t0.r${row}.c2` }] }, { answerType: "yes_no", options: ["Yes", "No"] });

const GRID_FORM = form([
  yesNoRow("F-01", "Saw a doctor", 1),
  yesNoRow("F-02", "Went to A&E", 2),
  field("F-03", "Share of usual activities managed", { kind: "docx", target: "mark_cell", blockId: "t1.r0.c0", optionCells: ["0%", "20%", "40%", "100%"].map((option, i) => ({ option, blockId: `t1.r0.c${i}` })) }, { answerType: "single_choice", options: ["0%", "20%", "40%", "100%"] }),
  field("F-04", "Stiffness", { kind: "docx", target: "mark_cell", blockId: "t2.r1.c1", optionCells: ["Neck", "Back", "Shoulder"].map((option, i) => ({ option, blockId: `t2.r1.c${i + 1}` })) }, { answerType: "short_text", options: ["Neck", "Back", "Shoulder"] }),
  field("F-05", "Taping", { kind: "docx", target: "mark_cell", blockId: "t3.r0.c1", optionCells: [{ option: "Taping", blockId: "t3.r0.c1" }], mark: "x" }, { answerType: "checkbox", options: ["Taping"] }),
  field("F-06", "Hydrotherapy", { kind: "docx", target: "mark_cell", blockId: "t3.r1.c1", optionCells: [{ option: "Hydrotherapy", blockId: "t3.r1.c1" }], mark: "x" }, { answerType: "checkbox", options: ["Hydrotherapy"] }),
]);

test("mark the column: the chosen column is marked, a default mark in the other column is removed, never the wrong column", () => {
  const warnings: string[] = [];
  const out = fillDocx(
    GRID,
    GRID_FORM,
    {
      "F-01": { text: "No", value: false },
      "F-02": { text: "No", value: false },
      "F-03": { text: "40%", value: "40%" },
      "F-04": { text: "Neck and Shoulder" },
      "F-05": { text: "No", value: false },
      "F-06": { text: "Yes", value: true },
    },
    { draft: false, onWarning: (w) => warnings.push(w) },
  );
  const t = texts(out);
  assert.equal(t["t0.r1.c1"], "", "the Yes column of the first row is left empty");
  assert.equal(t["t0.r1.c2"], "X", "the No column of the first row is marked");
  assert.equal(t["t0.r2.c1"], "", "the printed default mark under Yes is removed");
  assert.equal(t["t0.r2.c2"], "X");
  assert.equal(t["t0.r1.c3"], "Details if yes", "the details cell is untouched");
  assert.equal(t["t1.r0.c2"], "40% X", "a cell that prints the option gets the mark after it");
  assert.equal(t["t1.r0.c1"], "20%");
  assert.deepEqual([t["t2.r1.c1"], t["t2.r1.c2"], t["t2.r1.c3"]], ["X", "", "X"], "every option named is marked");
  assert.equal(t["t3.r0.c1"], "", "an untreated modality's default mark is removed");
  assert.equal(t["t3.r1.c1"], "x", "the form's own mark style is kept");
  assert.deepEqual(warnings, []);
  // The mark is bold in the cell's own run.
  assert.match(new PizZip(out).file("word/document.xml")!.asText(), /<w:b\/><\/w:rPr><w:t xml:space="preserve">X<\/w:t>/);
});

test("mark the column: an answer that names something not printed marks nothing (and is flagged); “None” marks nothing", () => {
  const warnings: string[] = [];
  const t = texts(fillDocx(GRID, GRID_FORM, { "F-04": { text: "Neck, Elbow" }, "F-03": { text: "Not recorded" } }, { draft: false, onWarning: (w) => warnings.push(w) }));
  assert.deepEqual([t["t2.r1.c1"], t["t2.r1.c2"], t["t2.r1.c3"]], ["", "", ""]);
  assert.equal(t["t1.r0.c2"], "40%", "an unknown answer never marks a column");
  assert.ok(warnings.some((w) => /“Elbow” is not one of the printed columns/.test(w)));
  assert.deepEqual(namedOptions(["Neck", "Back"], "None"), { matched: [], unmatched: "" });
  assert.deepEqual(namedOptions(["None or N/A", "Mild"], "None or N/A"), { matched: ["None or N/A"], unmatched: "" });
  assert.deepEqual(namedOptions(["Neck", "Back", "Shoulder"], "Back, neck."), { matched: ["Neck", "Back"], unmatched: "" });
  // Unanswered: the printed default marks stay as printed.
  const blank = texts(fillDocx(GRID, GRID_FORM, {}, { draft: false }));
  assert.equal(blank["t0.r2.c1"], "x");
  assert.equal(blank["t3.r0.c1"], "x");
});

/* ------------------------------------------------------------------------------------------------
 * Delete as necessary
 * ----------------------------------------------------------------------------------------------*/

const LISTS = docx(
  [
    p(r("How often will the client attend? Daily/Weekly/Monthly")),
    p(r("Any medication? ") + r("Yes/No", "<w:b/>")),
    tbl(
      tr(
        tc(p(r("Duties: (please delete) Full duties")), p(r("Light duties")), p(r("Off work"))),
        tc(p(r("Cause Delete as necessary")), p(r("At work")), p(r("Outside work"))),
      ),
      tr(cell("Progress since treatment began?"), cell("Better / Same / Worse")),
      tr(cell("No overhead lifting"), cell("")),
    ),
  ].join(""),
);

const LIST_FORM = form([
  field("F-01", "How often will the client attend?", { kind: "docx", target: "delete_options", blockId: "p0", placeholderText: "Daily/Weekly/Monthly" }, { answerType: "single_choice", options: ["Daily", "Weekly", "Monthly"] }),
  field("F-02", "Any medication?", { kind: "docx", target: "delete_options", blockId: "p1", placeholderText: "Yes/No" }, { answerType: "yes_no", options: ["Yes", "No"] }),
  field(
    "F-03",
    "Duties",
    {
      kind: "docx",
      target: "delete_options",
      blockId: "t0.r0.c0.p0",
      optionTexts: [
        { option: "Full duties", blockId: "t0.r0.c0.p0", text: "Full duties" },
        { option: "Light duties", blockId: "t0.r0.c0.p1", text: "Light duties" },
        { option: "Off work", blockId: "t0.r0.c0.p2", text: "Off work" },
      ],
    },
    { answerType: "single_choice", options: ["Full duties", "Light duties", "Off work"] },
  ),
  field(
    "F-04",
    "Cause",
    { kind: "docx", target: "delete_options", blockId: "t0.r0.c1.p1", optionTexts: [{ option: "At work", blockId: "t0.r0.c1.p1", text: "At work" }, { option: "Outside work", blockId: "t0.r0.c1.p2", text: "Outside work" }] },
    { answerType: "single_choice", options: ["At work", "Outside work"] },
  ),
  field("F-05", "Progress since treatment began?", { kind: "docx", target: "delete_options", blockId: "t0.r1.c1", placeholderText: "Better / Same / Worse" }, { answerType: "single_choice", options: ["Better", "Same", "Worse"] }),
  field("F-06", "No overhead lifting", { kind: "docx", target: "delete_options", blockId: "t0.r2.c0", placeholderText: "No overhead lifting" }, { answerType: "checkbox", options: ["No overhead lifting"] }),
]);

test("delete as necessary: only the chosen option is kept – inline lists, one option per line, a single item", () => {
  const warnings: string[] = [];
  const out = fillDocx(
    LISTS,
    LIST_FORM,
    {
      "F-01": { text: "Weekly", value: "Weekly" },
      "F-02": { text: "No", value: false },
      "F-03": { text: "Light duties", value: "Light duties" },
      "F-04": { text: "Outside work", value: "Outside work" },
      "F-05": { text: "Better", value: "Better" },
      "F-06": { text: "No", value: false },
    },
    { draft: false, onWarning: (w) => warnings.push(w) },
  );
  const t = texts(out);
  assert.equal(t.p0, "How often will the client attend? Weekly");
  assert.equal(t.p1, "Any medication? No");
  assert.equal(t["t0.r0.c0"], "Duties: (please delete)\nLight duties", "the other options are removed, the instruction kept");
  assert.equal(t["t0.r0.c1"], "Cause Delete as necessary\nOutside work");
  assert.equal(t["t0.r1.c1"], "Better");
  assert.equal(t["t0.r2.c0"], "", "a restriction that does not apply is deleted");
  assert.deepEqual(warnings, []);
  // The kept option keeps the form's formatting (bold "Yes/No" → bold "No").
  assert.match(new PizZip(out).file("word/document.xml")!.asText(), /<w:b\/><\/w:rPr><w:t xml:space="preserve">No<\/w:t>/);
});

test("delete as necessary: unanswered, unknown or unmatched answers leave every option printed (never a guess)", () => {
  const warnings: string[] = [];
  const t = texts(fillDocx(LISTS, LIST_FORM, { "F-01": { text: "Hourly", value: "Hourly" }, "F-05": { text: "Not recorded" }, "F-06": { text: "Yes", value: true } }, { draft: false, onWarning: (w) => warnings.push(w) }));
  const before = texts(LISTS);
  assert.equal(t.p0, before.p0);
  assert.equal(t["t0.r0.c0"], before["t0.r0.c0"]);
  assert.equal(t["t0.r1.c1"], before["t0.r1.c1"]);
  assert.equal(t["t0.r2.c0"], "No overhead lifting", "a restriction that applies is kept");
  assert.ok(warnings.some((w) => /“Hourly” is not one of “Daily\/Weekly\/Monthly”/.test(w)));
});

/* ------------------------------------------------------------------------------------------------
 * Map checks, approval check, readings
 * ----------------------------------------------------------------------------------------------*/

test("map checks: a marked cell or a kept option needs its places and a choice answer", () => {
  const bad = form([
    field("F-01", "A", { kind: "docx", target: "mark_cell", blockId: "t0.r1.c1", optionCells: [] }, { answerType: "yes_no", options: ["Yes", "No"] }),
    field("F-02", "B", { kind: "docx", target: "mark_cell", blockId: "t0.r1.c1", optionCells: [{ option: "Yes", blockId: "t0.r1.c1" }, { option: "No", blockId: "t0.r1.c1" }] }, { answerType: "long_text" }),
    field("F-03", "C", { kind: "docx", target: "delete_options", blockId: "p0" }, { answerType: "single_choice", options: ["Weekly"] }),
    field("F-04", "D", { kind: "docx", target: "delete_options", blockId: "p0", placeholderText: "Weekly/Monthly" }, { answerType: "single_choice", options: ["Weekly", "Daily"] }),
  ]);
  const problems = checkFormDefinition(bad).join("\n");
  assert.match(problems, /F-01.*no cells to mark/);
  assert.match(problems, /F-02.*more than one option/);
  assert.match(problems, /F-02.*answer type must be/);
  assert.match(problems, /F-03.*say where the options/);
  assert.match(problems, /F-04.*every option must be printed/);
  assert.deepEqual(checkFormDefinition(GRID_FORM), []);
  assert.deepEqual(checkFormDefinition(LIST_FORM), []);
});

function reportWith(answers: Record<string, { text?: string; value?: string | boolean | null; kind: "text" | "choice" | "yes_no" | "checkbox" }>): Report {
  return {
    sections: Object.entries(answers).map(([key, a]) => ({
      key,
      title: key,
      kind: "ai_narrative",
      status: "complete",
      paragraphs: a.text ? [{ id: `${key}-p1`, text: a.text, sourceIds: [], origin: "clinician" }] : [],
      ...(a.kind !== "text" && { answer: { kind: a.kind, value: a.value ?? null } }),
    })),
  } as unknown as Report;
}

test("approval check: a “tick all that apply” answer naming something not printed blocks; printed options pass", () => {
  const input = (report: Report) => ({ report, form: GRID_FORM }) as unknown as ValidatorInput;
  const blocked = validateChoiceMarks(input(reportWith({ "F-04": { text: "Neck, Elbow", kind: "text" } })));
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].severity, "blocking");
  assert.match(blocked[0].message, /names “Elbow”, which is not printed on the form/);
  assert.deepEqual(validateChoiceMarks(input(reportWith({ "F-04": { text: "Neck, Shoulder", kind: "text" }, "F-01": { kind: "yes_no", value: false } }))), []);
  assert.deepEqual(validateChoiceMarks(input(reportWith({ "F-04": { text: "None", kind: "text" } }))), []);
  const choice = validateChoiceMarks(input(reportWith({ "F-03": { kind: "choice", value: "65%" } })));
  assert.equal(choice.length, 1);
});

test("the rules reading proposes typed tick boxes across cells, mark-the-column rows and delete-as-necessary lists", () => {
  const all = docx(
    [
      tbl(
        tr(cell("Back at work now?"), cell("Yes [x]"), cell("No[]")),
        tr(cell("Any warning signs found"), cell("Yes [] No [x]")),
        tr(cell("Taping"), cell("[x]")),
      ),
      tbl(tr(cell(""), cell("Not at all"), cell("A little"), cell("A lot")), tr(cell("Sleeping"), cell(""), cell(""), cell("")), tr(cell("Walking"), cell(""), cell(""), cell(""))),
      p(r("Any medication? Yes/No")),
      tbl(tr(tc(p(r("Area: Delete as necessary")), p(r("Spine")), p(r("Arm")), p(r("Leg"))))),
      tbl(tr(cell("Progress since treatment began?"), cell("Better / Same / Worse"))),
    ].join(""),
  );
  const outline = buildDocxOutline(all);
  const parsed = { kind: "docx" as const, blocks: outline.blocks, warnings: [] };
  const { fields } = postValidateFields(parsed, proposeFieldsByRules(parsed), { confidenceCap: "low" });
  const byLabel = (l: string) => fields.find((f) => f.label === l);
  const rtw = byLabel("Back at work now?");
  assert.equal(rtw?.answerType, "yes_no");
  assert.deepEqual(rtw?.anchor.kind === "docx" && rtw.anchor.optionGlyphs?.map((g) => g.blockId), ["t0.r0.c1", "t0.r0.c2"]);
  const flags = byLabel("Any warning signs found");
  assert.deepEqual(flags?.anchor.kind === "docx" && flags.anchor.optionGlyphs?.map((g) => `${g.option}#${g.glyphIndex}`), ["Yes#0", "No#1"]);
  assert.equal(byLabel("Taping")?.answerType, "checkbox");
  const sleeping = byLabel("Sleeping");
  assert.equal(sleeping?.anchor.kind === "docx" && sleeping.anchor.target, "mark_cell");
  assert.deepEqual(sleeping?.anchor.kind === "docx" && sleeping.anchor.optionCells, [
    { option: "Not at all", blockId: "t1.r1.c1" },
    { option: "A little", blockId: "t1.r1.c2" },
    { option: "A lot", blockId: "t1.r1.c3" },
  ]);
  assert.ok(byLabel("Walking"), "one question per row");
  assert.ok(!fields.some((f) => f.label === "Not at all"), "the heading row is no question");
  const meds = byLabel("Any medication?");
  assert.deepEqual(meds?.anchor, { kind: "docx", target: "delete_options", blockId: "p0", placeholderText: "Yes/No" });
  assert.equal(meds?.answerType, "yes_no");
  const body = byLabel("Area");
  assert.equal(body?.anchor.kind === "docx" && body.anchor.target, "delete_options");
  assert.deepEqual(body?.options, ["Spine", "Arm", "Leg"]);
  const cond = byLabel("Progress since treatment began?");
  assert.deepEqual(cond?.anchor, { kind: "docx", target: "delete_options", blockId: "t3.r0.c1", placeholderText: "Better / Same / Worse" });
  assert.deepEqual(checkFormDefinition(form(fields)), []);
});

test("post-validation keeps a live reading's marked cells and kept options, and drops places that are not in the form", () => {
  const outline = buildDocxOutline(GRID);
  const parsed = { kind: "docx" as const, blocks: outline.blocks, warnings: [] };
  const base = {
    section: "",
    guidance: "",
    placeholderText: "",
    overlay: { page: 0, x: 0, y: 0, width: 0, height: 0 },
    fillSource: "notes_narrative" as const,
    registrationPath: "none" as const,
    computedFact: "none" as const,
    computedFormat: "none" as const,
    signoffPart: "none" as const,
    required: true,
    confidence: "high" as const,
    note: "",
    completedBy: "clinic" as const,
  };
  const { fields, warnings } = postValidateFields(parsed, [
    { ...base, label: "Went to A&E", answerType: "yes_no", options: ["Yes", "No"], anchorTarget: "mark_cell", anchorRef: "t0.r2.c1", optionAnchors: [{ option: "Yes", ref: "t0.r2.c1", glyphIndex: 0 }, { option: "No", ref: "t0.r2.c2", glyphIndex: 0 }] },
    { ...base, label: "Taping", answerType: "checkbox", options: ["Taping"], anchorTarget: "mark_cell", anchorRef: "t3.r0.c1", optionAnchors: [{ option: "Taping", ref: "t3.r0.c1", glyphIndex: 0 }] },
    { ...base, label: "Elsewhere", answerType: "yes_no", options: ["Yes", "No"], anchorTarget: "mark_cell", anchorRef: "t9.r0.c0", optionAnchors: [{ option: "Yes", ref: "t9.r0.c0", glyphIndex: 0 }] },
  ]);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields[0].anchor, { kind: "docx", target: "mark_cell", blockId: "t0.r2.c1", optionCells: [{ option: "Yes", blockId: "t0.r2.c1" }, { option: "No", blockId: "t0.r2.c2" }], mark: "x" });
  assert.equal(fields[1].anchor.kind === "docx" && fields[1].anchor.mark, "x", "the form's own printed mark is used");
  assert.ok(warnings.some((w) => /“Elsewhere” were not found/.test(w)));
});

/* ------------------------------------------------------------------------------------------------
 * Printed details that must never go out (clearPlaceholder)
 * ----------------------------------------------------------------------------------------------*/

test("a printed detail marked clearPlaceholder never prints: replaced by the answer, removed while unanswered (DRAFT too)", () => {
  const file = docx(tbl(tr(cell("Registration:"), tc(p(r("Degree (fictional)")), p(r("HCPC: XX00000")), p(r("Society no: 000000"))))));
  const f = form([
    field("F-01", "HCPC number", { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c1", placeholderText: "XX00000", clearPlaceholder: true }, { fillSource: { kind: "signoff", part: "hcpc" }, answerType: "hcpc_number" }),
    field("F-02", "Society number", { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c1", placeholderText: "000000", clearPlaceholder: true }, { fillSource: { kind: "registration", path: "staff.entry" } }),
  ]);
  const draft = texts(fillDocx(file, f, {}, { draft: true }));
  assert.equal(draft["t0.r0.c1"], "Degree (fictional)\nHCPC:\nSociety no:", "the printed numbers are removed (the outline drops trailing spaces)");
  const review = texts(fillDocx(file, f, {}, { draft: true, reviewMarkers: true }));
  assert.doesNotMatch(review["t0.r0.c1"], /XX00000|000000(?!\d)/);
  const final = texts(fillDocx(file, f, { "F-01": { text: "PH-DEMO-01", value: "PH-DEMO-01" }, "F-02": { text: "SOC-DEMO-01" } }, { draft: false }));
  assert.equal(final["t0.r0.c1"], "Degree (fictional)\nHCPC: PH-DEMO-01\nSociety no: SOC-DEMO-01");
  // Without the flag an unanswered placeholder stays as printed (unchanged behaviour).
  const plain = form(f.fields.map((x) => ({ ...x, anchor: { ...x.anchor, clearPlaceholder: undefined } as FormAnchor })));
  assert.equal(texts(fillDocx(file, plain, {}, { draft: true }))["t0.r0.c1"], "Degree (fictional)\nHCPC: XX00000\nSociety no: 000000");
});

test("writeAfter: the answer goes after a printed label that has no answer space; the label stays", () => {
  const file = docx([p(r("Name: Ann Example (fictional) Job Role:")), p(r("01.") + `<w:r><w:tab/></w:r>` + r("07.")), p(r("Society no:"))].join(""));
  const f = form([
    field("F-01", "Job role", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "Job Role:", writeAfter: true }),
    field("F-02", "Session 1", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "01.", writeAfter: true }, { answerType: "date" }),
    field("F-03", "Session 7", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "07.", writeAfter: true }, { answerType: "date", required: false }),
    field("F-04", "Society number", { kind: "docx", target: "replace_placeholder", blockId: "p2", placeholderText: "Society no:", writeAfter: true, clearPlaceholder: true }, { required: false }),
  ]);
  const t = texts(fillDocx(file, f, { "F-01": { text: "Office administrator" }, "F-02": { text: "25/03/2026", value: "2026-03-25" } }, { draft: false }));
  assert.equal(t.p0, "Name: Ann Example (fictional) Job Role: Office administrator");
  assert.equal(t.p1, "01. 25/03/2026 07.", "the unanswered slot keeps its printed number");
  assert.equal(t.p2, "Society no:", "a label is never removed, even with clearPlaceholder");
});

/* ------------------------------------------------------------------------------------------------
 * Independent verify (10/2026): placeholders in running text, Y / N columns, other printed marks, hostile sizes
 * ----------------------------------------------------------------------------------------------*/

test("an “[X]” inside running text stays the template's fill-in placeholder; checklists and option boxes stay tick boxes", () => {
  const file = docx(
    [
      p(r("The client attended [X] sessions over [X] weeks.")),
      p(r("Dear [X],")),
      p(r("Expected recovery: [x] months")),
      p(r("Consent given: [x] yes [ ] no")),
      p(r("[x] Manual therapy")),
      tbl(tr(cell("Back at work now?"), cell("Yes [x]"), cell("No []")), tr(cell("Grade"), cell("[] 0"), cell("Full recovery   [x]"))),
    ].join(""),
  );
  const ol = outlineOf(file);
  assert.equal(ol.p0.checkboxGlyphs ?? 0, 0);
  assert.deepEqual(findPlaceholders(texts(file).p0).map((m) => m.text), ["[X]", "[X]"]);
  assert.equal(ol.p1.placeholderText, "[X]");
  assert.equal(ol.p2.placeholderText, "[x]");
  assert.equal(ol.p3.checkboxGlyphs, 2, "a line that also prints an unticked box is a checklist");
  assert.equal(ol.p3.hasPlaceholder, false);
  assert.equal(ol.p4.checkboxGlyphs, 1);
  for (const id of ["t0.r0.c1", "t0.r0.c2", "t0.r1.c1", "t0.r1.c2"]) assert.equal(ol[id].checkboxGlyphs, 1, id);
  assert.equal(withBracketBoxesAsGlyphs("attended [X] sessions | Yes [x]"), "attended [X] sessions | Yes ☒");
  // The rules reading maps the running-text placeholders as text answers, so they are replaced, never left printed.
  const parsed = { kind: "docx" as const, blocks: buildDocxOutline(file).blocks, warnings: [] };
  const { fields } = postValidateFields(parsed, proposeFieldsByRules(parsed), { confidenceCap: "low" });
  const inProse = fields.filter((f) => f.anchor.kind === "docx" && ["p0", "p1", "p2"].includes(f.anchor.blockId));
  assert.ok(inProse.length >= 3 && inProse.every((f) => f.anchor.kind === "docx" && f.anchor.target === "replace_placeholder"), JSON.stringify(inProse.map((f) => f.anchor)));
  const out = texts(fillDocx(file, form(inProse), Object.fromEntries(inProse.map((f) => [f.id, { text: "6" }])), { draft: false }));
  assert.equal(out.p0, "The client attended 6 sessions over 6 weeks.");
  assert.equal(out.p2, "Expected recovery: 6 months");
});

const YN = docx(tbl(tr(cell(""), cell("Y"), cell("N")), tr(cell("Saw a doctor"), cell(""), cell("x")), tr(cell("Back at work now?"), cell("Y [ ]"), cell("N [x]"))));
const YN_FORM = form([
  field("F-01", "Saw a doctor", { kind: "docx", target: "mark_cell", blockId: "t0.r1.c1", optionCells: [{ option: "Y", blockId: "t0.r1.c1" }, { option: "N", blockId: "t0.r1.c2" }], mark: "x" }, { answerType: "yes_no", options: ["Y", "N"] }),
  field("F-02", "Back at work now?", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r2.c1", optionGlyphs: [{ option: "Y", blockId: "t0.r2.c1", glyphIndex: 0 }, { option: "N", blockId: "t0.r2.c2", glyphIndex: 0 }] }, { answerType: "yes_no", options: ["Y", "N"] }),
]);

test("“Y” / “N” columns and boxes: a Yes / No answer marks and ticks the printed letter (never left blank)", () => {
  const warnings: string[] = [];
  const t = texts(fillDocx(YN, YN_FORM, { "F-01": { text: "Yes", value: true }, "F-02": { text: "Yes", value: true } }, { draft: false, onWarning: (w) => warnings.push(w) }));
  assert.deepEqual([t["t0.r1.c1"], t["t0.r1.c2"]], ["x", ""], "the default mark under N moves to Y");
  assert.deepEqual([t["t0.r2.c1"], t["t0.r2.c2"]], ["Y [x]", "N [ ]"]);
  assert.deepEqual(warnings, []);
  const no = texts(fillDocx(YN, YN_FORM, { "F-01": { text: "No", value: false }, "F-02": { text: "No", value: false } }, { draft: false }));
  assert.deepEqual([no["t0.r1.c1"], no["t0.r1.c2"], no["t0.r2.c1"], no["t0.r2.c2"]], ["", "x", "Y [ ]", "N [x]"]);
  assert.deepEqual(validateChoiceMarks({ report: reportWith({ "F-01": { kind: "yes_no", value: true }, "F-02": { kind: "yes_no", value: false } }), form: YN_FORM } as unknown as ValidatorInput), []);
});

test("approval check: a Yes / No answer on cells or boxes that print no Yes / No option blocks (it would print blank)", () => {
  const odd = form([
    field("F-01", "Return to work", { kind: "docx", target: "mark_cell", blockId: "t0.r1.c1", optionCells: [{ option: "Full", blockId: "t0.r1.c1" }, { option: "Partial", blockId: "t0.r1.c2" }] }, { answerType: "yes_no", options: ["Full", "Partial"] }),
    field("F-02", "Duties", { kind: "docx", target: "checkbox_glyph", blockId: "t0.r2.c1", optionGlyphs: [{ option: "Full", blockId: "t0.r2.c1", glyphIndex: 0 }, { option: "Light", blockId: "t0.r2.c2", glyphIndex: 0 }] }, { answerType: "yes_no", options: ["Full", "Light"] }),
    field("F-03", "Taping", { kind: "docx", target: "mark_cell", blockId: "t0.r1.c1", optionCells: [{ option: "Taping", blockId: "t0.r1.c1" }] }, { answerType: "checkbox", options: ["Taping"] }),
  ]);
  const flags = validateChoiceMarks({ report: reportWith({ "F-01": { kind: "yes_no", value: true }, "F-02": { kind: "yes_no", value: false }, "F-03": { kind: "checkbox", value: false } }), form: odd } as unknown as ValidatorInput);
  assert.deepEqual(flags.map((f) => [f.sectionKey, f.severity]), [["F-01", "blocking"], ["F-02", "blocking"]], "a single printed item is ticked or not – no flag");
});

test("mark the column: ☑ and × printed as a default in another column are cleared too", () => {
  for (const mark of ["☑", "×", "✕", "✖"]) {
    const file = docx(tbl(tr(cell(""), cell("Yes"), cell("No")), tr(cell("Saw a doctor"), cell(mark), cell(""))));
    const t = texts(fillDocx(file, form([yesNoRow("F-01", "Saw a doctor", 1)]), { "F-01": { text: "No", value: false } }, { draft: false }));
    assert.deepEqual([t["t0.r1.c1"], t["t0.r1.c2"]], ["", "X"], mark);
  }
});

test("hostile sizes: a paragraph of 160,000 typed boxes or bracket placeholders is read in linear time", () => {
  for (const unit of ["[ ]", "[a]", "[x]"]) {
    const file = docx(p(Array.from({ length: 160_000 }, () => r(unit)).join("")));
    const t0 = Date.now();
    const ol = buildDocxOutline(file);
    const ms = Date.now() - t0;
    // Linear: about 1.5 s here; the earlier per-match scans took 25–30 s on the same input.
    assert.ok(ms < 10_000, `${unit}: ${ms} ms`);
    assert.ok(ol.blocks.length >= 1);
  }
});

test("a table row of exact height (RTF templates) grows to fit a written answer; rows without an answer keep their height", () => {
  const exactRow = (label: string) => `<w:tr><w:trPr><w:trHeight w:val="284" w:hRule="exact"/></w:trPr>${cell(label)}${cell("")}</w:tr>`;
  const file = docx(`<w:tbl>${exactRow("Any other comments")}${exactRow("Treatment plan")}</w:tbl>`);
  const f = form([
    field("F-01", "Any other comments", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, { answerType: "long_text" }),
    field("F-02", "Treatment plan", { kind: "docx", target: "table_cell", blockId: "t0.r1.c1" }, { answerType: "long_text", required: false }),
  ]);
  const long = "Daniel Brooks (fictional) is progressing well with a graded home programme. ".repeat(4).trim();
  const xml = new PizZip(fillDocx(file, f, { "F-01": { text: long } }, { draft: false })).file("word/document.xml")!.asText();
  const rows = xml.split("<w:tr>").slice(1);
  assert.match(rows[0], /<w:trHeight w:val="284" w:hRule="atLeast"\/>/, "the answered row may grow");
  assert.match(rows[1], /<w:trHeight w:val="284" w:hRule="exact"\/>/, "an unanswered row keeps its exact height");
});
