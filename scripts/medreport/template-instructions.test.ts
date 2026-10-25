/**
 * The form author's instructions on a completed form (10/2026, Blue Heart test-run finding 14: a provider template's
 * red "Delete unused cells" reached the completed Word file). A FICTIONAL RTF template in the same patterns
 * (fixtures/rtf/repeat-rows-report.rtf, "Fernhurst Medical Reporting (fictional)", own wording) prints such notes: red
 * "Delete unused cells" rows under tables of repeat rows (a row of its own, or the last repeat row), "Delete as
 * necessary" beside lists of options, a bracketed "(Please delete other choices)", "Please give the findings in this
 * box" under a label, a "Delete those which are not required" line and an uncoloured "(delete as appropriate)":
 *
 * - converted as at upload (core/rtf) and completed through forms/render-form.ts, FINAL and DRAFT: every instruction is
 *   left off, with its own row and the repeat rows the report left as printed (the first stays when none was used),
 *   and one note says so;
 * - question text, labels, the page header and option lists stay as printed; delete-as-necessary lists still keep only
 *   the chosen option (every option when unanswered); an answer is never touched, even one that reads like an
 *   instruction; a review copy keeps the rows that carry its markers;
 * - Word forms without such notes are completed exactly as on main (df51e51, document.xml SHA-256 pinned), and so is a
 *   PDF form (the PDF engine is unchanged).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { convertRtfToDocx } from "@/modules/medreport/core/rtf";
import type { FormAnchor, FormDefinition, FormField } from "@/modules/medreport/core/types";
import { hasBannedTerm } from "@/modules/medreport/core/wording";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { fillDocx } from "@/modules/medreport/forms/docx-fill";
import { DOCX_MIME, decodeFormFile, sha256Hex } from "@/modules/medreport/forms/file";
import { renderFormFile } from "@/modules/medreport/forms/render-form";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import type { FormFillAnswer, FormFillAnswers } from "@/modules/medreport/core/forms";

const FIXTURE = path.join(process.cwd(), "scripts/medreport/fixtures/rtf/repeat-rows-report.rtf");
const AT = "2026-10-25T09:00:00.000Z";
const TEMPLATE = convertRtfToDocx(new Uint8Array(fs.readFileSync(FIXTURE)), { maxBytes: 2.5 * 1024 * 1024 }).docx;

const docx = (target: FormAnchor & { kind: "docx" }) => target;
function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}
const cellField = (id: string, label: string, blockId: string) => field(id, label, docx({ kind: "docx", target: "table_cell", blockId }));
/** One option per line of a cell, from its paragraph `first` on. */
const lines = (cell: string, first: number, ...options: string[]) => options.map((o, i) => ({ option: o, blockId: `${cell}.p${first + i}`, text: o }));

