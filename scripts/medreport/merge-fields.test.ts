/**
 * Mail-merge fields never reach an approved form (10/2026; core/merge-fields.ts, forms/merge-scan.ts,
 * core/validation/merge-fields.ts, forms/render-form.ts), and the reading never drops a distinct
 * question for sharing an answer space (ai/form-postvalidate.ts):
 * - the detector is narrow: ordinary text – every demo draft, sample answer, demo note and bundled form –
 *   never triggers it;
 * - analysis records the merge fields of any Word or PDF form (body by block, page header / field code /
 *   printed PDF text as "cannot be completed here", PDF field values by field);
 * - approval is blocked (validation and POST /sign) until each is answered or replaced; a FINAL render
 *   refuses a completed file that still has one, a Word DRAFT lists them;
 * - the bundled forms are untouched: their readings (rules, recorded / pre-written, the portal example) equal
 *   the snapshot taken on main fcbe01d, their flags and final files are unchanged.
 * Fictional organisations only ("Thornbury Medico-Legal (fictional)").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";

import PizZip from "pizzip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { route } from "@/app/api/_medreport-glue";
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { handleSign } from "@/modules/medreport/api/handlers/sign";
import { HttpError, bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { FormsAnalyseResponseSchema } from "@/modules/medreport/api/contract";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { createSessionToken } from "@/modules/medreport/auth/session-token";
import { DEMO_DRAFT_SOURCES } from "@/modules/medreport/ai/demo-drafts";
import { postValidateFields } from "@/modules/medreport/ai/form-postvalidate";
import type { AnalysisFieldOutput } from "@/modules/medreport/ai/form-analysis-schema";
import { parseFormFile } from "@/modules/medreport/ai/analyse-form";
import { proposeFieldsByRules } from "@/modules/medreport/ai/form-rules";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, buildFormAnswers, formToTemplate } from "@/modules/medreport/core/forms";
import { findMergeTokens, unresolvedMergeFields } from "@/modules/medreport/core/merge-fields";
import { EXAMPLE_PORTAL_QUESTIONS, parsePortalQuestions, questionFields } from "@/modules/medreport/core/question-set";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import type { Clinician, FillSource, FormDefinition, FormField, Report } from "@/modules/medreport/core/types";
import { validateReport } from "@/modules/medreport/core/validation";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { DOCX_MIME, PDF_MIME, decodeFormFile, sha256Hex } from "@/modules/medreport/forms/file";
import { findFormMergeFields, mergeTokensInOutput } from "@/modules/medreport/forms/merge-scan";
import { renderFormFile } from "@/modules/medreport/forms/render-form";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import { HARROW_PIKE_FORM } from "@/modules/medreport/forms/samples/maps/harrow-pike";
import { KINGSWAY_FORM } from "@/modules/medreport/forms/samples/maps/kingsway";
import { NORTHFIELD_FORM } from "@/modules/medreport/forms/samples/maps/northfield";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import { demoBearer } from "./test-actors";

const AT = "2026-10-21T19:00:00.000Z";
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const DEMO_SESSION = createSessionToken({ tenantId: "demo", kind: "demo" }).token;
const deps = {} as MedreportDeps;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/* ------------------------------------------------------------------------------------------------
 * A Word form a practice system merges into (fictional): merge fields in the answer cells
 * ----------------------------------------------------------------------------------------------*/

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const cell = (inner: string) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(inner)}</w:tc>`;
const row = (a: string, b: string) => `<w:tr>${cell(t(a))}${cell(b ? t(b) : "")}</w:tr>`;
const mergeCode = (name: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> MERGEFIELD ${name} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${t(`«${name}»`)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

function mergeDocx(opts: { header?: string; fieldCode?: boolean } = {}): Uint8Array {
  const zip = new PizZip();
  const header = opts.header !== undefined;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}</Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${header ? `<Relationship Id="rId9" Type="${R}/header" Target="header1.xml"/>` : ""}</Relationships>`,
  );
  if (header) zip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="${W}">${p(t(opts.header ?? ""))}</w:hdr>`);
  const body = [
    p(t("Treating Physiotherapist Report")),
    `<w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${row("Patient name", "«Patient Name»")}${row("Referral reference", "«Referral Ref»")}${row("Treating therapist", "«Therapist»")}${row("HCPC number", "")}</w:tbl>`,
    p(t("Signed: ________________   Date: __________")),
    ...(opts.fieldCode ? [p(t("Clinic: ") + mergeCode("Clinic"))] : []),
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rId9"/>' : ""}</w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array" });
}

const reg = (path: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path });
function f(id: string, label: string, anchor: FormField["anchor"], fillSource: FillSource, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource, required: true, confidence: "high", ...rest };
}
const cellA = (blockId: string): FormField["anchor"] => ({ kind: "docx", target: "table_cell", blockId });
const replaceA = (blockId: string, placeholderText: string): FormField["anchor"] => ({ kind: "docx", target: "replace_placeholder", blockId, placeholderText });

async function mapOf(bytes: Uint8Array, fields: FormField[], kind: FormDefinition["kind"] = "docx"): Promise<FormDefinition> {
  const file = { bytes, mimeType: kind === "docx" ? DOCX_MIME : PDF_MIME } as const;
  const mergeFields = await findFormMergeFields(file);
  const form: FormDefinition = {
    id: "frm_thornbury",
    tenantId: "demo",
    referrer: { name: "Thornbury Medico-Legal (fictional)", type: "mlc" },
    title: "Treating Physiotherapist Report",
    file: { fileName: kind === "docx" ? "thornbury.docx" : "thornbury.pdf", mimeType: file.mimeType, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind,
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: AT, warnings: [], ...(mergeFields.length && { mergeFields }) },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
  return withAttestedConfirmation(form, "Practice manager (demo)", AT);
}

/** What the layout rules propose for the merge form: questions only where a box is empty (the HCPC cell, the signature line). */
const RULES_LIKE: FormField[] = [
  f("F-01", "HCPC number", cellA("t0.r3.c1"), reg("clinician.hcpc"), { answerType: "hcpc_number" }),
  f("F-02", "Signed", replaceA("p1", "________________"), { kind: "signoff", part: "signature" }, { answerType: "signature" }),
  f("F-03", "Date", replaceA("p1", "__________"), { kind: "signoff", part: "date" }, { answerType: "date_signed" }),
];
/** The mapping fixed by staff: a question replaces each merge field. */
const FIXED: FormField[] = [
  f("F-01", "Patient name", replaceA("t0.r0.c1", "«Patient Name»"), reg("patient.fullName")),
  f("F-02", "Referral reference", replaceA("t0.r1.c1", "«Referral Ref»"), { kind: "fixed", value: "LMR/2026/014" }),
  f("F-03", "Treating therapist", replaceA("t0.r2.c1", "«Therapist»"), { kind: "signoff", part: "name" }, { answerType: "clinician_name" }),
  f("F-04", "HCPC number", cellA("t0.r3.c1"), { kind: "signoff", part: "hcpc" }, { answerType: "hcpc_number" }),
  f("F-05", "Signed", replaceA("p1", "________________"), { kind: "signoff", part: "signature" }, { answerType: "signature" }),
  f("F-06", "Date", replaceA("p1", "__________"), { kind: "signoff", part: "date" }, { answerType: "date_signed" }),
];

function reportFor(form: FormDefinition): Report {
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-21" }), now: new Date(AT), id: "rpt_thornbury" });
  for (const g of report.gaps) g.resolution = { kind: "acknowledged", text: "Checked by the clinician.", at: AT };
  return report;
}

const mergeFlags = (form: FormDefinition, report: Report) =>
  validateReport(report, formToTemplate(form), { form }).flags.filter((x) => /mail-merge/.test(x.message));

/* ------------------------------------------------------------------------------------------------
 * The detector is narrow
 * ----------------------------------------------------------------------------------------------*/

test("the detector finds «Name», <<Name>> and MERGEFIELD – and nothing in ordinary text", () => {
  assert.deepEqual(findMergeTokens("Patient: «Patient_Name», ref «Referral Ref» <<DOB>> and a MERGEFIELD code"), ["«Patient_Name»", "«Referral Ref»", "<<DOB>>", "MERGEFIELD"]);
  for (const ordinary of [
    "She said « I can’t sit for long » at the review.",
    "Pain «7/10» at worst",
    "«» and << >> and <<5 sessions>>",
    "x << y and z >> w; NPRS 7 >> 2",
    "Quoted «this one is a much longer quoted phrase than any merge field name»",
    "mergefield in lower case, MergeField in mixed case",
    "[Patient Name] {Claim} $DOB$ %REF% – other systems' tokens are not merge fields here",
  ]) assert.deepEqual(findMergeTokens(ordinary), [], ordinary);
});

test("ordinary answers never trigger it: demo drafts, sample answers, demo notes and every bundled form", async () => {
  const texts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(DEMO_DRAFT_SOURCES);
  for (const slug of ["megan-hart", "daniel-brooks", "rebecca-lane"] as const) walk(getDemoBundle(slug));
  for (const [slug, form] of [["megan-hart", HARROW_PIKE_FORM], ["megan-hart", NORTHFIELD_FORM], ["daniel-brooks", KINGSWAY_FORM]] as const) walk(completedSampleReport(slug, form).sections);
  assert.ok(texts.length > 500, `${texts.length} strings scanned`);
  assert.deepEqual(texts.filter((x) => findMergeTokens(x).length > 0), []);
  for (const s of SAMPLE_FORMS) {
    const bytes = await s.loadFile();
    assert.deepEqual(await findFormMergeFields(decodeFormFile(b64(bytes))), [], s.id);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Analysis records them
 * ----------------------------------------------------------------------------------------------*/

test("analysis records a Word form's merge fields: answer cells by block; page header and field codes cannot be completed", async () => {
  const plain = await findFormMergeFields({ bytes: mergeDocx(), mimeType: DOCX_MIME });
  assert.deepEqual(plain, [
    { text: "«Patient Name»", where: "table 1, row 1", blockId: "t0.r0.c1" },
    { text: "«Referral Ref»", where: "table 1, row 2", blockId: "t0.r1.c1" },
    { text: "«Therapist»", where: "table 1, row 3", blockId: "t0.r2.c1" },
  ]);
  const withHeader = await findFormMergeFields({ bytes: mergeDocx({ header: "Re: «Patient Name»", fieldCode: true }), mimeType: DOCX_MIME });
  assert.deepEqual(withHeader.slice(3), [
    { text: "«Clinic»", where: "paragraph 3", blockId: "p2" },
    { text: "MERGEFIELD", where: "a Word field code", fixed: true },
    { text: "«Patient Name»", where: "the page header", fixed: true },
  ]);

  const res = await route(handleFormsAnalyse)(
    new Request("http://127.0.0.1:9/api/reports/v1/forms/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: demoBearer() },
      body: JSON.stringify({ fileBase64: b64(mergeDocx({ header: "Re: «Patient Name»" })), fileName: "thornbury.docx", prefer: "demo" }),
    }),
    { params: {} },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const { form } = FormsAnalyseResponseSchema.parse(await res.json());
  assert.equal(form.analysis.mergeFields?.length, 4);
  assert.match(
    form.analysis.warnings[0],
    /^This form contains 4 mail-merge fields \(«Patient Name», «Referral Ref», «Therapist»\)\. A form is never approved with one left on it: check that a question replaces each one; one is in the page header, which cannot be completed here – ask the referrer for the form without it\.$/,
  );
});

test("analysis records a PDF's merge fields: printed text cannot be completed; a field's value is cleared by answering it", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawText("Claimant: «Patient Name»", { x: 20, y: 250, size: 11, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const ref = pdf.getForm().createTextField("txtRef");
  ref.setText("«Referral Ref»");
  ref.addToPage(page, { x: 20, y: 200, width: 200, height: 18 });
  const bytes = await pdf.save();
  assert.deepEqual(await findFormMergeFields({ bytes, mimeType: PDF_MIME }), [
    { text: "«Patient Name»", where: "page 1", fixed: true },
    { text: "«Referral Ref»", where: "the form field “txtRef”", fieldName: "txtRef" },
  ]);
  const form = await mapOf(bytes, [f("F-01", "Referral reference", { kind: "pdf_field", fieldName: "txtRef", fieldType: "text" }, { kind: "fixed", value: "LMR/2026/014" })], "pdf_acroform");
  const left = unresolvedMergeFields(form, reportFor(form));
  assert.deepEqual(left.map((x) => [x.text, x.where]), [["«Patient Name»", "page 1"]], "the answered field clears its value; the printed one stays");
  // The final file is refused while printed text still carries a merge field.
  const report = reportFor(form);
  const err = await renderFormFile({ form, file: decodeFormFile(b64(bytes)), answers: buildFormAnswers(report, form), draft: false, format: "original" }).catch((e) => e);
  assert.ok(err instanceof HttpError && err.status === 422 && /still contains a mail-merge field \(«Patient Name»\)/.test(String(err.init.detail)), String(err));
});

/* ------------------------------------------------------------------------------------------------
 * Approval is blocked until each is answered or replaced
 * ----------------------------------------------------------------------------------------------*/

test("validation blocks approval while a merge field is left – with where it is and what to do; a fixed mapping clears it", async () => {
  const bytes = mergeDocx();
  const rules = await mapOf(bytes, RULES_LIKE);
  const report = reportFor(rules);
  const flags = mergeFlags(rules, report);
  assert.deepEqual(
    flags.map((x) => [x.severity, x.code, x.message]),
    [
      ["blocking", "MISSING_PLACEHOLDER", "This form still contains a mail-merge field: «Patient Name» in table 1, row 1. Answer the question whose box it is – or, in the form's mapping, make a question replace “«Patient Name»” – before approving."],
      ["blocking", "MISSING_PLACEHOLDER", "This form still contains a mail-merge field: «Referral Ref» in table 1, row 2. Answer the question whose box it is – or, in the form's mapping, make a question replace “«Referral Ref»” – before approving."],
      ["blocking", "MISSING_PLACEHOLDER", "This form still contains a mail-merge field: «Therapist» in table 1, row 3. Answer the question whose box it is – or, in the form's mapping, make a question replace “«Therapist»” – before approving."],
    ],
  );
  assert.equal(validateReport(report, formToTemplate(rules), { form: rules }).canSign, false);
  // Without the form map (every caller before 10/2026) only answers are checked.
  assert.deepEqual(validateReport(report, formToTemplate(rules)).flags.filter((x) => /mail-merge/.test(x.message)), []);

  // A question that writes INTO the merge cell (not replacing the text) does not clear it.
  const intoCell = await mapOf(bytes, [...RULES_LIKE, f("F-04", "Treating therapist", cellA("t0.r2.c1"), reg("clinician.name"))]);
  const into = mergeFlags(intoCell, reportFor(intoCell));
  assert.deepEqual(into.map((x) => x.evidence).sort(), ["mail-merge field «Patient Name» in table 1, row 1", "mail-merge field «Referral Ref» in table 1, row 2", "mail-merge field «Therapist» in table 1, row 3"]);
  assert.equal(into.find((x) => /Therapist/.test(x.evidence ?? ""))?.sectionKey, "F-04", "Go to the question in that box");

  const fixed = await mapOf(bytes, FIXED);
  const ok = reportFor(fixed);
  assert.deepEqual(mergeFlags(fixed, ok), []);
  assert.ok(validateReport(ok, formToTemplate(fixed), { form: fixed }).canSign);

  // An answer that itself contains a merge field is blocked on any report.
  const bad = structuredClone(ok);
  bad.sections.find((s) => s.key === "F-01")!.paragraphs = [{ id: "F-01-p1", text: "«Patient_Name»", sourceIds: [], origin: "clinician" }];
  const answerFlags = mergeFlags(fixed, bad);
  assert.equal(answerFlags.length, 1);
  assert.equal(answerFlags[0].message, "This answer contains a mail-merge field («Patient_Name»). Replace it with the real answer before approving.");
  assert.equal(answerFlags[0].severity, "blocking");

  // A page header / field code cannot be completed here: blocked whatever the mapping.
  const headerForm = await mapOf(mergeDocx({ header: "Re: «Patient Name»" }), FIXED);
  const headerFlags = mergeFlags(headerForm, reportFor(headerForm));
  assert.deepEqual(headerFlags.map((x) => x.message), [
    "This form still contains a mail-merge field: «Patient Name» in the page header. It cannot be completed here, so the form cannot be approved with it. Ask the referrer for the form without mail-merge fields (or remove them from the template) and upload it again.",
  ]);
});

test("POST /sign refuses while a merge field is left (409 SIGNOFF_BLOCKED) and approves the fixed mapping", async () => {
  const post = (handler: MedreportHandler, url: string, body: unknown) =>
    bindHandler(handler, () => deps)(
      new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${DEMO_SESSION}` }, body: JSON.stringify(body) }),
      { params: {} },
    );
  const sign = (form: FormDefinition) => post(handleSign, "/sign", { report: reportFor(form), signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form });
  const blocked = await sign(await mapOf(mergeDocx(), RULES_LIKE));
  assert.equal(blocked.status, 409);
  const problem = await blocked.json();
  assert.equal(problem.code, "SIGNOFF_BLOCKED");
  assert.ok(problem.flags.some((x: { message: string }) => /«Referral Ref» in table 1, row 2/.test(x.message)));
  const ok = await sign(await mapOf(mergeDocx(), FIXED));
  assert.equal(ok.status, 200, await ok.clone().text());
});

