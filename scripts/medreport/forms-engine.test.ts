/**
 * Forms engine end to end on the bundled sample forms and the two demo cases:
 * - the sample files, manifest and pre-confirmed maps agree (SHA-256, anchors exist in the outline,
 *   placeholders and tick boxes are where the map says, PDF field names and types match);
 * - filling round-trips: every mapped answer lands in the right cell / blank / box (re-outline / re-read);
 * - the handlers: fill-preview (DRAFT), sign (receipt, 409 when blocked), render (DRAFT without a valid
 *   receipt, FINAL with one, 409 FORM_MISMATCH for another file, Word → PDF via LibreOffice), the
 *   built-in template path (docx + pdf) and template validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleFormSamples } from "../../src/modules/medreport/api/handlers/forms-samples";
import { handleFormSampleFile } from "../../src/modules/medreport/api/handlers/forms-sample-file";
import { handleFormsFillPreview } from "../../src/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { handleTemplateDocx } from "../../src/modules/medreport/api/handlers/template-docx";
import { handleTemplatesValidate } from "../../src/modules/medreport/api/handlers/templates-validate";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import { FormSamplesResponseSchema, SignResponseSchema } from "../../src/modules/medreport/api/contract";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, buildFormAnswers, checkFormDefinition, formToTemplate } from "../../src/modules/medreport/core/forms";
import { createFormReport, createReport } from "../../src/modules/medreport/core/report-factory";
import { FormDefinitionSchema, ReportSchema } from "../../src/modules/medreport/core/schemas";
import type { Clinician, FormDefinition, Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { docxToPdf, pdfConversionAvailable } from "../../src/modules/medreport/forms/convert";
import { buildDocxOutline } from "../../src/modules/medreport/forms/docx-outline";
import { fillDocx } from "../../src/modules/medreport/forms/docx-fill";
import { sha256Hex } from "../../src/modules/medreport/forms/file";
import { fillPdf } from "../../src/modules/medreport/forms/pdf-fill";
import { readPdfForm } from "../../src/modules/medreport/forms/pdf-outline";
import { SAMPLE_FORM_FILES } from "../../src/modules/medreport/forms/samples/generated/manifest";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { KINGSWAY_FORM as KINGSWAY_RAW } from "../../src/modules/medreport/forms/samples/maps/kingsway";
import { NORTHFIELD_FORM as NORTHFIELD_RAW } from "../../src/modules/medreport/forms/samples/maps/northfield";
import { createFileToken, formMapSha256, sha256HexOf, verifyFormConfirmation, withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { SAMPLE_FORMS, getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { CLINIC_STYLE_BROKEN_SAMPLE_ID, getSampleTemplateUpload } from "../../src/modules/medreport/templates/extensions";
import { SOLICITOR_TEMPLATE_ID, getTemplate } from "../../src/modules/medreport/templates/registry";
import { getDemoBundle } from "./dev-bundles";
import { SAMPLE_NOW, completedSampleReport, instructingPartyFor } from "./form-sample-answers";

// The bundled maps as GET /forms/samples serves them: confirmed AND attested by the server.
const attest = (f: FormDefinition): FormDefinition => withAttestedConfirmation(f, f.confirmed?.by ?? "Practice manager", f.confirmed?.at ?? "2026-10-01T09:00:00.000Z");
const HARROW_PIKE_FORM = attest(HARROW_PIKE_RAW);
const NORTHFIELD_FORM = attest(NORTHFIELD_RAW);
const KINGSWAY_FORM = attest(KINGSWAY_RAW);
const MAPS = [HARROW_PIKE_FORM, NORTHFIELD_FORM, KINGSWAY_FORM];
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const TOM: Clinician = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" };
const deps = {} as MedreportDeps;

async function fileOf(form: FormDefinition): Promise<Uint8Array> {
  return getSampleForm(form.sampleId ?? "")!.loadFile();
}

const DEMO_SESSION = createSessionToken({ tenantId: "demo", kind: "demo" }).token;

async function post(handler: MedreportHandler, url: string, body: unknown, token: string | null = DEMO_SESSION): Promise<Response> {
  // Through bindHandler, as the routes do: thrown HttpErrors become problem responses.
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return bindHandler(handler, () => deps)(
    new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: JSON.stringify(body) }),
    { params: {} },
  );
}

async function signed(report: Report, form: FormDefinition, signer: Clinician): Promise<{ report: Report; receipt: SignReceipt }> {
  const res = await post(handleSign, "/sign", { report, signer, typedSignature: signer.name, statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form });
  assert.equal(res.status, 200, await res.clone().text());
  const { receipt } = SignResponseSchema.parse(await res.json());
  return { report: { ...report, status: "signed", receipt }, receipt };
}

const cellTexts = (bytes: Uint8Array) => Object.fromEntries(buildDocxOutline(bytes).blocks.map((b) => [b.id, b.text]));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/* ------------------------------------------------------------------------------------------------
 * Samples, manifest and maps
 * ----------------------------------------------------------------------------------------------*/

