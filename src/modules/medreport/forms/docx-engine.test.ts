/**
 * Word engine unit tests (forms/docx-dom.ts, docx-outline.ts, docx-fill.ts) on small hand-written
 * documents: stable IDs, placeholders split across runs, symbol / content-control / legacy tick boxes,
 * legacy text fields, content controls, nested tables, XML escaping, DRAFT banner and review markers.
 * The bundled sample forms are covered end to end in scripts/medreport/forms-engine.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { buildDocxOutline } from "./docx-outline";
import { fillDocx } from "./docx-fill";
import { findPlaceholders } from "./docx-dom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

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
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array" });
}

const p = (inner: string, pPr = "") => `<w:p>${pPr}${inner}</w:p>`;
const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const tc = (...paras: string[]) => `<w:tc>${paras.join("") || p("")}</w:tc>`;
const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return {
    id,
    label,
    guidance: "",
    answerType: "short_text",
    anchor,
    fillSource: { kind: "notes_narrative" },
    required: true,
    confidence: "high",
    ...rest,
  };
}

function form(fields: FormField[]): FormDefinition {
  return {
    id: "frm_test",
    tenantId: "demo",
    referrer: { name: "Test Referrer (fictional)", type: "mlc" },
    title: "Test form",
    file: { fileName: "t.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

const texts = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));
const xmlOf = (bytes: Uint8Array) => new PizZip(bytes).file("word/document.xml")!.asText();

const SAMPLE = docx(
  [
    p(r("Treating Physiotherapist Report"), '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'),
    // A placeholder split across three runs, and a bare "Answer:" label.
    p(r("Claimant: ") + r("___") + r("____", "<w:b/>") + r("   Ref: ") + r("[Insert reference]")),
    p(r("Answer:")),
    // Wingdings symbol boxes.
    p(`<w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r>${r(" Yes  ")}<w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r>${r(" No")}`),
    // Legacy FORMTEXT field and FORMCHECKBOX.
    p(
      r("Occupation: ") +
        '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Occupation"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        "<w:r><w:t>     </w:t></w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r>" +
        r("  Discharged ") +
        '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:checkBox><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ),
    // Run-level content control and a w14 check-box control.
    p(
      r("Date of birth: ") +
        '<w:sdt><w:sdtPr><w:rPr><w:sz w:val="20"/></w:rPr><w:alias w:val="DOB"/><w:tag w:val="dob"/><w:showingPlcHdr/><w:date/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click or tap to enter a date.</w:t></w:r></w:sdtContent></w:sdt>' +
        r("  Consent ") +
        '<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt>',
    ),
    tbl(
      tr(tc(p(r("Prognosis", "<w:b/><w:sz w:val=\"18\"/>"))), tc(p(""))),
      tr(tc(p(r("History")), p(r("As reported."))), tc(p(r("Describe the history:")), p(""), p(""))),
      tr(tc(tbl(tr(tc(p(r("Nested label"))), tc(p(""))))), tc(p(r("☐ Fit  ☐ Unfit")))),
    ),
    p(r("Further comments")),
    p(""),
    p(r(".........................................")),
    p(r("Declaration")),
  ].join(""),
);

test("outline: stable block IDs, placeholders, tick boxes, controls, legacy fields and nested tables", () => {
  const a = buildDocxOutline(SAMPLE);
  const b = buildDocxOutline(new Uint8Array(SAMPLE));
  assert.deepEqual(a, b, "same bytes → same outline");
  const ids = a.blocks.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "IDs are unique");
  const by = Object.fromEntries(a.blocks.map((x) => [x.id, x]));

  assert.equal(by.p0.headingLevel, 1);
  assert.equal(by.p1.text, "Claimant: _______   Ref: [Insert reference]");
  assert.equal(by.p1.placeholderText, "_______");
  assert.equal(by.p2.placeholderText, "Answer:");
  assert.equal(by.p3.checkboxGlyphs, 2);
  assert.equal(by.p3.text, "☐ Yes  ☐ No");
  assert.equal(by.p4.legacyFieldName, "Occupation");
  assert.equal(by.p4.checkboxGlyphs, 1);
  assert.equal(by.p5.inContentControl, true);
  assert.equal(by.p5.checkboxGlyphs, 1);
  assert.equal(by["t0.r0.c1"].isEmpty, true);
  assert.equal(by["t0.r1.c1"].text, "Describe the history:");
  assert.equal(by["t0.r1.c1"].isEmpty, false);
  assert.ok(by["t0.r1.c1.p2"], "a multi-paragraph cell lists its paragraphs");
  assert.ok(by["t0.r2.c0.t0.r0.c1"], "nested table cells have nested IDs");
  assert.equal(by["t0.r2.c1"].checkboxGlyphs, 2);
  assert.equal(by.p8.hasPlaceholder, true);
});

test("findPlaceholders: underscores, dots, ellipses, brackets and content-control text", () => {
  assert.deepEqual(
    findPlaceholders("Name: ______ Date: ........ [Insert] …… Click or tap here to enter text.").map((m) => m.text),
    ["______", "........", "[Insert]", "……", "Click or tap here to enter text."],
  );
  assert.deepEqual(findPlaceholders("Nothing to fill here."), []);
});

test("fill: every anchor type lands in the right place; XML-escaped; outline IDs survive", () => {
  const f = form([
    field("F-01", "Claimant", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "_______" }),
    field("F-02", "Reference", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "[Insert reference]" }),
    field("F-03", "Answer", { kind: "docx", target: "replace_placeholder", blockId: "p2", placeholderText: "Answer:" }, { answerType: "long_text" }),
    field(
      "F-04",
      "Fit?",
      {
        kind: "docx",
        target: "checkbox_glyph",
        blockId: "p3",
        optionGlyphs: [
          { option: "Yes", blockId: "p3", glyphIndex: 0 },
          { option: "No", blockId: "p3", glyphIndex: 1 },
        ],
      },
      { answerType: "yes_no", options: ["Yes", "No"] },
    ),
    field("F-05", "Occupation", { kind: "docx", target: "legacy_form_field", blockId: "p4" }),
    field("F-06", "Discharged", { kind: "docx", target: "checkbox_glyph", blockId: "p4", optionGlyphs: [{ option: "Discharged", blockId: "p4", glyphIndex: 0 }] }, { answerType: "checkbox" }),
    field("F-07", "Date of birth", { kind: "docx", target: "content_control", blockId: "p5" }, { answerType: "date" }),
    field("F-08", "Consent", { kind: "docx", target: "checkbox_glyph", blockId: "p5", optionGlyphs: [{ option: "Consent", blockId: "p5", glyphIndex: 0 }] }, { answerType: "checkbox" }),
    field("F-09", "Prognosis", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, { answerType: "long_text" }),
    field("F-10", "History", { kind: "docx", target: "table_cell", blockId: "t0.r1.c1" }, { answerType: "long_text" }),
    field("F-11", "Nested", { kind: "docx", target: "table_cell", blockId: "t0.r2.c0.t0.r0.c1" }),
    field(
      "F-12",
      "Fitness",
      {
        kind: "docx",
        target: "checkbox_glyph",
        blockId: "t0.r2.c1",
        optionGlyphs: [
          { option: "Fit", blockId: "t0.r2.c1", glyphIndex: 0 },
          { option: "Unfit", blockId: "t0.r2.c1", glyphIndex: 1 },
        ],
      },
      { answerType: "single_choice", options: ["Fit", "Unfit"] },
    ),
    field("F-13", "Further comments", { kind: "docx", target: "after_paragraph", blockId: "p6" }, { answerType: "long_text" }),
  ]);
  const warnings: string[] = [];
  const out = fillDocx(
    SAMPLE,
    f,
    {
      "F-01": { text: "Ms <Test> & Co" },
      "F-02": { text: "REF-1" },
      "F-03": { text: "Line one.\n\nSecond paragraph." },
      "F-04": { text: "Yes", value: true },
      "F-05": { text: "Office administrator" },
      "F-06": { text: "Yes", value: true },
      "F-07": { text: "22/11/1991", value: "1991-11-22" },
      "F-08": { text: "Yes", value: true },
      "F-09": { text: "Good recovery expected.\n\nReview in 6 weeks." },
      "F-10": { text: "Rear-end collision." },
      "F-11": { text: "Nested answer" },
      "F-12": { text: "Unfit", value: "Unfit" },
      "F-13": { text: "None." },
    },
    { draft: false, onWarning: (m) => warnings.push(m) },
  );
  assert.deepEqual(warnings, []);
  const t = texts(out);
  assert.equal(t.p1, "Claimant: Ms <Test> & Co   Ref: REF-1");
  assert.equal(t.p2, "Answer: Line one.");
  // A second answer paragraph is a new paragraph after p2, so the following body paragraphs move down one.
  assert.equal(t.p3, "Second paragraph.");
  assert.equal(t.p4, "☒ Yes  ☐ No");
  assert.match(t.p5, /^Occupation: Office administrator {2}Discharged ☒$/);
  assert.equal(t.p6, "Date of birth: 22/11/1991  Consent ☒");
  assert.equal(t["t0.r0.c1"], "Good recovery expected.\nReview in 6 weeks.");
  assert.equal(t["t0.r1.c1"], "Describe the history:\nRear-end collision.", "the first blank line under the question is used");
  assert.equal(t["t0.r2.c0.t0.r0.c1"], "Nested answer");
  assert.equal(t["t0.r2.c1"], "☐ Fit  ☒ Unfit");
  assert.equal(t.p7, "Further comments");
  assert.equal(t.p8, "None.", "the blank line after the question receives the answer");
  assert.equal(t.p9, "Declaration", "an unused dotted answer line is removed once the answer is written");

  const xml = xmlOf(out);
  assert.ok(xml.includes("Ms &lt;Test&gt; &amp; Co"), "answers are XML-escaped");
  assert.ok(xml.includes('w14:checked w14:val="1"'), "w14 check box state set");
  assert.match(xml, /<w:checkBox><w:default w:val="0"\/><w:checked w:val="1"\/><\/w:checkBox>/);
  assert.ok(xml.includes('w:fullDate="1991-11-22T00:00:00Z"'), "date picker value set");
  assert.ok(!xml.includes("w:showingPlcHdr"), "placeholder state cleared");
  assert.ok(xml.includes('w:char="F0FD"'), "Wingdings box ticked in its own font");
  assert.ok(!xml.includes("AppStackX_DraftBanner"), "final copies carry no DRAFT banner");
});

test("fill: DRAFT banner (skipped by the outline), review markers, unanswered and invalid characters", () => {
  const f = form([
    field("F-01", "Claimant", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "_______" }),
    field("F-02", "Prognosis", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, { fillSource: { kind: "clinician_opinion" } }),
    field("F-03", "Name", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "[Insert reference]" }, { fillSource: { kind: "signoff", part: "name" } }),
  ]);
  const draft = fillDocx(SAMPLE, f, { "F-01": { text: "Megan\u0001 Hart" }, "F-02": {}, "F-03": {} }, { draft: true, reviewMarkers: true });
  const xml = xmlOf(draft);
  assert.ok(xml.includes("DRAFT – awaiting clinician approval"));
  assert.ok(xml.includes('w:highlight w:val="yellow"'));
  assert.ok(xml.includes("[F-01]"));
  assert.ok(xml.includes("[F-02 – not answered yet]"));
  assert.ok(xml.includes("[F-03 – completed on approval]"));
  assert.ok(!xml.includes("\u0001"), "invalid XML characters are removed");
  const outline = buildDocxOutline(draft);
  assert.equal(outline.blocks[0].id, "p0");
  assert.equal(outline.blocks[0].text, "Treating Physiotherapist Report", "the banner is not part of the outline");

  // Without review markers an unanswered question is simply left blank.
  const plain = fillDocx(SAMPLE, f, { "F-01": { text: "Megan Hart" } }, { draft: true });
  assert.equal(texts(plain)["t0.r0.c1"], "");
  assert.equal(texts(plain).p1, "Claimant: Megan Hart   Ref: [Insert reference]");
});

test("fill: blanks of the same text fill in order and skip unanswered ones; missing anchors warn", () => {
  const doc = docx(p(r("Injury: ______   First seen: ______   Last seen: ______")) + p(r("Name: ________________   DOB: ______")));
  const f = form([
    field("F-01", "Injury", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "______" }),
    field("F-02", "First seen", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "______" }),
    field("F-03", "Last seen", { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "______" }),
    field("F-04", "Name", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "________________" }),
    field("F-05", "DOB", { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "______" }),
    field("F-06", "Gone", { kind: "docx", target: "table_cell", blockId: "t9.r0.c0" }),
  ]);
  const warnings: string[] = [];
  const out = fillDocx(doc, f, { "F-01": { text: "02/06/2026" }, "F-02": {}, "F-03": { text: "22/09/2026" }, "F-04": {}, "F-05": { text: "19/01/1980" }, "F-06": { text: "x" } }, { draft: false, onWarning: (m) => warnings.push(m) });
  const t = texts(out);
  assert.equal(t.p0, "Injury: 02/06/2026   First seen: ______   Last seen: 22/09/2026");
  assert.equal(t.p1, "Name: ________________   DOB: 19/01/1980", "a shorter blank never lands inside a longer one");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /F-06 .*was not found/);
});