const FIELDS: FormField[] = [
  field("F-01", "Our reference", docx({ kind: "docx", target: "replace_placeholder", blockId: "p2", placeholderText: "<<P_GROUPREF>>" }), { fillSource: { kind: "registration", path: "referral.reference" }, required: true }),
  cellField("F-02", "Body area 1", "t0.r2.c0"),
  cellField("F-03", "Area 1 – pain score and symptoms", "t0.r2.c1"),
  cellField("F-04", "Area 1 – movement", "t0.r2.c2"),
  cellField("F-05", "Body area 2", "t0.r3.c0"),
  cellField("F-06", "Body area 3", "t0.r4.c0"),
  cellField("F-07", "Body area 4", "t0.r5.c0"),
  cellField("F-08", "Medicine 1", "t1.r2.c0"),
  cellField("F-09", "Medicine 1 – how often", "t1.r2.c1"),
  cellField("F-10", "Medicine 2", "t1.r3.c0"),
  cellField("F-11", "Activity 1", "t2.r1.c0"),
  field("F-12", "Activity 1 – status", docx({ kind: "docx", target: "delete_options", blockId: "t2.r1.c1", placeholderText: "Limited / Not possible" }), { answerType: "single_choice", options: ["Limited", "Not possible"] }),
  cellField("F-13", "Activity 1 – details", "t2.r1.c2"),
  cellField("F-14", "Earlier condition 1", "t3.r1.c0"),
  field("F-15", "Clinical findings", docx({ kind: "docx", target: "after_paragraph", blockId: "t4.r0.c0.p1" }), { answerType: "long_text", required: true }),
  field("F-16", "Area affected", docx({ kind: "docx", target: "delete_options", blockId: "t4.r0.c1.p1", optionTexts: lines("t4.r0.c1", 1, "Spine", "Arm", "Leg") }), { answerType: "single_choice", options: ["Spine", "Arm", "Leg"] }),
  field("F-17", "Cause", docx({ kind: "docx", target: "delete_options", blockId: "t4.r1.c0.p1", optionTexts: lines("t4.r1.c0", 1, "At work", "Made worse by work", "Outside work") }), { answerType: "single_choice", options: ["At work", "Made worse by work", "Outside work"] }),
  field("F-18", "Duties", docx({ kind: "docx", target: "delete_options", blockId: "t4.r1.c1.p0", optionTexts: lines("t4.r1.c1", 0, "Normal duties", "Off work") }), { answerType: "single_choice", options: ["Normal duties", "Off work"] }),
  field("F-19", "Restriction – no kneeling", docx({ kind: "docx", target: "delete_options", blockId: "t5.r0.c0", placeholderText: "No kneeling" }), { answerType: "checkbox", options: ["No kneeling"] }),
  field("F-20", "Restriction – no overhead work", docx({ kind: "docx", target: "delete_options", blockId: "t5.r0.c1", placeholderText: "No overhead work" }), { answerType: "checkbox", options: ["No overhead work"] }),
  field("F-21", "Is treatment required?", docx({ kind: "docx", target: "delete_options", blockId: "p13", placeholderText: "Yes/No" }), { answerType: "yes_no", options: ["Yes", "No"] }),
  field("F-22", "Therapist signature", docx({ kind: "docx", target: "after_paragraph", blockId: "p16" }), { fillSource: { kind: "signoff", part: "signature" }, required: true }),
  field("F-23", "Date", docx({ kind: "docx", target: "replace_placeholder", blockId: "p17", placeholderText: "<<DATE>>" }), { fillSource: { kind: "signoff", part: "date" }, required: true }),
];

const FORM: FormDefinition = {
  id: "frm_fernhurst_fa",
  tenantId: "demo",
  referrer: { name: "Fernhurst Medical Reporting (fictional)", type: "mlc" },
  title: "First Assessment Report",
  file: { fileName: "repeat-rows-report.rtf", mimeType: DOCX_MIME, sha256: sha256Hex(TEMPLATE), sizeBytes: TEMPLATE.byteLength },
  kind: "docx",
  fields: FIELDS,
  status: "confirmed",
  analysis: { mode: "rules", promptVersion: "test", at: AT, warnings: [] },
  createdAt: AT,
  updatedAt: AT,
};

/** A report that uses the first slots of each table (and leaves "Cause" and the later slots empty). */
const ANSWERS: FormFillAnswers = {
  "F-01": { text: "FMR-0001" },
  "F-02": { text: "Neck" },
  "F-03": { text: "6/10, stiffness turning to the left" },
  "F-04": { text: "70%" },
  "F-05": { text: "Lower back" },
  // An answer that reads like an instruction is the clinician's: never left off.
  "F-06": { text: "Delete as necessary" },
  "F-08": { text: "Ibuprofen 400 mg" },
  "F-09": { text: "Three times a day" },
  "F-11": { text: "Driving" },
  "F-12": { text: "Limited", value: "Limited" },
  "F-13": { text: "Up to 30 minutes" },
  "F-15": { text: "Neck pain after a rear-end collision (fictional)." },
  "F-16": { text: "Spine", value: "Spine" },
  "F-18": { text: "Off work", value: "Off work" },
  "F-19": { text: "Yes", value: true },
  "F-20": { text: "No", value: false },
  "F-21": { text: "Yes", value: true },
  "F-22": { text: "Sarah Reid (fictional) – approved electronically on 25/10/2026" },
  "F-23": { text: "25/10/2026", value: "2026-10-25" },
};

