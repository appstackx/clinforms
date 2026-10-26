/**
 * RTF referrer forms through the forms engine and the API (fictional fixtures in fixtures/rtf/):
 * - every fixture converts and the Word engine reads its questions in paragraphs and table cells;
 * - the browser (upload dialog) and the server convert an RTF to the SAME bytes and SHA-256;
 * - RTF is accepted only where asked (analysis, fill / render files); the clinic store and every Word / PDF
 *   path decode exactly as before;
 * - POST /forms/analyse (demo mode, layout rules) on each fixture: a Word form map that keeps the ".rtf"
 *   name, carries the conversion notes and finds the questions;
 * - fillDocx writes answers into the converted template's own cells, blanks, «merge» placeholders and
 *   tick boxes;
 * - the partner API path: fill-preview and a FINAL render sent the RTF itself, approved as Sarah Reid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";

import PizZip from "pizzip";
import { route } from "@/app/api/_medreport-glue";
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { handleFormsFillPreview } from "@/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "@/modules/medreport/api/handlers/render";
import { handleSign } from "@/modules/medreport/api/handlers/sign";
import { HttpError, bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { FormsAnalyseResponseSchema, SignResponseSchema } from "@/modules/medreport/api/contract";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { createSessionToken } from "@/modules/medreport/auth/session-token";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, checkFormDefinition, formToTemplate } from "@/modules/medreport/core/forms";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { convertRtfToDocx, isRtfConversionNote } from "@/modules/medreport/core/rtf";
import type { Clinician, FillSource, FormDefinition, FormField, Report, SignReceipt } from "@/modules/medreport/core/types";
import { validateReport } from "@/modules/medreport/core/validation";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { fillDocx } from "@/modules/medreport/forms/docx-fill";
import { DOCX_MIME, PDF_MIME, decodeFormFile, sha256Hex, sniffFormFile } from "@/modules/medreport/forms/file";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import { FORM_ACCEPT, readFormFile } from "@/modules/medreport/ui/components/forms/analyse";
import { getDemoBundle } from "./dev-bundles";
import { demoBearer } from "./test-actors";

const DIR = path.join(process.cwd(), "scripts/medreport/fixtures/rtf");
const FIXTURES = {
  initial: "initial-assessment-report.rtf",
  progress: "progress-report-textedit.rtf",
  merge: "mail-merge-report.rtf",
  ticks: "tick-box-discharge.rtf",
} as const;
const rtfOf = (name: string) => new Uint8Array(fs.readFileSync(path.join(DIR, name)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const MAX = 2.5 * 1024 * 1024;
const docxOf = (name: string) => convertRtfToDocx(rtfOf(name), { maxBytes: MAX }).docx;
const outlineTexts = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));

const analyse = route(handleFormsAnalyse);
const deps = {} as MedreportDeps;
const DEMO_SESSION = createSessionToken({ tenantId: "demo", kind: "demo" }).token;
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const AT = "2026-10-21T19:00:00.000Z";

async function post(handler: MedreportHandler, url: string, body: unknown): Promise<Response> {
  return bindHandler(handler, () => deps)(
    new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${DEMO_SESSION}` }, body: JSON.stringify(body) }),
    { params: {} },
  );
}

function httpError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError, String(err));
    return err;
  }
  assert.fail("expected an HttpError");
}

/* ------------------------------------------------------------------------------------------------
 * Conversion and the Word engine
 * ----------------------------------------------------------------------------------------------*/