test("the final render refuses a completed Word file with a merge field left; a draft lists it; the fixed mapping renders clean", async () => {
  const bytes = mergeDocx();
  const file = decodeFormFile(b64(bytes));
  const intoCell = await mapOf(bytes, [...RULES_LIKE, f("F-04", "Treating therapist", cellA("t0.r2.c1"), reg("clinician.name"))]);
  const answers = buildFormAnswers(reportFor(intoCell), intoCell);
  const draft = await renderFormFile({ form: intoCell, file, answers, draft: true, format: "original" });
  assert.match(draft.warnings[0], /^The completed form still contains 3 mail-merge fields \(«Patient Name», «Referral Ref», «Therapist»\)\. The form cannot be approved until each is answered or replaced\.$/);
  const err = await renderFormFile({ form: intoCell, file, answers, draft: false, format: "original" }).catch((e) => e);
  assert.ok(err instanceof HttpError, String(err));
  assert.equal(err.status, 422);
  assert.equal(err.init.code, "FORM_INVALID");
  assert.match(String(err.init.detail), /^The completed form still contains 3 mail-merge fields \(«Patient Name», «Referral Ref», «Therapist»\)\. The final copy was not made\./);

  const fixed = await mapOf(bytes, FIXED);
  const report = reportFor(fixed);
  const final = await renderFormFile({ form: fixed, file, answers: buildFormAnswers(report, fixed, { receipt: { signer: SARAH, signedAt: AT } }), draft: false, format: "original" });
  assert.deepEqual(await mergeTokensInOutput(final.bytes, "docx"), []);
  const cells = Object.fromEntries(buildDocxOutline(final.bytes).blocks.map((b) => [b.id, b.text]));
  assert.equal(cells["t0.r0.c1"], "Megan Hart");
  assert.equal(cells["t0.r1.c1"], "LMR/2026/014");
  assert.equal(cells["t0.r2.c1"], "Sarah Reid");
  assert.equal(cells["t0.r3.c1"], "PH-DEMO-01");
});