test("sample files match the manifest; GET /forms/samples offers 5 forms, 3 with confirmed maps", async () => {
  for (const entry of SAMPLE_FORMS) {
    const bytes = await entry.loadFile();
    const facts = SAMPLE_FORM_FILES[entry.id as keyof typeof SAMPLE_FORM_FILES];
    assert.equal(sha256Hex(bytes), facts.sha256, entry.id);
    assert.equal(bytes.byteLength, facts.sizeBytes, entry.id);
    assert.match(entry.referrer.name, /\(fictional\)$/);
  }
  const res = await handleFormSamples(new Request("http://localhost/api/reports/v1/forms/samples"), { params: {} }, deps);
  const { samples } = FormSamplesResponseSchema.parse(await res.json());
  assert.deepEqual(samples.map((s) => s.id), ["harrow-pike-treating-physio", "northfield-rehab-progress", "kingsway-rtw-assessment", "ashcroft-update-report", "meridian-discharge-report"]);
  assert.deepEqual(samples.map((s) => Boolean(s.form)), [true, true, true, false, false]);
  assert.deepEqual(samples.map((s) => s.kind), ["docx", "pdf_acroform", "docx", "pdf_flat", "docx"]);
  // Served maps carry the server's attestation of exactly that map.
  for (const s of samples) if (s.form) assert.equal(verifyFormConfirmation(s.form).ok, true, s.id);
  const file = await handleFormSampleFile(new Request("http://localhost/x"), { params: { id: "northfield-rehab-progress" } }, deps);
  assert.equal(file.headers.get("content-type"), "application/pdf");
  assert.equal((await handleFormSampleFile(new Request("http://localhost/x"), { params: { id: "nope" } }, deps)).status, 404);
});

test("pre-confirmed maps are valid and every anchor exists on its exact file", async () => {
  for (const form of MAPS) {
    FormDefinitionSchema.parse(form);
    assert.deepEqual(checkFormDefinition(form), [], form.id);
    assert.equal(form.status, "confirmed");
    const bytes = await fileOf(form);
    assert.equal(form.file.sha256, sha256Hex(bytes));
    if (form.kind === "docx") {
      const blocks = new Map(buildDocxOutline(bytes).blocks.map((b) => [b.id, b]));
      for (const f of form.fields) {
        assert.equal(f.anchor.kind, "docx");
        if (f.anchor.kind !== "docx") continue;
        const block = blocks.get(f.anchor.blockId);
        assert.ok(block, `${form.id} ${f.id}: block ${f.anchor.blockId} exists`);
        if (f.anchor.target === "replace_placeholder") assert.ok(block.text.includes(f.anchor.placeholderText ?? "\u0000"), `${f.id}: placeholder in ${f.anchor.blockId}`);
        if (f.anchor.target === "table_cell") assert.ok(block.isEmpty, `${f.id}: answer cell ${f.anchor.blockId} is empty`);
        for (const g of f.anchor.optionGlyphs ?? []) {
          const gb = blocks.get(g.blockId);
          assert.ok(gb && (gb.checkboxGlyphs ?? 0) > g.glyphIndex, `${f.id}: tick box ${g.option}`);
          assert.ok(gb.text.includes(g.option.split(",")[0]), `${f.id}: option text “${g.option}” printed`);
        }
      }
    } else {
      const outline = await readPdfForm(bytes);
      const byName = new Map(outline.fields.map((x) => [x.name, x]));
      for (const f of form.fields) {
        assert.equal(f.anchor.kind, "pdf_field");
        if (f.anchor.kind !== "pdf_field") continue;
        assert.equal(byName.get(f.anchor.fieldName)?.type, f.anchor.fieldType, `${f.id}: ${f.anchor.fieldName}`);
      }
      assert.equal(outline.fields.length, form.fields.length, "every PDF field is mapped (answered or left blank)");
    }
  }
});

