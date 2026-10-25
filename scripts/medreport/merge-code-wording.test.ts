/**
 * Clinic-system merge codes in plain words on staff screens (Blue Heart trial test run, 24/10/2026, finding 4): the
 * mapping page showed "13 merge codes from your clinic system (<<P_GROUPREF>>, <<P_TITLE>>, <<P_FIRSTNAM>>)" and
 * "From the clinic system's merge code <<P_ALTERNATE_REF1>> (…)" as stored in the map. The map keeps the codes (an
 * answer's place names the exact text it replaces); the screens say what each code holds, when the text is shown –
 * so maps already stored read the same way:
 *
 * - the humaniser (core/practice-merge-codes.ts): the form reading's and the RTF converter's own wordings, lists,
 *   addresses, unknown codes kept by name, anything else left as it is, nothing read as markup, linear time;
 * - the FICTIONAL practice-codes template (fixtures/rtf/practice-codes-report.rtf, "Larkfield Rehabilitation Network
 *   (fictional)"): every note, guidance, label, place and warning a staff screen shows is free of raw known codes,
 *   while the stored map and the "Edit the location by hand" details keep them;
 * - the field editor as rendered: plain words, the codes only under "Edit the location by hand", markup escaped.
 */
import * as React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.MEDREPORT_AI_MODE = "demo";

import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import { PRACTICE_CODES, humaniseMergeCodes, practiceCodeWords, practiceCodesInWords } from "@/modules/medreport/core/practice-merge-codes";
import { isRtfConversionNote, rtfNoteText } from "@/modules/medreport/core/rtf/notes";
import type { FormField } from "@/modules/medreport/core/types";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { FieldEditor } from "@/modules/medreport/ui/components/forms/field-editor";
import { describeAnchor, plainAnchorDescription } from "@/modules/medreport/ui/components/forms/mapping";
import { HostHooksProvider, type HostHooks } from "@/modules/medreport/ui/host-hooks";

// The test runner compiles JSX with the classic runtime (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

const RAW_CODE = /<<[A-Z][A-Z0-9_]*>>/;
const FIXTURE = path.join(process.cwd(), "scripts/medreport/fixtures/rtf/practice-codes-report.rtf");

test("dictionary: every known code has plain words, without brackets or examples", () => {
  assert.equal(practiceCodeWords("P_FIRSTNAM"), "the patient's first name");
  assert.equal(practiceCodeWords("P_TITLE"), "the patient's title", "the examples in brackets are left out");
  assert.equal(practiceCodeWords("P_ADDRESS3"), "line 3 of the patient's address");
  assert.equal(practiceCodeWords("P_LOCATION_ADDRESS2"), "line 2 of the clinic's address");
  assert.equal(practiceCodeWords("P_ALTERNATE_REF1"), "alternative reference 1 (where some clinics keep the date of the accident)");
  assert.equal(practiceCodeWords("P_LOCATION_NAME"), "the clinic (site) the patient attends", "brackets inside the words are kept");
  assert.equal(practiceCodeWords("P_HOSP_REF"), null, "unknown");
  assert.equal(practiceCodeWords("Patient_Name"), null);
  for (const code of Array.from(PRACTICE_CODES.keys())) {
    const words = practiceCodeWords(code) ?? "";
    assert.ok(words.length > 3 && !/[<>«»_]/.test(words) && !words.includes(code), `${code}: “${words}”`);
  }
});