test("every fictional RTF fixture converts and the Word engine finds its questions (paragraphs and table cells)", () => {
  // (a) Word-style initial assessment: claimant details and clinical sections in two-column tables.
  const a = buildDocxOutline(docxOf(FIXTURES.initial));
  const ab = new Map(a.blocks.map((b) => [b.id, b]));
  assert.equal(ab.get("p0")?.text, "Initial Physiotherapy Assessment Report");
  assert.equal(ab.get("p0")?.headingLevel, 1);
  assert.equal(ab.get("p2")?.headingLevel, 2);
  assert.equal(ab.get("t0.r0.c0")?.text, "Claimant’s full name");
  assert.equal(ab.get("t0.r0.c1")?.isEmpty, true);
  assert.equal(ab.get("t1.r0.c0")?.text, "CLINICAL FINDINGS (to be completed by the treating physiotherapist)");
  assert.equal(ab.has("t1.r0.c1"), false, "the merged heading row is one cell");
  assert.equal(ab.get("t1.r1.c0")?.text, "Mechanism of injury");
  assert.equal(ab.get("t1.r1.c1")?.isEmpty, true);
  assert.equal(ab.get("t1.r7.c1")?.text, "Score at assessment");
  assert.equal(ab.get("t1.r9.c0")?.text, "Prognosis");
  assert.equal(ab.get("p8")?.placeholderText, "____________________________");
  assert.deepEqual(a.warnings, []);

  // (b) TextEdit (textutil) progress report: headings, blank answer lines, a small table, tick boxes.
  const b = new Map(buildDocxOutline(docxOf(FIXTURES.progress)).blocks.map((x) => [x.id, x]));
  assert.equal(b.get("p4")?.text, "1. Current presentation");
  assert.equal(b.get("p5")?.isEmpty, true);
  assert.equal(b.get("t0.r1.c0")?.text, "Sessions attended since the last report");
  assert.equal(b.get("p14")?.checkboxGlyphs, 2);

  // (c) mail merge: every merge field (MERGEFIELD, typed «…», <<…>>) is an answer space – a fill-in line
  // beside its label, an empty cell where it filled the cell; [Case_ID] is kept (noted); FORMTEXT → blank
  // line; dropdown → [A / B / C].
  const cb = new Map(buildDocxOutline(docxOf(FIXTURES.merge)).blocks.map((x) => [x.id, x]));
  assert.equal(cb.get("p1")?.text, "Patient: __________");
  assert.equal(cb.get("p4")?.text, "Treating physiotherapist: __________");
  assert.equal(cb.get("p5")?.text, "Our reference: __________");
  assert.equal(cb.get("p6")?.text, "Referral date: __________");
  assert.equal(cb.get("p7")?.text, "Case number: [Case_ID]");
  for (const r of [0, 1, 2, 3]) assert.equal(cb.get(`t0.r${r}.c1`)?.isEmpty, true, `merge cell row ${r} is an empty answer cell`);
  assert.equal(cb.get("t0.r3.c0")?.text, "HCPC number");
  assert.equal(cb.get("p10")?.text, "Working diagnosis: __________");
  assert.equal(cb.get("p18")?.text, "Current fitness for work: [Fit / Fit with adjustments / Unfit]");
  assert.ok(Array.from(cb.values()).every((x) => !/«|»|<<|>>/.test(x.text)), "no merge field survives the conversion");

  // (d) tick boxes of every kind read as ☐/☒.
  const d = new Map(buildDocxOutline(docxOf(FIXTURES.ticks)).blocks.map((x) => [x.id, x]));
  assert.equal(d.get("p3")?.text, "Discharged from treatment?   Yes ☐   No ☐");
  assert.equal(d.get("p4")?.checkboxGlyphs, 3);
  assert.equal(d.get("p5")?.text, "Home exercise programme given   ☒");
  assert.equal(d.get("p7")?.checkboxGlyphs, 2);
  assert.equal(d.get("t0.r0.c1")?.checkboxGlyphs, 2);
});