test("bundled forms are unaffected: same flags with and without the form map, final files without merge fields", async () => {
  for (const [slug, form] of [["megan-hart", HARROW_PIKE_FORM], ["megan-hart", NORTHFIELD_FORM], ["daniel-brooks", KINGSWAY_FORM]] as const) {
    const report = completedSampleReport(slug, form);
    const template = formToTemplate(form);
    assert.deepEqual(validateReport(report, template, { form }).flags, validateReport(report, template).flags, form.id);
    const sample = SAMPLE_FORMS.find((s) => s.id === form.sampleId)!;
    const file = decodeFormFile(b64(await sample.loadFile()));
    const out = await renderFormFile({ form, file, answers: buildFormAnswers(report, form), draft: false, format: "original" });
    assert.deepEqual(await mergeTokensInOutput(out.bytes, form.kind === "docx" ? "docx" : "pdf"), [], form.id);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Reading: distinct questions on one answer space are kept and flagged
 * ----------------------------------------------------------------------------------------------*/

test("reading keeps two DISTINCT questions on one box (both flagged); the same question twice is listed once", () => {
  const bytes = mergeDocx();
  const parsed = { kind: "docx" as const, blocks: buildDocxOutline(bytes).blocks, warnings: [] };
  const raw = (label: string, anchorRef: string, rest: Partial<AnalysisFieldOutput> = {}): AnalysisFieldOutput => ({
    label,
    section: "",
    guidance: "",
    answerType: "short_text",
    options: [],
    anchorTarget: "table_cell",
    anchorRef,
    placeholderText: "",
    optionAnchors: [],
    overlay: { page: 0, x: 0, y: 0, width: 0, height: 0 },
    fillSource: "registration",
    registrationPath: "none",
    computedFact: "none",
    computedFormat: "none",
    signoffPart: "none",
    required: true,
    confidence: "high",
    note: "",
    ...rest,
  });
  // A live reading slip: the clinician's name and the HCPC number both pointed at the HCPC cell.
  const res = postValidateFields(parsed, [
    raw("Treating therapist", "t0.r3.c1", { registrationPath: "clinician.name" }),
    raw("HCPC number", "t0.r3.c1", { registrationPath: "clinician.hcpc" }),
    raw("HCPC number:", "t0.r3.c1", { registrationPath: "clinician.hcpc" }),
  ]);
  assert.deepEqual(res.fields.map((x) => [x.label, x.confidence]), [
    ["Treating therapist", "low"],
    ["HCPC number", "low"],
  ]);
  for (const x of res.fields) assert.match(x.note ?? "", /Two questions point at the same box: “Treating therapist” and “HCPC number” – check the mapping and give each its own box\./);
  assert.equal(res.dropped, 1);
  assert.deepEqual(res.warnings, [
    "Two questions point at the same box – “Treating therapist” and “HCPC number”. Both are kept: check the mapping and give each its own box.",
    "“HCPC number:” was found twice for the same answer space, so it is listed once.",
  ]);
  assert.ok(!res.warnings.some((w) => /so it was left out/.test(w)), "the old silent-drop wording is gone");
});

test("the bundled forms' readings are unchanged: rules, recorded / pre-written maps and the portal example equal main fcbe01d", async () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/medreport/fixtures/reading-baseline-fcbe01d.json"), "utf8"));
  const trim = (x: FormField) => ({ id: x.id, label: x.label, section: x.section ?? null, answerType: x.answerType, options: x.options ?? null, anchor: x.anchor, fillSource: x.fillSource, required: x.required, confidence: x.confidence, note: x.note ?? null });
  const analyse = route(handleFormsAnalyse);
  for (const s of SAMPLE_FORMS) {
    const bytes = await s.loadFile();
    const file = decodeFormFile(b64(bytes));
    const parsed = await parseFormFile(file);
    const checked = postValidateFields(parsed, proposeFieldsByRules(parsed), { confidenceCap: "low" });
    assert.deepEqual({ dropped: checked.dropped, warnings: checked.warnings, fields: checked.fields.map(trim) }, baseline[s.id].rules, `${s.id} rules`);
    const res = await analyse(
      new Request("http://127.0.0.1:9/api/reports/v1/forms/analyse", { method: "POST", headers: { "content-type": "application/json", authorization: demoBearer() }, body: JSON.stringify({ fileBase64: b64(bytes), fileName: s.fileName, prefer: "demo" }) }),
      { params: {} },
    );
    const body = await res.json();
    assert.deepEqual(
      { status: res.status, mode: body.form.analysis.mode, warnings: body.form.analysis.warnings, mergeFields: body.form.analysis.mergeFields ?? null, fields: body.form.fields.map(trim) },
      baseline[s.id].demo,
      `${s.id} demo`,
    );
  }
  assert.deepEqual({ fields: questionFields(parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS).questions).map(trim) }, baseline["portal-example"]);
});