test("the form reading's notes: the code becomes what it holds, the repeated meaning is dropped", () => {
  const cases: Array<[string, string]> = [
    [
      "From the clinic system's merge code <<P_FIRSTNAM>> (the patient's first name): filled from the record.",
      "From the clinic system's merge code for the patient's first name: filled from the record.",
    ],
    [
      "From the clinic system's merge code <<P_TITLE>> (the patient's title (Mr, Mrs, Ms…)): filled from the record.",
      "From the clinic system's merge code for the patient's title: filled from the record.",
    ],
    [
      // "Date of Accident", the question a Blue Heart mapping page opened on (the note as the form reading writes it).
      "From the clinic system's merge code <<P_ALTERNATE_REF1>> (the clinic system's alternative reference 1 (some clinics keep the date of the accident there)): filled from the record. The form's label “Date of Accident” says what it holds here – check it.",
      "From the clinic system's merge code for alternative reference 1 (where some clinics keep the date of the accident): filled from the record. The form's label “Date of Accident” says what it holds here – check it.",
    ],
    [
      // An address line's code names the address it is spread over ("line 3 of the address" would contradict "line 2 of 3").
      "From the clinic system's merge code <<P_ADDRESS3>>: filled from the record (line 2 of 3).",
      "From the clinic system's merge code for the patient's address: filled from the record (line 2 of 3).",
    ],
    [
      "From the clinic system's merge codes <<P_ADDRESS1>>, <<P_ADDRESS2>>, <<P_ADDRESS3>>, <<P_ADDRESS4>>: filled from the record.",
      "From the clinic system's merge codes for the patient's address: filled from the record.",
    ],
    [
      "From the clinic system's merge codes <<P_ADDRESS1>>, <<P_ADDRESS3>>, <<P_POSTCODE>>: filled from the record.",
      "From the clinic system's merge codes for the patient's address and postcode: filled from the record.",
    ],
    [
      "The clinic system's merge code <<P_HOSP_NUM>> (the patient's hospital number): the record here does not hold it, so staff enter it on each report – or choose where it comes from in the mapping.",
      "The clinic system's merge code for the patient's hospital number: the record here does not hold it, so staff enter it on each report – or choose where it comes from in the mapping.",
    ],
    [
      "Corrected: the clinic system merges the letter's date (<<DATE>>) here; the record's accident date is printed.",
      "Corrected: the clinic system merges the letter's date (the date of the report) here; the record's accident date is printed.",
    ],
  ];
  for (const [stored, shown] of cases) assert.equal(humaniseMergeCodes(stored), shown);
});

test("lists of examples (RTF conversion, the reading's summary, approval messages) and sentence starts", () => {
  assert.equal(
    humaniseMergeCodes("Converted from RTF: 13 merge codes from your clinic system (<<P_GROUPREF>>, <<P_TITLE>>, <<P_FIRSTNAM>>) were kept, so the matching details from the patient's record fill them – check the mapping once."),
    "Converted from RTF: 13 merge codes from your clinic system (the referrer's reference for this case, the patient's title, the patient's first name) were kept, so the matching details from the patient's record fill them – check the mapping once.",
  );
  assert.equal(
    humaniseMergeCodes("This form contains 13 mail-merge fields (<<P_GROUPREF>>, <<P_TITLE>>, <<P_FIRSTNAM>> and 10 more)."),
    "This form contains 13 mail-merge fields (the referrer's reference for this case, the patient's title, the patient's first name and 10 more).",
  );
  // Examples stay separate codes (the reading's summary lists the first three, often address lines).
  assert.equal(
    humaniseMergeCodes("This form holds 26 merge codes from your clinic system (<<P_POSTCODE>>, <<P_ADDRESS1>>, <<P_ADDRESS2>>)."),
    "This form holds 26 merge codes from your clinic system (the patient's postcode, line 1 of the patient's address, line 2 of the patient's address).",
  );
  assert.equal(humaniseMergeCodes("<<P_DOB>> is printed here. Then <<P_SURNAME>>."), "The patient's date of birth is printed here. Then the patient's surname.");
});