test("outline IDs are stable across runs for every sample Word form", async () => {
  for (const entry of SAMPLE_FORMS.filter((s) => s.kind === "docx")) {
    const bytes = await entry.loadFile();
    assert.deepEqual(buildDocxOutline(bytes), buildDocxOutline(new Uint8Array(bytes)), entry.id);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Round trips
 * ----------------------------------------------------------------------------------------------*/

test("Harrow & Pike (Word, tables) – Megan Hart: every answer in its cell, B4 blanks, B6 tick, sign-off", async () => {
  const report = completedSampleReport("megan-hart", HARROW_PIKE_FORM);
  const receipt = { signer: SARAH, signedAt: "2026-10-07T11:00:00.000Z" };
  const answers = buildFormAnswers(report, HARROW_PIKE_FORM, { receipt });
  const warnings: string[] = [];
  const out = fillDocx(await fileOf(HARROW_PIKE_FORM), HARROW_PIKE_FORM, answers, { draft: false, onWarning: (m) => warnings.push(m) });
  assert.deepEqual(warnings, []);
  const t = cellTexts(out);
  assert.equal(t["t1.r0.c1"], "Megan Hart");
  assert.equal(t["t1.r1.c1"], "22/11/1991");
  assert.equal(t["t1.r2.c1"], "HP/RTA/2291");
  assert.equal(t["t1.r3.c1"], "12/03/2026");
  assert.equal(t["t1.r4.c1"], "18/03/2026");
  assert.equal(t["t1.r5.c1"], "07/07/2026");
  assert.match(t["t2.r1.c1"], /^Ms Hart reported that on 12\/03\/2026/);
  assert.match(t["t2.r2.c1"], /disturbed sleep\.\nSarah Reid, physiotherapist, recorded/);
  assert.equal(t["t2.r4.c1"], "Attended: 10        Failed to attend: 1");
  assert.equal(t["t2.r6.c1"], "☒ Yes            ☐ No");
  assert.match(t["t2.r7.c1"], /^In my opinion Ms Hart has made a good recovery/);
  assert.match(t["t2.r9.c1"], /discharged Ms Hart from active physiotherapy/);
  assert.equal(t["t3.r0.c1"], "Sarah Reid");
  assert.equal(t["t3.r1.c1"], "PH-DEMO-01");
  assert.equal(t["t3.r2.c1"], "Sarah Reid – approved electronically on 07/10/2026");
  assert.equal(t["t3.r3.c1"], "07/10/2026");
  assert.equal(t["t4.r1.c1"], "", "office-use boxes stay blank");
  assert.equal(t["t4.r1.c3"], "");
  // The questions themselves are untouched.
  assert.equal(t["t2.r7.c0"], cellTexts(await fileOf(HARROW_PIKE_FORM))["t2.r7.c0"]);
});

test("Kingsway (Word, headings and blanks) – Daniel Brooks: inline blanks, answer lines, tick boxes", async () => {
  const report = completedSampleReport("daniel-brooks", KINGSWAY_FORM);
  const answers = buildFormAnswers(report, KINGSWAY_FORM, { receipt: { signer: TOM, signedAt: "2026-10-07T11:00:00.000Z" } });
  const warnings: string[] = [];
  const out = fillDocx(await fileOf(KINGSWAY_FORM), KINGSWAY_FORM, answers, { draft: false, onWarning: (m) => warnings.push(m) });
  assert.deepEqual(warnings, []);
  const blocks = buildDocxOutline(out).blocks;
  const texts = blocks.map((b) => b.text);
  const find = (re: RegExp) => texts.find((x) => re.test(x)) ?? "";
  assert.match(find(/^Employer \/ client reference/), /^Employer \/ client reference: AF-OH-0457 {6}Kingsway case no\.: \.{26}$/);
  assert.equal(find(/^Employee name/), "Employee name: Daniel Brooks     Date of birth: 19/01/1980");
  assert.equal(find(/^Job title/), "Job title: Warehouse operative     Employer: Ashby Freight Ltd (fictional)");
  assert.equal(find(/^Date of injury/), "Date of injury / onset: 02/06/2026     Date first seen: 09/06/2026     Date last seen: 22/09/2026");
  assert.match(find(/^Answer: Mr Brooks reported/), /lifted a carton of approximately 20 kg/);
  assert.equal(find(/^☐ Yes|^☒ Yes/), "☒ Yes              ☐ No");
  assert.equal(find(/adjustments below/), "☐ Yes, with the adjustments below        ☐ No        ☒ Not applicable");
  assert.equal(find(/^Therapist name/), "Therapist name: Tom Ellis     HCPC no.: PH-DEMO-02");
  assert.equal(find(/^Signature/), "Signature: Tom Ellis – approved electronically on 07/10/2026     Date: 07/10/2026");
  // Q3: the answer follows the instruction paragraph; Q6 uses the blank lines under its instruction.
  const q3 = texts.findIndex((x) => x.startsWith("Please comment on lifting"));
  assert.match(texts[q3 + 1], /^At the final review on 22\/09\/2026/);
  assert.match(texts[q3 + 2], /No formal functional capacity or lifting assessment is documented/);
  const q6 = texts.findIndex((x) => x.startsWith("For example: lifting limits"));
  assert.match(texts[q6 + 1], /avoid repetitive lifting over 15 kg for 4 weeks/);
  // Dotted continuation lines used by answers are gone; past history never appears.
  assert.ok(!texts.some((x) => /^\.{20,}$/.test(x)), "no dotted lines left under answered questions");
  assert.ok(!texts.join("\n").match(/arthroscopy|asthma/i));
});

test("Northfield (fillable PDF) – both cases: fields, radio and tick box set; FINAL flattened", async () => {
  for (const [slug, signer, fit] of [
    ["megan-hart", SARAH, "Yes"],
    ["daniel-brooks", TOM, "Modified duties"],
  ] as const) {
    const report = completedSampleReport(slug, NORTHFIELD_FORM);
    const receipt = { signer, signedAt: "2026-10-07T11:00:00.000Z" };
    const answers = buildFormAnswers(report, NORTHFIELD_FORM, { receipt });
    const draft = await fillPdf(await fileOf(NORTHFIELD_FORM), NORTHFIELD_FORM, buildFormAnswers(report, NORTHFIELD_FORM), { draft: true, flatten: false });
    const f = (await PDFDocument.load(draft)).getForm();
    assert.equal(f.getTextField("txtClaimant").getText(), report.bundleSnapshot.registration.fullName);
    assert.equal(f.getTextField("txtPolicyNo").getText(), "NA-PI-77310");
    assert.equal(f.getRadioGroup("rdoFitForWork").getSelected(), fit);
    assert.equal(f.getCheckBox("chkDischarged").isChecked(), true);
    assert.equal(f.getTextField("txtTherapistName").getText() ?? "", "", "sign-off blank on a DRAFT");
    assert.equal(f.getTextField("txtOfficeHandler").getText() ?? "", "", "insurer-use boxes stay blank");
    const final = await fillPdf(await fileOf(NORTHFIELD_FORM), NORTHFIELD_FORM, answers, { draft: false, flatten: true });
    const doc = await PDFDocument.load(final);
    assert.equal(doc.getForm().getFields().length, 0, "flattened");
    assert.equal(doc.getPageCount(), 2);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Handlers
 * ----------------------------------------------------------------------------------------------*/

test("POST /forms/fill-preview: DRAFT copy of the original file with warnings and kind headers", async () => {
  const report = completedSampleReport("megan-hart", HARROW_PIKE_FORM);
  const fileBase64 = b64(await fileOf(HARROW_PIKE_FORM));
  const res = await post(handleFormsFillPreview, "/forms/fill-preview", { report, form: HARROW_PIKE_FORM, fileBase64, mode: "draft" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("x-medreport-render"), "draft");
  assert.equal(res.headers.get("x-medreport-form-kind"), "docx");
  assert.match(res.headers.get("content-disposition") ?? "", /Hart_M_Treating-Physiotherapist-Report_\d{4}-\d{2}-\d{2}_DRAFT_PREVIEW\.docx/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const t = cellTexts(bytes);
  assert.equal(t["t3.r0.c1"], "", "no sign-off on a preview");
  assert.equal(t["t1.r0.c1"], "Megan Hart");

  const other = await post(handleFormsFillPreview, "/forms/fill-preview", { report, form: HARROW_PIKE_FORM, fileBase64: b64(await fileOf(KINGSWAY_FORM)), mode: "draft" });
  assert.equal(other.status, 409);
  assert.equal((await other.json()).code, "FORM_MISMATCH");
});

test("POST /sign + /render: blocked until complete; DRAFT without a valid receipt, FINAL with one", async () => {
  // A freshly started form report still has open questions → sign is blocked.
  const bundle = getDemoBundle("megan-hart");
  const fresh = createFormReport({
    form: HARROW_PIKE_FORM,
    bundle,
    instructingParty: instructingPartyFor("megan-hart", HARROW_PIKE_FORM),
    computedFacts: computeFacts(bundle, { asOf: "2026-10-07" }),
    now: SAMPLE_NOW,
  });
  const blocked = await post(handleSign, "/sign", { report: fresh, signer: SARAH, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: HARROW_PIKE_FORM });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "SIGNOFF_BLOCKED");
  const badName = await post(handleSign, "/sign", { report: fresh, signer: SARAH, typedSignature: "S Reid", statementAccepted: true, attestations: [], form: HARROW_PIKE_FORM });
  assert.equal(badName.status, 422);

  const report = completedSampleReport("megan-hart", HARROW_PIKE_FORM);
  assert.ok(validateReport(report, formToTemplate(HARROW_PIKE_FORM)).canSign);
  const { report: signedReport, receipt } = await signed(report, HARROW_PIKE_FORM, SARAH);
  ReportSchema.parse(signedReport);
  const fileBase64 = b64(await fileOf(HARROW_PIKE_FORM));

  const draft = await post(handleRender, "/render?format=original", { report: signedReport, form: HARROW_PIKE_FORM, fileBase64 });
  assert.equal(draft.headers.get("x-medreport-render"), "draft", "no receipt sent → DRAFT");
  const final = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: HARROW_PIKE_FORM, fileBase64, requireFinal: true });
  assert.equal(final.status, 200, await final.clone().text());
  assert.equal(final.headers.get("x-medreport-render"), "final");
  assert.equal(final.headers.get("x-medreport-content-sha256"), receipt.contentSha256);
  assert.match(final.headers.get("content-disposition") ?? "", /_SIGNED\.docx/);
  const ft = cellTexts(new Uint8Array(await final.arrayBuffer()));
  assert.equal(ft["t3.r0.c1"], "Sarah Reid");

  // Edited after approval → the receipt no longer matches.
  const tampered = structuredClone(signedReport);
  tampered.sections.find((s) => s.key === "F-14")!.paragraphs[0].text += " Edited.";
  const stale = await post(handleRender, "/render?format=original", { report: tampered, receipt, form: HARROW_PIKE_FORM, fileBase64 });
  assert.equal(stale.headers.get("x-medreport-render"), "draft");
  const staleFinal = await post(handleRender, "/render?format=original", { report: tampered, receipt, form: HARROW_PIKE_FORM, fileBase64, requireFinal: true });
  assert.equal(staleFinal.status, 409);
  assert.equal((await staleFinal.json()).code, "RECEIPT_INVALID");

  const wrongFile = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: HARROW_PIKE_FORM, fileBase64: b64(await fileOf(KINGSWAY_FORM)) });
  assert.equal(wrongFile.status, 409);
  assert.equal((await wrongFile.json()).code, "FORM_MISMATCH");

  const noFile = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: HARROW_PIKE_FORM });
  assert.equal(noFile.status, 422);

  // The FINAL carries the server's token for exactly these bytes and this episode (write-back needs it).
  const token = final.headers.get("x-medreport-file-token");
  assert.ok(token);
  const finalAgain = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: HARROW_PIKE_FORM, fileBase64, requireFinal: true });
  const bytesAgain = new Uint8Array(await finalAgain.arrayBuffer());
  assert.equal(
    finalAgain.headers.get("x-medreport-file-token"),
    createFileToken({ receiptMac: receipt.mac, sha256: sha256HexOf(bytesAgain), tenantId: "demo", connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001" }),
  );
  assert.equal(draft.headers.get("x-medreport-file-token"), null, "a DRAFT never carries a file token");
});

test("the FINAL layout is bound to the approved map: swapped options or moved answers are refused", async () => {
  const report = completedSampleReport("megan-hart", HARROW_PIKE_FORM);
  assert.equal(report.form?.mapSha256, formMapSha256(HARROW_PIKE_FORM), "the report records the map it was started from");
  const { report: signedReport, receipt } = await signed(report, HARROW_PIKE_FORM, SARAH);
  assert.equal(receipt.formMapSha256, formMapSha256(HARROW_PIKE_FORM));
  assert.equal(receipt.approvedVia?.kind, "demo");
  const fileBase64 = b64(await fileOf(HARROW_PIKE_FORM));

  // Swap the Yes/No tick boxes of a question after approval (keeping the old attestation).
  const yesNo = HARROW_PIKE_FORM.fields.find((f) => f.anchor.kind === "docx" && (f.anchor.optionGlyphs?.length ?? 0) >= 2)!;
  const swapped: FormDefinition = {
    ...HARROW_PIKE_FORM,
    fields: HARROW_PIKE_FORM.fields.map((f) => {
      if (f.id !== yesNo.id || f.anchor.kind !== "docx") return f;
      const g = f.anchor.optionGlyphs!;
      return { ...f, anchor: { ...f.anchor, optionGlyphs: [{ ...g[0], option: g[1].option }, { ...g[1], option: g[0].option }, ...g.slice(2)] } };
    }),
  };
  assert.equal(verifyFormConfirmation(swapped).ok, false);
  const res = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: swapped, fileBase64, requireFinal: true });
  assert.equal(res.status, 409);
  assert.match((await res.json()).code, /FORM_MISMATCH|FORM_NOT_CONFIRMED/);

  // Even a freshly attested different map is refused for this report and its receipt.
  const reAttested = attest(swapped);
  const res2 = await post(handleRender, "/render?format=original", { report: signedReport, receipt, form: reAttested, fileBase64, requireFinal: true });
  assert.equal(res2.status, 409);
  assert.equal((await res2.json()).code, "FORM_MISMATCH");

  // /sign without a session is refused; a launch session only signs for its own clinician and patient.
  const noSession = await post(handleSign, "/sign", { report, signer: SARAH, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: HARROW_PIKE_FORM }, null);
  assert.equal(noSession.status, 401);
  const tomsLaunch = createSessionToken({ tenantId: "demo", kind: "launch", connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: TOM }).token;
  const asSarah = await post(handleSign, "/sign", { report, signer: SARAH, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: HARROW_PIKE_FORM }, tomsLaunch);
  assert.equal(asSarah.status, 403);
  assert.equal((await asSarah.json()).code, "SIGNER_MISMATCH");
  const otherPatient = createSessionToken({ tenantId: "demo", kind: "launch", connectorId: "tm3-sim", patientId: "sim-pat-002", episodeId: "sim-ep-1002", clinician: SARAH }).token;
  const wrongPatient = await post(handleSign, "/sign", { report, signer: SARAH, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: HARROW_PIKE_FORM }, otherPatient);
  assert.equal(wrongPatient.status, 403);
  const sarahsLaunch = createSessionToken({ tenantId: "demo", kind: "launch", connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: SARAH }).token;
  const ok = await post(handleSign, "/sign", { report, signer: SARAH, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: HARROW_PIKE_FORM }, sarahsLaunch);
  assert.equal(ok.status, 200);
  assert.deepEqual(SignResponseSchema.parse(await ok.json()).receipt.approvedVia?.clinician, SARAH);
});