const INSTRUCTIONS = ["Delete unused cells", "Please delete other choices", "Delete those which are not required", "Please give the findings in this box", "(delete as appropriate)"];
const xmlOf = (bytes: Uint8Array, part = "word/document.xml") => new PizZip(bytes).file(part)!.asText();
const textsOf = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));
/** Top-level tables of the body: rows of cell texts. */
function tables(bytes: Uint8Array): string[][][] {
  const t = textsOf(bytes);
  const out: string[][][] = [];
  for (const id of Object.keys(t)) {
    const m = /^t(\d+)\.r(\d+)\.c(\d+)$/.exec(id);
    if (!m) continue;
    const [ti, ri, ci] = m.slice(1).map(Number);
    ((out[ti] ??= [])[ri] ??= [])[ci] = t[id].replace(/[ \t]+$/gm, "");
  }
  return out;
}

async function complete(answers: FormFillAnswers, opts: { draft: boolean; reviewMarkers?: boolean }) {
  const file = decodeFormFile(Buffer.from(TEMPLATE).toString("base64"));
  return renderFormFile({ form: FORM, file, answers, draft: opts.draft, reviewMarkers: opts.reviewMarkers, format: "original" });
}

test("completed form: the author's instructions are left off, with the unused repeat rows they refer to – FINAL and DRAFT alike", async () => {
  for (const draft of [false, true]) {
    const out = await complete(ANSWERS, { draft });
    const xml = xmlOf(out.bytes);
    for (const text of INSTRUCTIONS) assert.ok(!xml.includes(text), `${draft ? "DRAFT" : "FINAL"}: “${text}” left on the form`);
    assert.equal(xml.split("Delete as necessary").length - 1, 1, "only the clinician's own answer says “Delete as necessary”");
    const [symptoms, medication, activities, conditions, lists, restrictions] = tables(out.bytes);
    assert.deepEqual(symptoms, [
      ["Symptoms found at the first assessment (add pain scores if applicable)."],
      ["Body area", "Symptoms", "Movement (%)"],
      ["Neck", "Pain score:\n6/10, stiffness turning to the left", "70%"],
      ["Lower back", "Pain score:", ""],
      ["Delete as necessary", "Pain score:", ""],
    ], "the unused 4th row and the instruction's own row are gone");
    assert.deepEqual(medication, [["Any current medication? Yes/No"], ["Medicine", "How often"], ["Ibuprofen 400 mg", "Three times a day"]]);
    assert.deepEqual(activities, [["Activity", "Status", "Details"], ["Driving", "Limited", "Up to 30 minutes"]], "the last repeat row, which held the instruction, is unused too");
    assert.deepEqual(conditions, [["Earlier condition", "Notes (if applicable)"], ["", ""]], "none used: one empty row stays");
    assert.deepEqual(lists, [
      ["Clinical findings:\nNeck pain after a rear-end collision (fictional).", "Area affected:\nSpine"],
      ["Cause\nAt work\nMade worse by work\nOutside work", "Duties:\nOff work"],
    ], "labels stay; a chosen option is kept alone, an unanswered list keeps every option");
    assert.deepEqual(restrictions, [["No kneeling", ""]]);
    const body = Object.entries(textsOf(out.bytes)).filter(([id]) => /^p\d+$/.test(id)).map(([, t]) => t.trimEnd()).filter(Boolean);
    assert.deepEqual(body, [
      "Fernhurst Medical Reporting (fictional)",
      "First Assessment Report – fictional template for testing (repeat rows and the author's notes)",
      "Our reference: FMR-0001",
      "WORK RESTRICTIONS NEEDED",
      "Whiplash grade (please circle/tick): 0 / I / II / III",
      "Is treatment required? Yes",
      "Other (please specify):",
      "Please do not delete any part of this form. If you delete as appropriate lines, keep the headings.",
      "Therapist signature:",
      "Sarah Reid (fictional) – approved electronically on 25/10/2026",
      "Date: 25/10/2026",
    ], "question text stays as printed; the “Delete those which are not required” line is gone");
    const header = Object.keys(new PizZip(TEMPLATE).files).filter((n) => /^word\/header\d*\.xml$/.test(n));
    assert.ok(header.length > 0);
    for (const part of header) assert.equal(xmlOf(out.bytes, part), xmlOf(TEMPLATE, part), "the page header is untouched");
    assert.equal(draft, xml.includes("DRAFT – awaiting clinician approval"));
    const note = out.warnings.find((w) => w.startsWith("Left off the completed form"));
    assert.equal(
      note,
      "Left off the completed form: the form's own instructions “Delete unused cells” (4 places), “Please give the findings in this box”, “Delete as necessary” (2 places), “Please delete other choices”, “Delete those which are not required” and “delete as appropriate”, meant for whoever completes it. As it asks, 10 unused table rows are left off too.",
    );
    assert.equal(hasBannedTerm(note ?? ""), false);
  }
});