test("unknown codes keep their name in quotes; everything else is left exactly as it is", () => {
  assert.equal(
    humaniseMergeCodes("The clinic system's merge code <<P_CONTACT_PREF>> is not one this form reading knows: staff enter it on each report."),
    "The clinic system's merge code “P_CONTACT_PREF” is not one this form reading knows: staff enter it on each report.",
  );
  assert.equal(humaniseMergeCodes("Merge code <<P_CONTACT_PREF>>"), "Merge code “P_CONTACT_PREF”");
  assert.equal(humaniseMergeCodes("Replaces “<<P_CONTACT_PREF>>” – Paragraph 3"), "Replaces “P_CONTACT_PREF” – Paragraph 3", "not quoted twice");
  assert.equal(humaniseMergeCodes("(<<P_HOSP_NUM>>, <<P_CONTACT_PREF>>)"), "(the patient's hospital number, “P_CONTACT_PREF”)");
  // Not clinic-system codes: other mail-merge fields, mixed or lower case, over 40 characters, half a code.
  for (const kept of [
    "«Patient_Name» and <<Referral Ref>> and <<Referral_Date>>",
    "<<p_dob>> <<_X>> <<P__X>> <<P_X_>>",
    `<<${"A".repeat(41)}>>`,
    "<<P_FIRSTNAM> and <P_SURNAME>> and <<<P_DOB",
    "No codes at all.",
    "",
  ]) {
    assert.equal(humaniseMergeCodes(kept), kept, kept);
  }
  const same = "Plain text";
  assert.equal(humaniseMergeCodes(same), same);
});

test("no markup: codes come from uploaded files, so nothing in them is ever read as HTML, and it runs in linear time", () => {
  // Only capital letters, digits and underscores make a code; anything around one stays as text for React to escape.
  assert.equal(humaniseMergeCodes("<<P_FIRSTNAM>><img src=x onerror=alert(1)>"), "The patient's first name<img src=x onerror=alert(1)>");
  assert.equal(humaniseMergeCodes("<<P_<b>X</b>>> <<IMG_SRC_X>>"), "<<P_<b>X</b>>> “IMG_SRC_X”");
  const sample = "From <<P_TITLE>>, <<P_FIRSTNAM>> <script>alert(1)</script> <<P_UNKNOWN>>";
  const count = (s: string, c: string) => s.split(c).length - 1;
  assert.ok(count(humaniseMergeCodes(sample), "<") <= count(sample, "<") - 6, "brackets are only ever removed");
  assert.equal(humaniseMergeCodes(sample).includes("<script>alert(1)</script>"), true, "left as text, not changed");
  const html = renderToStaticMarkup(createElement("p", null, humaniseMergeCodes(sample)));
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), html);
  // Adversarial uploads: long near-codes and many codes finish quickly.
  const started = Date.now();
  humaniseMergeCodes(`<<A${"_A".repeat(100_000)}`);
  humaniseMergeCodes(`${"<<P_DOB>>, ".repeat(20_000)}x`);
  humaniseMergeCodes("<<".repeat(100_000));
  assert.equal(humaniseMergeCodes("<<P_DOB>> ".repeat(30_000)).length, "the patient's date of birth ".length * 30_000, "many separate codes");
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test("a place that is only codes, in words (the mapping page's 'Goes in')", () => {
  assert.equal(practiceCodesInWords("<<P_FIRSTNAM>>"), "merge code for the patient's first name");
  assert.equal(practiceCodesInWords("<<P_ADDRESS1>>, <<P_ADDRESS3>>, <<P_POSTCODE>>"), "merge codes for the patient's address and postcode");
  assert.equal(practiceCodesInWords("<<P_TITLE>> <<P_SURNAME>>"), "merge codes for the patient's title and the patient's surname");
  assert.equal(practiceCodesInWords("<<P_HOSP_REF>>"), "merge code “P_HOSP_REF”");
  assert.equal(practiceCodesInWords("Dear <<P_TITLE>>"), null, "other text: not only codes");
  assert.equal(practiceCodesInWords("____"), null);
});

async function readFixture() {
  const file = decodeFormFile(fs.readFileSync(FIXTURE).toString("base64"), { convertRtf: true });
  const result = await analyseFormFile({
    file,
    fileName: "practice-codes-report.rtf",
    mode: "demo",
    rulesOnly: true,
    referrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" },
    now: new Date("2026-10-24T09:00:00.000Z"),
  });
  const notes = file.convertedFrom?.notes ?? [];
  return { form: result.form, warnings: [...notes, ...result.form.analysis.warnings], notes };
}