test("POST /render for the Northfield PDF: FINAL flattened PDF with the sign-off", async () => {
  const report = completedSampleReport("daniel-brooks", NORTHFIELD_FORM);
  const { report: signedReport, receipt } = await signed(report, NORTHFIELD_FORM, TOM);
  const res = await post(handleRender, "/render?format=pdf", { report: signedReport, receipt, form: NORTHFIELD_FORM, fileBase64: b64(await fileOf(NORTHFIELD_FORM)), requireFinal: true });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("x-medreport-form-kind"), "pdf_acroform");
  const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  assert.equal(doc.getForm().getFields().length, 0);
  const docx = await post(handleRender, "/render?format=docx", { report: signedReport, receipt, form: NORTHFIELD_FORM, fileBase64: b64(await fileOf(NORTHFIELD_FORM)) });
  assert.equal(docx.status, 422, "a PDF form cannot be returned as Word");
});

test("Word → PDF copy of a completed form (LibreOffice)", { skip: !pdfConversionAvailable() && "LibreOffice not installed" }, async () => {
  const report = completedSampleReport("daniel-brooks", KINGSWAY_FORM);
  const { report: signedReport, receipt } = await signed(report, KINGSWAY_FORM, TOM);
  const res = await post(handleRender, "/render?format=pdf", { report: signedReport, receipt, form: KINGSWAY_FORM, fileBase64: b64(await fileOf(KINGSWAY_FORM)), requireFinal: true });
  assert.equal(res.status, 200, await res.clone().text());
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  assert.equal(res.headers.get("x-medreport-render"), "final");
  // The filled Word files of the other samples convert too (they open in LibreOffice).
  const harrow = fillDocx(await fileOf(HARROW_PIKE_FORM), HARROW_PIKE_FORM, buildFormAnswers(completedSampleReport("megan-hart", HARROW_PIKE_FORM), HARROW_PIKE_FORM), { draft: true, reviewMarkers: true });
  const pdf = await docxToPdf(harrow);
  assert.ok(pdf && Buffer.from(pdf.subarray(0, 5)).toString("latin1") === "%PDF-");
});