test("the browser and the server convert an RTF to the same bytes (same SHA-256); the file picker accepts .rtf", async () => {
  assert.match(FORM_ACCEPT, /(^|,)\.rtf(,|$)/);
  for (const name of Object.values(FIXTURES)) {
    const rtf = rtfOf(name);
    const local = await readFormFile({ name, bytes: rtf });
    const server = decodeFormFile(b64(rtf), { convertRtf: true });
    assert.equal(local.fileName, name);
    assert.equal(local.mimeType, DOCX_MIME);
    assert.equal(server.mimeType, DOCX_MIME);
    assert.equal(local.sha256, server.sha256, name);
    assert.equal(server.sha256, sha256Hex(local.bytes));
    assert.deepEqual(local.convertedFrom?.notes, server.convertedFrom?.notes);
    assert.equal(server.convertedFrom?.sha256, sha256Hex(rtf));
  }
  await assert.rejects(readFormFile({ name: "Broken.rtf", bytes: new TextEncoder().encode("{\\rtf1 cut off") }), /could not be converted from RTF\. The RTF file is incomplete/);
});

test("RTF only where asked: the clinic store path still refuses it; Word and PDF decode exactly as before", async () => {
  const rtf = rtfOf(FIXTURES.initial);
  assert.equal(sniffFormFile(rtf), null, "sniffFormFile is unchanged: RTF is not Word or PDF");
  const refused = httpError(() => decodeFormFile(b64(rtf)));
  assert.equal(refused.status, 422);
  assert.equal(refused.init.code, "FORM_INVALID");
  assert.equal(refused.init.detail, "Upload the referrer's form as a Word document (.docx) or a PDF.");

  for (const sample of SAMPLE_FORMS) {
    const bytes = await sample.loadFile();
    const before = decodeFormFile(b64(bytes));
    const after = decodeFormFile(b64(bytes), { convertRtf: true });
    assert.deepEqual(after, before, sample.id);
    assert.equal(before.convertedFrom, undefined);
    assert.equal(before.mimeType, sample.kind === "docx" ? DOCX_MIME : PDF_MIME);
    assert.equal(before.sha256, sha256Hex(bytes));
  }

  const truncated = httpError(() => decodeFormFile(b64(rtf.subarray(0, 20_000)), { convertRtf: true }));
  assert.equal(truncated.status, 422);
  assert.equal(truncated.init.code, "FORM_INVALID");
  assert.match(String(truncated.init.detail), /incomplete/);
  assert.equal(httpError(() => decodeFormFile(b64(rtf), { convertRtf: true, maxBytes: 20_000 })).status, 413, "the RTF itself is over the limit");
  assert.equal(httpError(() => decodeFormFile(b64(rtf), { convertRtf: true, maxBytes: 40_000 })).status, 413, "its Word conversion is over the limit");
  const junk = httpError(() => decodeFormFile(b64(new TextEncoder().encode("plain text")), { convertRtf: true }));
  assert.equal(junk.init.detail, "Upload the referrer's form as a Word document (.docx), a PDF or an RTF file.");
});

/* ------------------------------------------------------------------------------------------------
 * POST /forms/analyse (demo mode = layout rules)
 * ----------------------------------------------------------------------------------------------*/

async function analyseRtf(name: string) {
  const res = await analyse(
    new Request("http://127.0.0.1:9/api/reports/v1/forms/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: demoBearer() },
      body: JSON.stringify({ fileBase64: b64(rtfOf(name)), fileName: name, prefer: "demo" }),
    }),
    { params: {} },
  );
  assert.equal(res.status, 200, await res.clone().text());
  return FormsAnalyseResponseSchema.parse(await res.json());
}