test("the fictional practice-codes template: every staff-facing text in plain words, the stored map unchanged", async () => {
  const { form, warnings, notes } = await readFixture();
  const coded = form.fields.filter((f) => f.anchor.kind === "docx" && RAW_CODE.test(f.anchor.placeholderText ?? ""));
  assert.ok(coded.length >= 20, "the reading proposed a question per code");
  assert.ok(notes.some((n) => isRtfConversionNote(n) && RAW_CODE.test(n)), "the RTF note lists codes as stored");
  // Unknown codes (<<P_CONTACT_PREF>> here) keep their name, in quotes; known codes never show as printed.
  const shown = (s: string) => humaniseMergeCodes(s).replace(/“P_CONTACT_PREF”/g, "");
  for (const w of warnings) {
    const text = isRtfConversionNote(w) ? humaniseMergeCodes(rtfNoteText(w)) : shown(w);
    assert.ok(!RAW_CODE.test(text) && !/<<|>>/.test(text), text);
  }
  for (const f of form.fields) {
    for (const [what, s] of [
      ["label", f.label],
      ["guidance", f.guidance],
      ["note", f.note ?? ""],
      ["place", plainAnchorDescription(f)],
    ] as const) {
      const text = shown(s);
      assert.ok(!/<<|>>/.test(text), `${f.id} ${what}: ${text}`);
    }
  }
  const dateOfAccident = form.fields.find((f) => f.anchor.kind === "docx" && f.anchor.placeholderText === "<<P_ALTERNATE_REF1>>");
  assert.ok(dateOfAccident);
  assert.equal(plainAnchorDescription(dateOfAccident), "In place of the merge code for alternative reference 1 (where some clinics keep the date of the accident)");
  assert.match(humaniseMergeCodes(dateOfAccident.note ?? ""), /^From the clinic system's merge code for alternative reference 1 \(where some clinics keep the date of the accident\): filled from the record\. The form's label “Date of Accident” says what it holds here – check it\.$/);
  // The stored map and the technical location keep the codes: each answer replaces exactly the printed text.
  for (const f of coded) {
    assert.ok(f.anchor.kind === "docx" && RAW_CODE.test(f.anchor.placeholderText ?? ""));
    assert.match(describeAnchor(f.anchor), /<<[A-Z]/);
  }
});

test("the field editor as rendered: plain words, the code as printed only under 'Edit the location by hand', markup escaped", () => {
  const field: FormField = {
    id: "F-10",
    label: "Date of Accident",
    section: "Accident Details",
    guidance: "Entered by staff: the detail the clinic system puts in <<P_CONTACT_PREF>>. <img src=x onerror=alert(1)>",
    answerType: "date",
    anchor: { kind: "docx", target: "replace_placeholder", blockId: "p12", placeholderText: "<<P_ALTERNATE_REF1>>" },
    fillSource: { kind: "registration", path: "incident.date" },
    required: true,
    confidence: "medium",
    note: "From the clinic system's merge code <<P_ALTERNATE_REF1>> (the clinic system's alternative reference 1 (some clinics keep the date of the accident there)): filled from the record.",
  };
  const hooks: HostHooks = { mode: "tenant", basePath: "/app/studio", storage: "server" };
  const html = renderToStaticMarkup(
    createElement(HostHooksProvider, { hooks } as { hooks: HostHooks; children: ReactNode }, createElement(FieldEditor, { field, formKind: "docx", onChange: () => {}, onRemove: () => {}, picking: false, onTogglePick: () => {} })),
  );
  const [before, rest = ""] = html.split("<details");
  const [details, after = ""] = rest.split("</details>");
  assert.ok(details, "the location details are rendered");
  const outside = before + after;
  assert.ok(!/&lt;&lt;[A-Z]/.test(outside), "no code as printed outside the details");
  assert.match(outside, /In place of the merge code for alternative reference 1/);
  assert.match(outside, /Note: From the clinic system&#x27;s merge code for alternative reference 1/);
  assert.match(outside, /the detail the clinic system puts in “P_CONTACT_PREF”/);
  assert.ok(!html.includes("<img") && html.includes("&lt;img src=x onerror=alert(1)&gt;"), "markup in a map is shown as text");
  assert.match(details, /&lt;&lt;P_ALTERNATE_REF1&gt;&gt;/, "the printed code, where staff edit the location by hand");
});