test("built-in template path still renders (docx + pdf) and the template tools work", async () => {
  const bundle = getDemoBundle("megan-hart");
  const template = getTemplate(SOLICITOR_TEMPLATE_ID)!;
  const r = bundle.referral;
  const report = createReport({
    template,
    bundle,
    instructingParty: { type: r.type, name: r.name, reference: r.reference, contactName: r.contactName, address: r.address },
    computedFacts: computeFacts(bundle, { asOf: "2026-10-07" }),
    now: SAMPLE_NOW,
  });
  const docx = await post(handleRender, "/render?format=docx", { report });
  assert.equal(docx.status, 200, await docx.clone().text());
  assert.equal(docx.headers.get("x-medreport-render"), "draft");
  const pdf = await post(handleRender, "/render?format=pdf", { report });
  assert.equal(pdf.status, 200, await pdf.clone().text());
  assert.equal(Buffer.from(new Uint8Array(await pdf.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
  const original = await post(handleRender, "/render?format=original", { report });
  assert.equal(original.status, 422);

  const dl = await handleTemplateDocx(new Request("http://localhost/x"), { params: { id: SOLICITOR_TEMPLATE_ID } }, deps);
  assert.equal(dl.status, 200);
  const broken = getSampleTemplateUpload(CLINIC_STYLE_BROKEN_SAMPLE_ID)!;
  const brokenRes = await handleTemplateDocx(new Request("http://localhost/x"), { params: { id: broken.id } }, deps);
  const validation = await (await post(handleTemplatesValidate, "/templates/validate", { fileName: broken.fileName, docxBase64: b64(new Uint8Array(await brokenRes.arrayBuffer())) })).json();
  assert.equal(validation.ok, false);
  assert.equal(validation.errors[0].message, broken.expectedProblem);
  const good = await handleTemplateDocx(new Request("http://localhost/x"), { params: { id: "clinic-style-sample" } }, deps);
  const goodValidation = await (await post(handleTemplatesValidate, "/templates/validate", { fileName: "x.docx", docxBase64: b64(new Uint8Array(await good.arrayBuffer())) })).json();
  assert.equal(goodValidation.ok, true, JSON.stringify(goodValidation.errors));
});

test("Meridian (Word, boxes + content controls): an analysed map fills controls, boxes and tick-box controls", async () => {
  const sample = getSampleForm("meridian-discharge-report")!;
  const bytes = await sample.loadFile();
  const anchor = (target: "content_control" | "table_cell", blockId: string, placeholderText?: string) =>
    ({ kind: "docx", target, blockId, ...(placeholderText && { placeholderText }) }) as const;
  const field = (id: string, label: string, a: FormDefinition["fields"][number]["anchor"], extra: Partial<FormDefinition["fields"][number]> = {}) => ({
    id,
    label,
    guidance: "",
    answerType: "short_text" as const,
    anchor: a,
    fillSource: { kind: "notes_narrative" as const },
    required: true,
    confidence: "medium" as const,
    ...extra,
  });
  const form: FormDefinition = {
    ...HARROW_PIKE_FORM,
    id: "frm_meridian_test",
    sampleId: "meridian-discharge-report",
    title: "Physiotherapy Discharge Report",
    referrer: { name: "Meridian Claims Services (fictional)", type: "insurer" },
    file: { ...HARROW_PIKE_FORM.file, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, fileName: sample.fileName },
    fields: [
      field("F-01", "Claimant's full name", anchor("content_control", "t0.r1.c1")),
      field("F-02", "Final diagnosis", anchor("table_cell", "t1.r1.c0"), { answerType: "long_text" }),
      field("F-03", "Sessions attended", anchor("content_control", "t2.r3.c0", "sessions_attended"), { answerType: "number" }),
      field("F-04", "Sessions missed", anchor("content_control", "t2.r3.c0", "sessions_missed"), { answerType: "number" }),
      field(
        "F-05",
        "Reason for discharge",
        {
          kind: "docx",
          target: "checkbox_glyph",
          blockId: "t3.r1.c0.p1",
          optionGlyphs: ["Goals achieved", "Plateaued", "Self-discharged", "Did not attend"].map((option, glyphIndex) => ({ option, blockId: "t3.r1.c0.p1", glyphIndex })),
        },
        { answerType: "single_choice", options: ["Goals achieved", "Plateaued", "Self-discharged", "Did not attend"] },
      ),
      field("F-06", "Therapist name", anchor("content_control", "t4.r2.c1"), { fillSource: { kind: "signoff", part: "name" }, answerType: "clinician_name" }),
    ],
  };
  const warnings: string[] = [];
  const out = fillDocx(
    bytes,
    form,
    { "F-01": { text: "Megan Hart" }, "F-02": { text: "Whiplash-associated disorder grade II." }, "F-03": { text: "10", value: "10" }, "F-04": { text: "1", value: "1" }, "F-05": { text: "Goals achieved", value: "Goals achieved" }, "F-06": {} },
    { draft: true, onWarning: (m) => warnings.push(m) },
  );
  assert.deepEqual(warnings, []);
  const t = cellTexts(out);
  assert.equal(t["t0.r1.c1"], "Megan Hart");
  assert.equal(t["t1.r1.c0"], "What was your final diagnosis? Please include the mechanism of injury as reported to you.\nWhiplash-associated disorder grade II.");
  assert.equal(t["t2.r3.c0"], "Sessions attended:  10        Sessions missed:  1");
  assert.match(t["t3.r1.c0"], /☒ Goals achieved {5}☐ Plateaued/);
  assert.equal(t["t4.r2.c1"], "Click or tap here to enter text.", "sign-off control untouched on a DRAFT");
});

test("built-in path: a clinic's own tagged template renders; a broken one is refused in plain English", async () => {
  const bundle = getDemoBundle("daniel-brooks");
  const template = getTemplate("employer-fitness-for-work")!;
  const r = bundle.referral;
  const report = createReport({
    template,
    bundle,
    instructingParty: { type: r.type, name: r.name, reference: r.reference, contactName: r.contactName, address: r.address },
    computedFacts: computeFacts(bundle, { asOf: "2026-10-07" }),
    now: SAMPLE_NOW,
  });
  const good = await handleTemplateDocx(new Request("http://localhost/x"), { params: { id: "clinic-style-sample" } }, deps);
  const res = await post(handleRender, "/render?format=docx", { report, templateDocxBase64: b64(new Uint8Array(await good.arrayBuffer())) });
  assert.equal(res.status, 200, await res.clone().text());
  const broken = await handleTemplateDocx(new Request("http://localhost/x"), { params: { id: CLINIC_STYLE_BROKEN_SAMPLE_ID } }, deps);
  const bad = await post(handleRender, "/render?format=docx", { report, templateDocxBase64: b64(new Uint8Array(await broken.arrayBuffer())) });
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).code, "TEMPLATE_INVALID");
});