test("POST /forms/analyse on each RTF fixture: a Word map that keeps the .rtf name, the conversion notes and the questions", async () => {
  for (const name of Object.values(FIXTURES)) {
    const { form, trace, outlineSummary } = await analyseRtf(name);
    assert.equal(form.kind, "docx", name);
    assert.equal(outlineSummary.kind, "docx");
    assert.equal(form.file.fileName, name);
    assert.equal(form.file.mimeType, DOCX_MIME);
    assert.equal(form.file.sha256, sha256Hex(docxOf(name)), "bound to the converted file");
    assert.equal(form.analysis.mode, "rules");
    assert.equal(trace?.[0]?.label, "Converted the RTF file to Word");
    assert.ok(form.fields.length > 0, name);
  }
  const a = await analyseRtf(FIXTURES.initial);
  // Fix round 1 (B0-14): its header's PNG logo is carried over (no "left out" note any more), as a picture of its own.
  assert.ok(!a.form.analysis.warnings.some((w) => isRtfConversionNote(w) && /picture \(such as a logo\)/.test(w)));
  assert.ok(new PizZip(docxOf(FIXTURES.initial)).file("word/media/image1.png"), "the logo is in the converted Word file");
  const anchorOf = (f: FormDefinition, label: string) => {
    const field = f.fields.find((x) => x.label === label);
    assert.ok(field, `field “${label}” in ${f.fields.map((x) => x.label).join(" | ")}`);
    return field.anchor;
  };
  assert.deepEqual(anchorOf(a.form, "Mechanism of injury"), { kind: "docx", target: "table_cell", blockId: "t1.r1.c1" });
  assert.deepEqual(anchorOf(a.form, "Prognosis"), { kind: "docx", target: "table_cell", blockId: "t1.r9.c1" });
  assert.deepEqual(anchorOf(a.form, "Date of birth"), { kind: "docx", target: "table_cell", blockId: "t0.r1.c1" });
  assert.equal(a.form.fields.find((x) => x.label === "Date of birth")?.fillSource.kind, "registration");

  const c = await analyseRtf(FIXTURES.merge);
  assert.ok(c.form.analysis.warnings.includes("Converted from RTF: 12 mail-merge fields from your clinic system («Patient_Name», «Clinic_Ref», «Patient_Address») were turned into answer boxes – check the mapping once."));
  assert.ok(c.form.analysis.warnings.some((w) => /placeholder that another system may fill in \(\[Case_ID\]\) was kept as printed/.test(w)));
  assert.ok(c.form.analysis.warnings.some((w) => /page header or footer has 2 fill-in spaces/.test(w)));
  assert.equal(c.form.analysis.mergeFields, undefined, "nothing left for the merge-field check");
  // The merge cells are separate questions, each with its own box (the therapist and the HCPC number too).
  assert.deepEqual(anchorOf(c.form, "Treating therapist"), { kind: "docx", target: "table_cell", blockId: "t0.r2.c1" });
  assert.deepEqual(anchorOf(c.form, "HCPC number"), { kind: "docx", target: "table_cell", blockId: "t0.r3.c1" });
  assert.deepEqual(anchorOf(c.form, "Referral reference"), { kind: "docx", target: "table_cell", blockId: "t0.r1.c1" });
  assert.deepEqual(c.form.fields.find((f) => f.label === "HCPC number")?.fillSource, { kind: "registration", path: "clinician.hcpc" });
  assert.deepEqual(c.form.fields.find((f) => f.label === "Treating therapist")?.fillSource, { kind: "registration", path: "clinician.name" });

  const d = await analyseRtf(FIXTURES.ticks);
  const discharged = d.form.fields.find((f) => /Discharged from treatment/.test(f.label));
  assert.equal(discharged?.answerType, "yes_no");
  assert.equal(discharged?.anchor.kind === "docx" && discharged.anchor.target, "checkbox_glyph");
});

/* ------------------------------------------------------------------------------------------------
 * Filling converted forms
 * ----------------------------------------------------------------------------------------------*/

function field(id: string, label: string, anchor: FormField["anchor"], fillSource: FillSource, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource, required: true, confidence: "high", ...rest };
}
const cellAnchor = (blockId: string): FormField["anchor"] => ({ kind: "docx", target: "table_cell", blockId });
const blank = (blockId: string, placeholderText: string): FormField["anchor"] => ({ kind: "docx", target: "replace_placeholder", blockId, placeholderText });

