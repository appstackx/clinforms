/**
 * A clinic system's letter merge codes (10/2026; TM3-style <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>, <<P_DOB>>,
 * <<P_ADDRESS1>>…, <<P_GROUPREF>>, <<P_CONSNAME>>, <<DATE>>, <<P_LOCATION_ADDRESS2>>…) – on a FICTIONAL template that
 * mimics the syntax (fixtures/rtf/practice-codes-report.rtf, "Larkfield Rehabilitation Network (fictional)"):
 *
 * - the dictionary and the detector;
 * - the RTF converter keeps such codes in the body (also split across runs), still turns «Name», <<Mixed_Case>> and
 *   MERGEFIELD into answer spaces, and leaves page headers as before; every earlier fixture converts to the SAME
 *   bytes as on main (rtf-docx-1);
 * - the reading proposes a From-records question per code bound to the right record field (address lines spread
 *   over the printed lines, one-line addresses as one answer, the clinic's address, the date of accident by its
 *   label), codes the record does not hold or the dictionary does not know are for staff and flagged;
 * - Megan Hart (sim-pat-001, fictional) on the form: the right values, empty address lines left empty, staff
 *   entries as gaps; approval blocked while any code is left; once staff have entered theirs the FINAL Word file
 *   holds the values in place and no merge code at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

process.env.MEDREPORT_AI_MODE = "demo";

import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import { bindPracticeMergeCodes } from "@/modules/medreport/ai/practice-merge-binding";
import { parseFormFile } from "@/modules/medreport/ai/analyse-form";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { addressPartValue, buildFormAnswers, formToTemplate } from "@/modules/medreport/core/forms";
import { unresolvedMergeFields } from "@/modules/medreport/core/merge-fields";
import { PRACTICE_CODES, findPracticeCodes, isPracticeCodeName, practiceCode } from "@/modules/medreport/core/practice-merge-codes";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { RTF_CONVERTER_VERSION, convertRtfToDocx } from "@/modules/medreport/core/rtf";
import type { FormDefinition, FormField, Report } from "@/modules/medreport/core/types";
import { validateReport } from "@/modules/medreport/core/validation";
import { WORDING } from "@/modules/medreport/core/wording";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { fillDocx } from "@/modules/medreport/forms/docx-fill";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { findFormMergeFields, mergeTokensInOutput } from "@/modules/medreport/forms/merge-scan";
import { getDemoBundle } from "./dev-bundles";

const DIR = path.join(process.cwd(), "scripts/medreport/fixtures/rtf");
const FIXTURE = "practice-codes-report.rtf";
const MAX = 2.5 * 1024 * 1024;
const AT = "2026-10-24T09:00:00.000Z";
const rtf = (name: string) => new Uint8Array(fs.readFileSync(path.join(DIR, name)));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

test("dictionary: TM3-style codes, the detector, and what each code means", () => {
  assert.ok(isPracticeCodeName("P_FIRSTNAM") && isPracticeCodeName("DATE") && isPracticeCodeName("P_LOCATION_ADDRESS2"));
  assert.ok(!isPracticeCodeName("Patient_Name") && !isPracticeCodeName("Referral Ref") && !isPracticeCodeName("p_dob") && !isPracticeCodeName("_X"));
  assert.deepEqual(
    findPracticeCodes("Claimant: <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>> «Clinic_Ref» <<Referral_Date>>").map((c) => c.code),
    ["P_TITLE", "P_FIRSTNAM", "P_SURNAME"],
  );
  assert.deepEqual(findPracticeCodes("no codes"), []);
  const expect: Record<string, string> = {
    P_TITLE: "patient.title",
    P_FIRSTNAM: "patient.firstName",
    P_SURNAME: "patient.lastName",
    P_DOB: "patient.dob",
    P_GROUPREF: "referral.reference",
    P_CONSNAME: "clinician.name",
    DATE: "report.date",
    P_EMPLOYER: "patient.employer",
    P_HOMETEL: "patient.phone",
  };
  for (const [code, path_] of Object.entries(expect)) {
    const b = practiceCode(code)?.binding;
    assert.ok(b && b.kind === "record" && b.path === path_, code);
  }
  assert.deepEqual(practiceCode("P_ADDRESS3")?.binding, { kind: "address_line", family: "patient", line: 3 });
  assert.deepEqual(practiceCode("P_LOCATION_POSTCODE")?.binding, { kind: "postcode", family: "clinic" });
  assert.equal(practiceCode("P_HOSP_NUM")?.binding.kind, "not_held");
  assert.equal(practiceCode("P_ALTERNATE_REF1")?.binding.kind, "by_label");
  assert.equal(practiceCode("P_UNKNOWN_THING"), null);
  // Every code Blue Heart's templates use (counted locally from the templates, names only) is in the dictionary.
  for (const code of "P_TITLE P_FIRSTNAM P_SURNAME P_DOB P_ADDRESS1 P_ADDRESS2 P_ADDRESS3 P_ADDRESS4 P_ADDRESS5 P_POSTCODE P_GROUPREF P_ALTERNATE_REF1 P_CONSNAME DATE P_LOCATION_NAME P_LOCATION_ADDRESS1 P_LOCATION_ADDRESS2 P_LOCATION_ADDRESS3 P_LOCATION_ADDRESS4 P_LOCATION_ADDRESS5 P_LOCATION_POSTCODE P_EMPLOYER P_HOMETEL P_MOBILE P_WORKTEL P_HOSP_NUM P_INS_NUM P_INJURY".split(" ")) {
    assert.ok(PRACTICE_CODES.has(code), code);
  }
});

test("RTF: clinic-system codes are kept in the body (split runs joined); other merge fields and headers as before; earlier fixtures convert to the same bytes", () => {
  // (rtf-docx-3, fix round 1: pictures carried over – a file without PNG or JPEG pictures converts as with rtf-docx-2.)
  assert.equal(RTF_CONVERTER_VERSION, "rtf-docx-3");
  const r = convertRtfToDocx(rtf(FIXTURE), { maxBytes: MAX });
  const blocks = new Map(buildDocxOutline(r.docx).blocks.map((b) => [b.id, b.text]));
  assert.equal(blocks.get("p4"), "Claimant: <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>", "the code split over two runs is one code");
  assert.equal(blocks.get("p5"), "<<P_ADDRESS1>>");
  assert.equal(blocks.get("t0.r0.c1"), "<<P_FIRSTNAM>> <<P_SURNAME>>");
  assert.match(blocks.get("p27") ?? "", /__________ and __________$/, "«Clinic_Ref» and <<Referral_Date>> are still answer spaces");
  assert.equal(r.stats.practiceCodes, 26);
  assert.ok(r.stats.practiceCodeNames.includes("P_GROUPREF") && r.stats.practiceCodeNames.includes("P_HOSP_NUM"));
  assert.equal(r.stats.mergeFields, 3, "the header's code and the two other merge fields became answer spaces");
  assert.equal(r.stats.headerFooterFillIns, 1);
  assert.ok(r.notes.some((n) => /26 merge codes from your clinic system \(<<P_GROUPREF>>, <<P_TITLE>>, <<P_FIRSTNAM>>\) were kept, so the matching details from the patient's record fill them/.test(n)));
  for (const n of r.notes) for (const re of WORDING_BANNED) assert.doesNotMatch(n, re);
  assert.equal(sha(convertRtfToDocx(rtf(FIXTURE), { maxBytes: MAX }).docx), sha(r.docx), "deterministic");

  // The fixtures without clinic-system codes: byte for byte what main (rtf-docx-1) wrote – except (rtf-docx-3, fix round
  // 1, B0-14) the one whose header holds a PNG logo: it now carries the picture (word/media/image1.png); main's bytes
  // were 540cc0f217be49a2d14c58b95d7c9f6a36a3aa436b778beba9677338542444f0, without it.
  const MAIN: Record<string, string> = {
    "initial-assessment-report.rtf": "3beeabb75e83e5697c5f51da2b42186e55770d7e21729e1e3653aa2c2d8e0912",
    "progress-report-textedit.rtf": "2ec9ea0abbcb7100c8b8e5f811a4046d251dc1fee40b0592b8c44c9e70212287",
    "mail-merge-report.rtf": "dc456f8a33130ccd30262700443466bc6657c593f97dc1300e22215db176a046",
    "tick-box-discharge.rtf": "c95ab91828d5a190791074a6c8cab12e9c15bde7b5a544bb7a6093f827545437",
  };
  for (const [name, hash] of Object.entries(MAIN)) assert.equal(sha(convertRtfToDocx(rtf(name), { maxBytes: MAX }).docx), hash, name);
});

const WORDING_BANNED = [/\bAI\b/, /Claude/i, /Anthropic/i, /\bLLM\b/, /\bGPT/i, /machine learning/i];

async function readFixture(): Promise<{ form: FormDefinition; docx: Uint8Array }> {
  const file = decodeFormFile(Buffer.from(rtf(FIXTURE)).toString("base64"), { convertRtf: true });
  const result = await analyseFormFile({ file, fileName: FIXTURE, mode: "demo", rulesOnly: true, referrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" }, now: new Date(AT) });
  const mergeFields = await findFormMergeFields(file);
  return { form: { ...result.form, analysis: { ...result.form.analysis, mergeFields } }, docx: file.bytes };
}

const at = (form: FormDefinition, blockId: string, placeholder: string): FormField => {
  const f = form.fields.find((x) => x.anchor.kind === "docx" && x.anchor.blockId === blockId && x.anchor.placeholderText === placeholder);
  assert.ok(f, `${blockId} ${placeholder}`);
  return f;
};
const pathOf = (f: FormField) => (f.fillSource.kind === "registration" ? `${f.fillSource.path}${f.fillSource.part ? ` ${f.fillSource.part.index}/${f.fillSource.part.of}` : ""}` : f.fillSource.kind);

test("reading: one From-records question per code, bound to the right record field; others for staff, flagged", async () => {
  const { form } = await readFixture();
  const expect: Array<[string, string, string]> = [
    ["p3", "<<P_GROUPREF>>", "referral.reference"],
    ["p4", "<<P_TITLE>>", "patient.title"],
    ["p4", "<<P_FIRSTNAM>>", "patient.firstName"],
    ["p4", "<<P_SURNAME>>", "patient.lastName"],
    ["p5", "<<P_ADDRESS1>>", "patient.addressLines 1/5"],
    ["p6", "<<P_ADDRESS2>>", "patient.addressLines 2/5"],
    ["p7", "<<P_ADDRESS3>>", "patient.addressLines 3/5"],
    ["p8", "<<P_ADDRESS4>>", "patient.addressLines 4/5"],
    ["p9", "<<P_ADDRESS5>>", "patient.addressLines 5/5"],
    ["p10", "<<P_POSTCODE>>", "patient.postcode"],
    ["p12", "<<P_DOB>>", "patient.dob"],
    ["p13", "<<P_ALTERNATE_REF1>>", "incident.date"],
    ["p14", "<<P_HOSP_NUM>>", "staff.entry"],
    ["p15", "<<P_CONTACT_PREF>>", "staff.entry"],
    ["p16", "<<P_ADDRESS1>>, <<P_ADDRESS3>>, <<P_POSTCODE>>", "patient.address"],
    ["t0.r0.c1", "<<P_FIRSTNAM>>", "patient.firstName"],
    ["t0.r0.c1", "<<P_SURNAME>>", "patient.lastName"],
    ["t0.r1.c1", "<<P_EMPLOYER>>", "patient.employer"],
    ["p19", "<<P_CONSNAME>>", "clinician.name"],
    ["p21", "<<P_LOCATION_NAME>>", "clinic.name"],
    ["p22", "<<P_LOCATION_ADDRESS1>>", "clinic.addressLines 1/2"],
    ["p23", "<<P_LOCATION_ADDRESS2>>", "clinic.addressLines 2/2"],
    ["p24", "<<P_LOCATION_POSTCODE>>", "clinic.postcode"],
    ["p26", "<<DATE>>", "report.date"],
  ];
  for (const [block, code, want] of expect) assert.equal(pathOf(at(form, block, code)), want, `${block} ${code}`);
  assert.equal(at(form, "p12", "<<P_DOB>>").answerType, "date");
  assert.equal(at(form, "p13", "<<P_ALTERNATE_REF1>>").label, "Date of Accident", "the printed label");
  assert.equal(at(form, "p13", "<<P_ALTERNATE_REF1>>").confidence, "medium");
  assert.equal(at(form, "p3", "<<P_GROUPREF>>").label, "Our Reference");
  assert.equal(at(form, "p4", "<<P_FIRSTNAM>>").label, "Patient's first name", "several codes on a line: the dictionary's labels");
  assert.equal(at(form, "t0.r1.c1", "<<P_EMPLOYER>>").label, "Employer", "a code alone in a cell: the label cell to its left");
  const hosp = at(form, "p14", "<<P_HOSP_NUM>>");
  assert.equal(hosp.confidence, "low");
  assert.match(hosp.note ?? "", /<<P_HOSP_NUM>> \(the patient's hospital number\): the record here does not hold it, so staff enter it/);
  assert.match(at(form, "p15", "<<P_CONTACT_PREF>>").note ?? "", /is not one this form reading knows/);
  // The reading's own clinical question is kept; the other kinds of merge field are still answer boxes.
  assert.ok(form.fields.some((f) => f.label.startsWith("History of presenting complaint")), "the clinical question");
  assert.equal(form.fields.filter((f) => f.anchor.kind === "docx" && /<<[A-Z]/.test(f.anchor.placeholderText ?? "")).length, 24);
  assert.deepEqual(form.fields.map((f) => f.id), form.fields.map((_, i) => `F-${String(i + 1).padStart(2, "0")}`), "numbered in document order");
  assert.ok(form.analysis.warnings.some((w) => /merge codes from your clinic system .* questions are answered from the patient's record; 2 are left for staff/.test(w)));
  // Every recorded merge field has a question replacing it.
  const blank: Pick<Report, "sections"> = { sections: [] };
  assert.equal(unresolvedMergeFields(form, blank).reduce((n, u) => n + u.count, 0), 26, "nothing answered yet: all 26 left");
});

test("binding a later employer label: a code beside a contradicting label is bound but flagged", async () => {
  const parsed = { kind: "docx" as const, blocks: [{ id: "p0", kind: "paragraph" as const, text: "Solicitor: <<P_EMPLOYER>>", isEmpty: false, hasPlaceholder: false }], warnings: [] };
  const r = bindPracticeMergeCodes(parsed, []);
  assert.equal(r.fields.length, 1);
  assert.equal(r.fields[0].confidence, "low");
  assert.match(r.fields[0].note ?? "", /suggests something else is meant here/);
  const noCodes = bindPracticeMergeCodes({ kind: "docx", blocks: [{ id: "p0", kind: "paragraph", text: "Name: ____", isEmpty: false, hasPlaceholder: true, placeholderText: "____" }], warnings: [] }, []);
  assert.equal(noCodes.fromRecords + noCodes.forStaff, 0, "a form without codes is left alone");
  assert.equal(addressPartValue(["1 Road", "Town"], { index: 1, of: 1 }, [])?.text, "1 Road, Town");
  assert.equal(addressPartValue(["1 Road", "Town", "County"], { index: 2, of: 2 }, [])?.text, "Town, County", "the last printed line takes the rest");
  assert.deepEqual(addressPartValue(["1 Road"], { index: 2, of: 3 }, ["REG"]), { text: "", value: "", sourceIds: ["REG"], blank: true });
  assert.equal(addressPartValue([], { index: 1, of: 3 }, []), null, "no address: the first line is for staff");
  assert.equal(addressPartValue([], { index: 2, of: 3 }, [])?.blank, true);
  // A PDF form is never touched.
  assert.deepEqual(bindPracticeMergeCodes({ kind: "pdf_flat", pdf: { pages: 1, fields: [], pageText: [] }, warnings: [] }, []).fields, []);
  void parseFormFile;
});

test("Megan Hart (fictional) on the form: record values in place, empty address lines removed, staff entries block approval until entered, FINAL Word file without any merge code", async () => {
  const { form: proposed, docx } = await readFixture();
  const form: FormDefinition = { ...proposed, status: "confirmed", confirmed: { by: "Sarah Reid", at: AT } };
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-24" }), now: new Date(AT), id: "rpt_codes_megan" });
  const text = (f: FormField) => {
    const s = report.sections.find((x) => x.key === f.id);
    assert.ok(s, f.id);
    return { s, text: s.paragraphs.map((p) => p.text).join(" ") };
  };
  assert.equal(text(at(form, "p4", "<<P_TITLE>>")).text, "Ms");
  assert.equal(text(at(form, "p4", "<<P_FIRSTNAM>>")).text, "Megan");
  assert.equal(text(at(form, "p4", "<<P_SURNAME>>")).text, "Hart");
  assert.equal(text(at(form, "p5", "<<P_ADDRESS1>>")).text, "14 Willow Bank (fictional)");
  assert.equal(text(at(form, "p6", "<<P_ADDRESS2>>")).text, "Bletchley");
  assert.equal(text(at(form, "p7", "<<P_ADDRESS3>>")).text, "Milton Keynes");
  for (const [b, c] of [["p8", "<<P_ADDRESS4>>"], ["p9", "<<P_ADDRESS5>>"]] as const) {
    const { s } = text(at(form, b, c));
    assert.equal(s.blankFromRecords, true, `${c}: left empty on purpose`);
    assert.equal(s.status, "complete");
  }
  assert.equal(text(at(form, "p10", "<<P_POSTCODE>>")).text, "MK3 9ZZ");
  assert.equal(text(at(form, "p16", "<<P_ADDRESS1>>, <<P_ADDRESS3>>, <<P_POSTCODE>>")).text, "14 Willow Bank (fictional), Bletchley, Milton Keynes, MK3 9ZZ");
  assert.equal(text(at(form, "p12", "<<P_DOB>>")).s.answer?.value, bundle.registration.dob);
  assert.equal(text(at(form, "p13", "<<P_ALTERNATE_REF1>>")).s.answer?.value, "2026-03-12", "the date of the accident");
  assert.equal(text(at(form, "p26", "<<DATE>>")).s.answer?.value, "2026-10-24");
  assert.ok(text(at(form, "p21", "<<P_LOCATION_NAME>>")).text.length > 0, "the clinic's name (the demo clinic)");
  assert.ok(text(at(form, "p24", "<<P_LOCATION_POSTCODE>>")).text.length > 0, "the clinic's postcode");
  for (const [b, c] of [["p14", "<<P_HOSP_NUM>>"], ["p15", "<<P_CONTACT_PREF>>"]] as const) {
    const { s } = text(at(form, b, c));
    assert.equal(s.status, "needs_input", c);
    assert.ok(report.gaps.some((g) => g.sectionKey === s.key), `${c}: a gap for staff`);
  }

  // Approval is blocked while a code is left: the staff entries, the referrer's own reference (another organisation's
  // form) and anything else unanswered.
  const template = formToTemplate(form);
  const before = validateReport(report, template, { form });
  const blocking = before.flags.filter((f) => f.code === "MISSING_PLACEHOLDER" && /mail-merge field/.test(f.message));
  // Fix 10/2026: the code is in the evidence (flag IDs unchanged); the message says what it is in plain words.
  assert.ok(blocking.some((f) => /<<P_HOSP_NUM>>/.test(f.evidence ?? "") && /your clinic system's placeholder for the patient's hospital number, in /.test(f.message)));
  assert.ok(blocking.some((f) => /<<P_CONTACT_PREF>>/.test(f.evidence ?? "") && /your clinic system's placeholder “P_CONTACT_PREF”, in /.test(f.message)));
  for (const f of blocking) assert.doesNotMatch(f.message, /<<[A-Z]/, `no raw clinic-system code shown: ${f.message}`);
  assert.equal(before.canSign, false);

  // Staff enter what the record does not hold (and the clinical answer); the gaps are answered.
  for (const s of report.sections) {
    const unanswered = !s.blankFromRecords && s.paragraphs.every((p) => !p.text.trim()) && (!s.answer || s.answer.value === null);
    if (!unanswered || s.kind === "declaration") continue;
    s.paragraphs = [{ id: `${s.key}-p1`, text: s.kind === "from_records" ? `Staff entry ${s.key} (fictional)` : "Neck pain after a rear-end collision (fictional).", sourceIds: [], origin: "clinician" }];
    s.status = "complete";
  }
  for (const g of report.gaps) g.resolution = { kind: "resolved", text: "Entered by staff.", at: AT };
  const left = unresolvedMergeFields(form, report);
  assert.deepEqual(left, [], "every merge code is answered");

  const answers = buildFormAnswers(report, form);
  assert.deepEqual(answers[at(form, "p8", "<<P_ADDRESS4>>").id], { text: "", blank: true });
  const warnings: string[] = [];
  const out = fillDocx(docx, form, answers, { draft: false, onWarning: (w) => warnings.push(w) });
  assert.deepEqual(await mergeTokensInOutput(out, "docx"), [], "no merge code in the completed file");
  const blocks = buildDocxOutline(out).blocks;
  const filled = new Map(blocks.map((b) => [b.id, b.text]));
  assert.equal(filled.get("p4"), "Claimant: Ms Megan Hart");
  assert.equal(filled.get("p5"), "14 Willow Bank (fictional)");
  assert.equal(filled.get("p7"), "Milton Keynes");
  // Fix round 1 (B0-32): the address lines the record does not have are not left as empty lines – the postcode follows
  // the last line of the address (the two emptied paragraphs are removed, so the later block IDs move up by two).
  assert.equal(filled.get("p8"), "MK3 9ZZ", "an address line the record does not have leaves no empty line");
  const body = blocks.filter((b) => b.kind === "paragraph").map((b) => b.text);
  assert.equal(body[body.indexOf("Milton Keynes") + 1], "MK3 9ZZ");
  assert.match(filled.get("p10") ?? "", /^Date of Birth: \d\d\/\d\d\/\d{4}$/);
  assert.equal(filled.get("p11"), "Date of Accident: 12/03/2026");
  assert.equal(filled.get("p14"), "Home address on one line: 14 Willow Bank (fictional), Bletchley, Milton Keynes, MK3 9ZZ");
  assert.equal(filled.get("t0.r0.c1"), "Megan Hart");
  assert.equal(filled.get("p24"), "Date of report: 24/10/2026");
  assert.deepEqual(warnings.filter((w) => /not found|could not/.test(w)), []);
});

test("verify fix: <<DATE>> beside a label naming another date – the accident's date from the record, any other date flagged", () => {
  const para = (id: string, text: string) => ({ id, kind: "paragraph" as const, text, isEmpty: false, hasPlaceholder: false });
  const parsed = {
    kind: "docx" as const,
    blocks: [
      para("p0", "Accident date: <<DATE>>"),
      para("p1", "First appointment:      Discharged on: <<DATE>>"),
      para("p2", "Date of first visit: <<DATE>>"),
      para("p3", "Date: <<DATE>>"),
      para("p4", "Form completed: <<DATE>>"),
      para("p5", "Accident date:            Report date: <<DATE>>"),
      para("p6", "Client: <<P_SURNAME>>      Assessed on: <<DATE>>"),
    ],
    warnings: [],
  };
  const r = bindPracticeMergeCodes(parsed, []);
  const by = (block: string) => {
    const f = r.fields.find((x) => x.anchor.kind === "docx" && x.anchor.blockId === block && x.anchor.placeholderText === "<<DATE>>");
    assert.ok(f, block);
    return { path: pathOf(f), confidence: f.confidence, note: f.note ?? "", answerType: f.answerType };
  };
  assert.deepEqual({ ...by("p0"), note: undefined }, { path: "incident.date", confidence: "medium", note: undefined, answerType: "date" }, "the accident's date, not today's");
  assert.match(by("p0").note, /asks for the date of the accident/);
  for (const b of ["p1", "p2", "p6"]) {
    assert.equal(by(b).path, "report.date", b);
    assert.equal(by(b).confidence, "low", `${b}: flagged for staff`);
    assert.match(by(b).note, /names another date than the report's/);
  }
  for (const b of ["p3", "p4", "p5"]) assert.deepEqual([by(b).path, by(b).confidence], ["report.date", "high"], `${b}: the report's date`);
});

test("verify fix: 'left empty on purpose' only counts for address lines – a forged flag elsewhere never passes approval or removes a code", async () => {
  const { form: proposed, docx } = await readFixture();
  const form: FormDefinition = { ...proposed, status: "confirmed", confirmed: { by: "Sarah Reid", at: AT } };
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-24" }), now: new Date(AT), id: "rpt_codes_forged" });
  const hosp = at(form, "p14", "<<P_HOSP_NUM>>");
  const line4 = at(form, "p8", "<<P_ADDRESS4>>");
  const s = report.sections.find((x) => x.key === hosp.id);
  assert.ok(s);
  // The browser sends the report: a section flagged "left empty on purpose" that is not an address line.
  s.blankFromRecords = true;
  s.status = "complete";
  report.gaps = report.gaps.filter((g) => g.sectionKey !== hosp.id);
  assert.ok(unresolvedMergeFields(form, report).some((u) => u.text === "<<P_HOSP_NUM>>"), "the code still counts as left");
  const v = validateReport(report, formToTemplate(form), { form });
  assert.equal(v.canSign, false);
  assert.ok(v.flags.some((f) => f.code === "MISSING_PLACEHOLDER" && f.sectionKey === hosp.id), "the empty staff entry blocks approval");
  const answers = buildFormAnswers(report, form);
  assert.deepEqual(answers[hosp.id], {}, "not written as a removed code");
  assert.deepEqual(answers[line4.id], { text: "", blank: true }, "a real empty address line still is");
  const out = fillDocx(docx, form, answers, { draft: true });
  assert.ok((await mergeTokensInOutput(out, "docx")).includes("<<P_HOSP_NUM>>") || buildDocxOutline(out).blocks.some((b) => /not answered yet|<<P_HOSP_NUM>>/.test(b.text)), "the draft still shows it is unanswered");
});