test("completed form: the fixture prints its instructions as such templates do – red runs, converted from RTF", () => {
  const xml = xmlOf(TEMPLATE);
  const runs = xml.split("<w:r>").slice(1).filter((r) => r.includes(">Delete unused cells<"));
  assert.equal(runs.length, 4);
  for (const run of runs) assert.match(run, /<w:b\/>.*<w:color w:val="FF0000"\/>/, "red bold");
  for (const text of INSTRUCTIONS) assert.ok(xml.includes(text), text);
});

test("completed form: a review copy keeps the rows its markers are in; nothing answered keeps one row per table", async () => {
  const review = await complete(ANSWERS, { draft: true, reviewMarkers: true });
  const [symptoms, medication, , conditions] = tables(review.bytes);
  assert.equal(symptoms.length, 6, "area 4 carries its “not answered yet” marker");
  assert.match(symptoms[5][0], /\[F-07 – not answered yet\]/);
  assert.equal(medication.length, 4, "Medication 2 carries its marker; the unmapped 3rd slot goes");
  assert.equal(conditions.length, 2);
  for (const text of INSTRUCTIONS) assert.ok(!xmlOf(review.bytes).includes(text), text);

  const empty = await complete({}, { draft: true });
  const t = tables(empty.bytes);
  assert.deepEqual(t.slice(0, 4).map((rows) => rows.length), [3, 3, 2, 2], "each table keeps its first repeat row");
  assert.deepEqual(t[4][0][1], "Area affected:\nSpine\nArm\nLeg", "unanswered: every option stays, the instruction goes");
});