function mapFor(name: string, fields: FormField[], referrer: FormDefinition["referrer"]): FormDefinition {
  const bytes = docxOf(name);
  const form: FormDefinition = {
    id: `frm_rtf_${name.replace(/\W+/g, "_")}`,
    tenantId: "demo",
    referrer,
    title: name,
    file: { fileName: name, mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: AT, warnings: [] },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
  return withAttestedConfirmation(form, "Practice manager (demo)", AT);
}

test("fillDocx writes into a converted form's own blanks, «merge» placeholders, form-field lines and tick boxes", () => {
  const ticks = mapFor(
    FIXTURES.ticks,
    [
      field("F-01", "Patient name", blank("p2", "______________________"), { kind: "registration", path: "patient.fullName" }),
      field("F-02", "Discharged from treatment?", { kind: "docx", target: "checkbox_glyph", blockId: "p3", optionGlyphs: [{ option: "Yes", blockId: "p3", glyphIndex: 0 }, { option: "No", blockId: "p3", glyphIndex: 1 }] }, { kind: "notes_narrative" }, { answerType: "yes_no", options: ["Yes", "No"] }),
      field("F-03", "Treatment goals met", { kind: "docx", target: "checkbox_glyph", blockId: "p4", optionGlyphs: ["Fully", "Partly", "Not met"].map((option, glyphIndex) => ({ option, blockId: "p4", glyphIndex })) }, { kind: "notes_narrative" }, { answerType: "single_choice", options: ["Fully", "Partly", "Not met"] }),
      field("F-04", "Pain at discharge", cellAnchor("t0.r1.c1"), { kind: "notes_narrative" }),
    ],
    { name: "Brookvale Rehabilitation (fictional)", type: "case_manager" },
  );
  assert.deepEqual(checkFormDefinition(ticks), []);
  const out = fillDocx(docxOf(FIXTURES.ticks), ticks, { "F-01": { text: "Megan Hart" }, "F-02": { value: true, text: "Yes" }, "F-03": { value: "Partly", text: "Partly" }, "F-04": { text: "2/10" } }, { draft: false });
  const t = outlineTexts(out);
  assert.equal(t.p2, "Patient name: Megan Hart");
  assert.equal(t.p3, "Discharged from treatment?   Yes ☒   No ☐");
  assert.equal(t.p4, "Treatment goals met:   Fully ☐   Partly ☒   Not met ☐");
  assert.equal(t["t0.r1.c1"], "2/10");
  assert.equal(t["t0.r0.c0"], "Able to return to normal activities", "labels untouched");

  const merge = mapFor(
    FIXTURES.merge,
    [
      field("F-01", "Patient", blank("p1", "__________"), { kind: "registration", path: "patient.fullName" }),
      field("F-02", "Date of birth", blank("p3", "__________"), { kind: "registration", path: "patient.dob" }, { answerType: "date" }),
      field("F-03", "Working diagnosis", blank("p10", "__________"), { kind: "notes_narrative" }),
      field("F-04", "Current symptoms", { kind: "docx", target: "after_paragraph", blockId: "p11" }, { kind: "notes_narrative" }, { answerType: "long_text" }),
      field("F-05", "Treating therapist", cellAnchor("t0.r2.c1"), { kind: "registration", path: "clinician.name" }),
      field("F-06", "HCPC number", cellAnchor("t0.r3.c1"), { kind: "registration", path: "clinician.hcpc" }),
    ],
    { name: "Wrenfield Reporting Partners (fictional)", type: "mlc" },
  );
  const m = outlineTexts(
    fillDocx(
      docxOf(FIXTURES.merge),
      merge,
      { "F-01": { text: "Megan Hart" }, "F-02": { text: "22/11/1991" }, "F-03": { text: "Whiplash-associated disorder grade II" }, "F-04": { text: "Occasional neck ache after long drives." }, "F-05": { text: "Sarah Reid" }, "F-06": { text: "PH-DEMO-01" } },
      { draft: false },
    ),
  );
  assert.equal(m.p1, "Patient: Megan Hart");
  assert.equal(m.p3, "Date of birth: 22/11/1991");
  assert.equal(m.p2, "Address: __________", "an unmapped merge field is a blank line, never «Patient_Address»");
  assert.equal(m.p10, "Working diagnosis: Whiplash-associated disorder grade II");
  assert.equal(m.p11, "2. Current symptoms");
  assert.equal(m.p12, "Occasional neck ache after long drives.");
  assert.equal(m["t0.r2.c1"], "Sarah Reid");
  assert.equal(m["t0.r3.c1"], "PH-DEMO-01", "the HCPC number in its own cell");

  const progress = mapFor(
    FIXTURES.progress,
    [field("F-01", "Current presentation", { kind: "docx", target: "after_paragraph", blockId: "p4" }, { kind: "notes_narrative" }, { answerType: "long_text" }), field("F-02", "Date of this report", cellAnchor("t0.r0.c1"), { kind: "registration", path: "report.date" })],
    { name: "Fernhill Case Management (fictional)", type: "case_manager" },
  );
  const p = outlineTexts(fillDocx(docxOf(FIXTURES.progress), progress, { "F-01": { text: "Neck pain has settled to 2/10." }, "F-02": { text: "21/10/2026" } }, { draft: true, reviewMarkers: true }));
  assert.match(p.p5, /^Neck pain has settled to 2\/10\. \[F-01\]$/);
  assert.match(p["t0.r0.c1"], /^21\/10\/2026/);
});

/* ------------------------------------------------------------------------------------------------
 * The partner API: fill-preview and FINAL render sent the RTF itself
 * ----------------------------------------------------------------------------------------------*/

function initialAssessmentMap(): FormDefinition {
  const reg = (p: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path: p });
  return mapFor(
    FIXTURES.initial,
    [
      field("F-01", "Claimant’s full name", cellAnchor("t0.r0.c1"), reg("patient.fullName")),
      field("F-02", "Date of birth", cellAnchor("t0.r1.c1"), reg("patient.dob"), { answerType: "date" }),
      field("F-03", "Date of accident", cellAnchor("t0.r3.c1"), reg("incident.date"), { answerType: "date" }),
      field("F-04", "Instructing solicitor", cellAnchor("t0.r4.c1"), reg("referral.referrerName")),
      field("F-05", "Mechanism of injury", cellAnchor("t1.r1.c1"), { kind: "notes_narrative" }, { answerType: "long_text" }),
      field("F-06", "Number of sessions attended", cellAnchor("t1.r6.c1"), { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" }, { answerType: "number" }),
      field("F-07", "Prognosis", cellAnchor("t1.r9.c1"), { kind: "clinician_opinion" }, { answerType: "long_text" }),
      field("F-08", "Signed", blank("p8", "____________________________"), { kind: "signoff", part: "signature" }, { answerType: "signature" }),
      field("F-09", "Date", blank("p8", "______________"), { kind: "signoff", part: "date" }, { answerType: "date_signed" }),
      field("F-10", "Physiotherapist’s name", blank("p9", "______________________"), { kind: "signoff", part: "name" }, { answerType: "clinician_name" }),
      field("F-11", "HCPC number", blank("p9", "____________"), { kind: "signoff", part: "hcpc" }, { answerType: "hcpc_number" }),
    ],
    { name: "Larchfield Medico-Legal Services (fictional)", type: "mlc" },
  );
}

function completedReport(form: FormDefinition): Report {
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-21" }), now: new Date(AT), id: "rpt_rtf_megan" });
  const write = (key: string, text: string) => {
    const s = report.sections.find((x) => x.key === key);
    assert.ok(s, key);
    s.paragraphs = [{ id: `${key}-p1`, text, sourceIds: [], origin: "clinician" }];
    s.status = "complete";
  };
  write("F-05", "Rear-end collision while stationary at traffic lights on 12/03/2026; neck stiffness the same evening.");
  write("F-07", "In my opinion Ms Hart has made a good recovery and the remaining intermittent neck ache should settle within three to six months.");
  for (const g of report.gaps) g.resolution = { kind: "acknowledged", text: "Answered on the form by the clinician.", at: AT };
  return report;
}

test("partner API: fill-preview and the FINAL render take the RTF itself; answers land in the template's cells and blanks", async () => {
  const form = initialAssessmentMap();
  assert.deepEqual(checkFormDefinition(form), []);
  const report = completedReport(form);
  const v = validateReport(report, formToTemplate(form));
  assert.ok(v.canSign, JSON.stringify(v.flags.filter((f) => f.severity === "blocking")));
  const rtfBase64 = b64(rtfOf(FIXTURES.initial));

  const preview = await post(handleFormsFillPreview, "/forms/fill-preview", { report, form, fileBase64: rtfBase64, mode: "draft" });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal(preview.headers.get("x-medreport-render"), "draft");
  assert.match(preview.headers.get("content-disposition") ?? "", /\.docx"?$/);

  // bh2 WA1 (design 6): the referrer's file goes with the approval too – /sign fills it as a dry run (the RTF itself).
  const signRes = await post(handleSign, "/sign", { report, signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form, fileBase64: rtfBase64 });
  assert.equal(signRes.status, 200, await signRes.clone().text());
  const { receipt } = SignResponseSchema.parse(await signRes.json());
  const signed: Report = { ...report, status: "signed", receipt: receipt as SignReceipt };

  const final = await post(handleRender, "/render?format=original", { report: signed, receipt, form, fileBase64: rtfBase64, requireFinal: true });
  assert.equal(final.status, 200, await final.clone().text());
  assert.equal(final.headers.get("x-medreport-render"), "final");
  assert.match(final.headers.get("content-disposition") ?? "", /_SIGNED\.docx/);
  const bytes = new Uint8Array(await final.arrayBuffer());
  const t = outlineTexts(bytes);
  assert.equal(t["t0.r0.c1"], "Megan Hart");
  assert.equal(t["t0.r1.c1"], "22/11/1991");
  assert.equal(t["t0.r3.c1"], "12/03/2026");
  assert.match(t["t0.r4.c1"], /Harrow & Pike/);
  assert.match(t["t1.r1.c1"], /^Rear-end collision/);
  assert.equal(t["t1.r6.c1"], "10");
  assert.match(t["t1.r9.c1"], /^In my opinion Ms Hart/);
  assert.match(t.p8, /^Signed: Sarah Reid – approved electronically on \d{2}\/\d{2}\/\d{4}\s+Date: \d{2}\/\d{2}\/\d{4}$/);
  assert.equal(t.p9, "Physiotherapist’s name: Sarah Reid   HCPC number: PH-DEMO-01");
  // The layout survived: the same blocks (no rows, cells or paragraphs added or lost), labels unchanged,
  // the page header and footer still there.
  const before = buildDocxOutline(docxOf(FIXTURES.initial)).blocks.map((b) => b.id);
  assert.deepEqual(buildDocxOutline(bytes).blocks.map((b) => b.id), before);
  assert.equal(t["t1.r1.c0"], "Mechanism of injury");
  const zip = new PizZip(bytes);
  assert.ok(zip.file("word/header1.xml") && zip.file("word/footer1.xml"));

  // The Studio sends the converted Word file instead: the same map and the same result.
  const viaDocx = await post(handleRender, "/render?format=original", { report: signed, receipt, form, fileBase64: b64(docxOf(FIXTURES.initial)), requireFinal: true });
  assert.equal(viaDocx.status, 200);
  assert.deepEqual(outlineTexts(new Uint8Array(await viaDocx.arrayBuffer())), t);

  // Another RTF is not the form the map was made for.
  const other = await post(handleRender, "/render?format=original", { report: signed, receipt, form, fileBase64: b64(rtfOf(FIXTURES.merge)), requireFinal: true });
  assert.equal(other.status, 409);
  assert.equal((await other.json()).code, "FORM_MISMATCH");
});