test("completed form: fillDocx itself leaves them off too (the partner API and every other caller)", () => {
  const warnings: string[] = [];
  const out = fillDocx(TEMPLATE, FORM, ANSWERS, { draft: false, onWarning: (w) => warnings.push(w) });
  for (const text of INSTRUCTIONS) assert.ok(!xmlOf(out).includes(text), text);
  assert.equal(warnings.filter((w) => w.startsWith("Left off the completed form")).length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * Forms without such notes: exactly as on main
 * ----------------------------------------------------------------------------------------------*/

/** Fixed fictional answers: every required question, and the optional ones of a first slot ("… 1"). */
function sampleAnswers(form: FormDefinition): FormFillAnswers {
  const out: FormFillAnswers = {};
  for (const f of form.fields) {
    const kind = f.fillSource.kind;
    if (f.required === false && !/(^|\s|–\s)(area\s)?1\b|\b1\s–|Medication 1|Activity 1/.test(f.label) && kind !== "signoff") continue;
    let a: FormFillAnswer;
    if (kind === "signoff") {
      a = /hcpc|regulator|registration/i.test(f.label)
        ? { text: "ZZ0001" }
        : /date/i.test(f.label)
          ? { text: "24/10/2026", value: "2026-10-24" }
          : /signature/i.test(f.label)
            ? { text: "Sarah Reid – approved electronically on 24/10/2026" }
            : { text: "Sarah Reid" };
    } else if (f.answerType === "yes_no" || f.answerType === "checkbox") a = { text: "Yes", value: true };
    else if (f.answerType === "single_choice") a = f.options?.length ? { text: f.options[0], value: f.options[0] } : { text: "Sample choice (fictional)" };
    else if (f.answerType === "date") a = { text: "15/07/2026", value: "2026-07-15" };
    else if (f.answerType === "number") a = { text: "6" };
    else a = { text: `Sample answer for ${f.id} (fictional).` };
    out[f.id] = a;
  }
  return out;
}

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

test("forms without template instructions are completed exactly as on main (document.xml / PDF bytes pinned at df51e51)", async () => {
  const MAIN: Record<string, string> = {
    "harrow-pike-treating-physio final": "5c6e18df1b04322c1c7297894929a72ac343e1bb2bf993b271f8e53ff6b6eb59",
    "harrow-pike-treating-physio draft": "d89ef423cb8c800e012c2371bac42356657693a9bc3984491667a41df9fbcf18",
    "kingsway-rtw-assessment final": "524852f48482a2e9d64bfde24a9a532c395adf70931c40397237aa01681a5d9f",
    "kingsway-rtw-assessment draft": "4a26e2fa9f4c0bf3997edd93185d5129b3b4f053ff4afe1315838404b17d8716",
    "northfield-rehab-progress draft": "d5d3410499fa9347e6e1e317d998ee6e88c6b241fa0ed2cf2d844b6f6a61cce7",
  };
  const seen: string[] = [];
  for (const s of SAMPLE_FORMS) {
    const form = await s.loadForm?.();
    if (!form) continue;
    const file = decodeFormFile(Buffer.from(await s.loadFile()).toString("base64"));
    for (const draft of [false, true]) {
      const key = `${s.id} ${draft ? "draft" : "final"}`;
      if (!MAIN[key]) continue;
      const out = await renderFormFile({ form, file, answers: form.kind === "docx" ? sampleAnswers(form) : Object.fromEntries(form.fields.map((f) => [f.id, { text: "6" }])), draft, format: "original" });
      assert.equal(form.kind === "docx" ? sha(xmlOf(out.bytes)) : sha(out.bytes), MAIN[key], key);
      assert.ok(!out.warnings.some((w) => w.startsWith("Left off")), key);
      seen.push(key);
    }
  }
  assert.deepEqual(seen.sort(), Object.keys(MAIN).sort());
});

/* ------------------------------------------------------------------------------------------------
 * Hostile sizes
 * ----------------------------------------------------------------------------------------------*/

function wordFile(body: string): Uint8Array {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

test("hostile sizes: 10,000 instruction rows and a line of 50,000 bracketed instructions: bounded work, nothing wrong left off", () => {
  const red = (text: string) => `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const row = (c0: string) => `<w:tr><w:tc><w:p>${c0}</w:p></w:tc><w:tc><w:p/></w:tc></w:tr>`;
  const rows = Array.from({ length: 20_000 }, (_, i) => row(i % 2 ? red("Delete unused cells") : "")).join("");
  const file = wordFile(`<w:tbl>${rows}</w:tbl><w:p>${Array.from({ length: 50_000 }, () => "<w:r><w:t xml:space=\"preserve\">Yes (delete as appropriate) </w:t></w:r>").join("")}</w:p>`);
  const form: FormDefinition = { ...FORM, id: "frm_hostile", fields: [], file: { ...FORM.file, sha256: sha256Hex(file), sizeBytes: file.byteLength } };
  const started = Date.now();
  const warnings: string[] = [];
  const xml = xmlOf(fillDocx(file, form, {}, { draft: false, onWarning: (w) => warnings.push(w) }));
  const ms = Date.now() - started;
  // Linear: about 2.5 s here for 20,000 rows (the same file with neutral text: about 1.5 s); 40,000 rows: about 6 s.
  assert.ok(ms < 10_000, `${ms} ms`);
  assert.equal(xml.split("<w:tr>").length - 1, 20_000 - 500, "at most 500 rows are left off; the rest stay as printed");
  assert.ok(!xml.includes("Delete unused cells"), "every instruction's text still goes");
  assert.equal(xml.split("(delete as appropriate)").length - 1, 50_000, "a line with more than 20 is left as printed");
});
