/**
 * Portal question sets (FormKind "questions", no file) through the Report API, demo mode:
 * - POST /forms/confirm attests a question set and recomputes its placeholder file (SHA-256 of the
 *   canonical question list); editing a question afterwards invalidates the attestation;
 * - completing it for a patient: code-filled answers, draft groups, the drafting request the Studio
 *   sends (schema, /drafts in demo mode, /ai/payload-preview with the questions and no identifiers);
 * - POST /render and /forms/fill-preview give the PDF summary instead of filling a file (docx → 422);
 * - POST /sign needs the question set's own attestations; the FINAL summary carries the file token;
 * - "Copy answers" text of the approved report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import { getDemoBundle } from "./dev-bundles";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleAiPayloadPreview } from "../../src/modules/medreport/api/handlers/ai-payload-preview";
import { handleDrafts } from "../../src/modules/medreport/api/handlers/drafts";
import { handleFormsConfirm } from "../../src/modules/medreport/api/handlers/forms-confirm";
import { handleFormsFillPreview } from "../../src/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import {
  AiPayloadPreviewResponseSchema,
  DraftsRequestSchema,
  FormsConfirmResponseSchema,
  HEADERS,
  ProblemSchema,
  SignResponseSchema,
} from "../../src/modules/medreport/api/contract";
import { formMapSha256, verifyFormConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { buildAnswersCopy, copyFormOf } from "../../src/modules/medreport/core/answer-copy";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, QUESTION_SET_ATTESTATIONS, formTemplateId, formToTemplate } from "../../src/modules/medreport/core/forms";
import {
  EXAMPLE_PORTAL_QUESTIONS,
  createQuestionSet,
  parsePortalQuestions,
  questionSetSha256,
} from "../../src/modules/medreport/core/question-set";
import { createFormReport, planDraftGroups } from "../../src/modules/medreport/core/report-factory";
import type { Clinician, FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { loadPdfjs, pdfjsDocumentParams } from "../../src/modules/medreport/forms/pdfjs";

const deps = {} as MedreportDeps;
const SESSION = createSessionToken({ tenantId: "demo", kind: "demo" }).token;
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const REFERRER = { name: "Northbridge Health Insurance (fictional)", type: "insurer" as const };
const NOW = new Date("2026-10-09T10:00:00.000Z");

async function post(handler: MedreportHandler, url: string, body: unknown, token: string | null = SESSION): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return bindHandler(handler, () => deps)(new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: JSON.stringify(body) }), {
    params: {},
  });
}

async function pdfText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(String.fromCharCode(...Array.from(bytes.slice(0, 4))), "%PDF");
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  await task.destroy();
  return pages.join("\n").replace(/\s+/g, " ");
}

async function proposed(text = EXAMPLE_PORTAL_QUESTIONS): Promise<FormDefinition> {
  const parsed = parsePortalQuestions(text);
  assert.deepEqual(parsed.errors, []);
  return createQuestionSet({ referrer: REFERRER, questions: parsed.questions, now: NOW, id: "form-portal-test" });
}

async function confirmed(text?: string): Promise<FormDefinition> {
  const form = await proposed(text);
  const res = await post(handleFormsConfirm, "/forms/confirm", { form, confirmedBy: "Practice manager" });
  assert.equal(res.status, 200, await res.clone().text());
  return FormsConfirmResponseSchema.parse(await res.json()).form;
}

test("POST /forms/confirm attests a question set and recomputes its placeholder file", async () => {
  const form = await proposed();
  // A stale or tampered placeholder is replaced with the canonical question-list SHA-256.
  const stale = { ...form, file: { ...form.file, sha256: "0".repeat(64), sizeBytes: 1 } };
  const res = await post(handleFormsConfirm, "/forms/confirm", { form: stale, confirmedBy: "Practice manager" });
  assert.equal(res.status, 200, await res.clone().text());
  const out = FormsConfirmResponseSchema.parse(await res.json()).form;
  assert.equal(out.status, "confirmed");
  assert.equal(out.kind, "questions");
  assert.equal(out.file.sha256, await questionSetSha256(out.fields));
  assert.deepEqual(out.file, form.file);
  assert.equal(out.confirmed?.by, "Practice manager");
  assert.equal(out.confirmed?.mapSha256, formMapSha256(out));
  assert.deepEqual(verifyFormConfirmation(out), { ok: true, mapSha256: formMapSha256(out) });

  // Editing a question after confirmation invalidates it.
  const edited = { ...out, fields: out.fields.map((f, i) => (i === 0 ? { ...f, label: "Member's full name" } : f)) };
  assert.deepEqual(verifyFormConfirmation(edited), { ok: false, reason: "MAP_CHANGED" });

  // Confirming needs a session, and a question cannot point into a file.
  assert.equal((await post(handleFormsConfirm, "/forms/confirm", { form, confirmedBy: "Practice manager" }, null)).status, 401);
  const broken = { ...form, fields: form.fields.map((f, i) => (i === 0 ? { ...f, anchor: { kind: "pdf_field" as const, fieldName: "Text1", fieldType: "text" as const } } : f)) };
  const bad = await post(handleFormsConfirm, "/forms/confirm", { form: broken, confirmedBy: "Practice manager" });
  assert.equal(bad.status, 422);
  const problem = ProblemSchema.parse(await bad.json());
  assert.equal(problem.code, "VALIDATION_FAILED");
  assert.match(problem.detail ?? "", /cannot point into a file/);
});

test("completing a question set for a patient: code-filled answers, draft groups and the drafting request", async () => {
  const form = await confirmed();
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: NOW });
  assert.equal(report.templateId, formTemplateId(form.id));
  assert.deepEqual(report.form, { formId: form.id, title: form.title, referrer: form.referrer, fileSha256: form.file.sha256, kind: "questions", mapSha256: form.confirmed?.mapSha256 });

  const byLabel = (label: string) => report.sections.find((s) => s.title === label);
  assert.equal(byLabel("Patient's full name")?.paragraphs[0].text, "Megan Hart");
  assert.deepEqual(byLabel("Date of birth")?.answer, { kind: "date", value: "1991-11-22" });
  assert.deepEqual(byLabel("Number of sessions attended to date")?.answer, { kind: "number", value: "10" });
  assert.equal(byLabel("Date of initial assessment")?.answer?.kind, "date");

  // Only questions answered from the notes or by the clinician are drafted, in groups of up to 4.
  const template = formToTemplate(form);
  const groups = planDraftGroups(report, template);
  const drafted = groups.flat();
  const draftable = form.fields.filter((f) => f.fillSource.kind === "notes_narrative" || f.fillSource.kind === "clinician_opinion").map((f) => f.id);
  assert.deepEqual(drafted.slice().sort(), draftable.slice().sort());
  assert.ok(groups.every((g) => g.length >= 1 && g.length <= 4));

  // The request the Studio sends (review "Draft them now" and the new-report flow build the same shape).
  const request = {
    templateId: report.templateId,
    bundle: report.bundleSnapshot,
    instructingParty: report.instructingParty,
    sectionKeys: groups[0],
    prefer: "auto" as const,
    form,
    author: SARAH,
  };
  const parsed = DraftsRequestSchema.safeParse(request);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  // Demo mode holds no prepared answers for a question set: an honest 404, not a validation error.
  const res = await post(handleDrafts, "/drafts", request);
  assert.equal(res.status, 404, await res.clone().text());
  assert.equal(ProblemSchema.parse(await res.json()).code, "NO_DEMO_DRAFT");
  // An unconfirmed question set is refused like any unconfirmed form.
  const unconfirmed = await post(handleDrafts, "/drafts", { ...request, form: { ...form, status: "proposed", confirmed: undefined } });
  assert.equal(unconfirmed.status, 409);
  assert.equal(ProblemSchema.parse(await unconfirmed.json()).code, "FORM_NOT_CONFIRMED");

  // What a drafting call would send: the portal's questions, never the patient's identifiers.
  const preview = await post(handleAiPayloadPreview, "/ai/payload-preview", { templateId: report.templateId, bundle, instructingParty: bundle.referral, form });
  assert.equal(preview.status, 200, await preview.clone().text());
  const body = AiPayloadPreviewResponseSchema.parse(await preview.json());
  const sent = body.blocks.map((b) => b.text).join("\n");
  assert.ok(sent.includes("Current symptoms and progress since the initial assessment"), "the portal's questions are sent");
  assert.ok(!sent.includes("Megan Hart") && !sent.includes("22/11/1991"), "identifiers are filled by code, never sent");
});

test("render and fill-preview give a question set's PDF summary instead of filling a file", async () => {
  const form = await confirmed();
  const bundle = getDemoBundle("megan-hart");
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: NOW });

  for (const format of ["pdf", "original"] as const) {
    const res = await post(handleRender, `/render?format=${format}`, { report, form });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get(HEADERS.renderKind), "draft");
    assert.equal(res.headers.get(HEADERS.formKind), "questions");
    assert.equal(res.headers.get(HEADERS.fileToken), null);
    assert.match(res.headers.get("content-disposition") ?? "", /Hart_M_.*_DRAFT\.pdf/);
    const text = await pdfText(res);
    assert.ok(text.includes("Current symptoms and progress since the initial assessment"), text.slice(0, 400));
    assert.ok(text.includes("Megan Hart"));
    assert.ok(text.includes("[to complete]"));
    assert.ok(text.includes("DRAFT"));
  }

  const docx = await post(handleRender, "/render?format=docx", { report, form });
  assert.equal(docx.status, 422);
  assert.match(ProblemSchema.parse(await docx.json()).detail ?? "", /copying into the portal/);

  // fill-preview has no file to fill: it answers with the DRAFT summary (the file sent is ignored).
  const preview = await post(handleFormsFillPreview, "/forms/fill-preview", { report, form, fileBase64: "AA==", mode: "draft" });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal(preview.headers.get(HEADERS.renderKind), "draft");
  assert.equal(preview.headers.get(HEADERS.formKind), "questions");
  assert.ok((await pdfText(preview)).includes("Prognosis"));
});

/** Answer every question the way the clinician would in review (so nothing blocks approval). */
function completed(report: Report, form: FormDefinition): Report {
  const sections = report.sections.map((s) => {
    const field = form.fields.find((f) => f.id === s.key);
    if (!field || s.paragraphs.some((p) => p.text.trim()) || (s.answer && s.answer.kind !== "text" && s.answer.value !== null)) return s;
    if (s.answer && s.answer.kind !== "text") {
      const value = s.answer.kind === "yes_no" ? true : s.answer.kind === "date" ? "2026-11-30" : s.answer.kind === "number" ? "4" : null;
      return { ...s, status: "complete" as const, answer: { kind: s.answer.kind, value } };
    }
    return { ...s, status: "complete" as const, paragraphs: [{ id: `${s.key}-c1`, text: `Answer to ${field.label.toLowerCase()} entered by the clinician.`, sourceIds: [], origin: "clinician" as const }] };
  });
  const gaps = report.gaps.map((g) => ({ ...g, resolution: { kind: "resolved" as const, text: "Answered on the form by Sarah Reid.", at: NOW.toISOString() } }));
  const next = { ...report, sections, gaps };
  const result = validateReport(next, formToTemplate(form));
  return { ...next, flags: result.flags };
}

test("approval needs the question set's own attestations; the FINAL summary and the copied text are the approved answers", async () => {
  const form = await confirmed();
  const bundle = getDemoBundle("megan-hart");
  const draft = completed(createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), now: NOW }), form);
  assert.ok(validateReport(draft, formToTemplate(form)).canSign, JSON.stringify(validateReport(draft, formToTemplate(form)).blocking));

  const base = { report: draft, signer: SARAH, typedSignature: SARAH.name, statementAccepted: true, form };
  const wrong = await post(handleSign, "/sign", { ...base, attestations: [...FORM_ATTESTATIONS] });
  assert.equal(wrong.status, 422);
  assert.match(JSON.stringify(await wrong.json()), /entered in the referrer's portal/);

  const res = await post(handleSign, "/sign", { ...base, attestations: [...QUESTION_SET_ATTESTATIONS] });
  assert.equal(res.status, 200, await res.clone().text());
  const { receipt } = SignResponseSchema.parse(await res.json());
  assert.equal(receipt.formMapSha256, formMapSha256(form));
  assert.deepEqual(receipt.attestations, [...QUESTION_SET_ATTESTATIONS]);
  const signed: Report = { ...draft, status: "signed", receipt };

  const final = await post(handleRender, "/render?format=original", { report: signed, receipt, form, requireFinal: true });
  assert.equal(final.status, 200, await final.clone().text());
  assert.equal(final.headers.get(HEADERS.renderKind), "final");
  assert.ok(final.headers.get(HEADERS.fileToken), "a FINAL summary can be filed to the clinic record");
  const text = await pdfText(final);
  assert.ok(text.includes("Sarah Reid") && text.includes("PH-DEMO-01"));
  assert.ok(!text.includes("[to complete]"));
  assert.match(final.headers.get("content-disposition") ?? "", /_SIGNED\.pdf/);

  // A question edited after approval is not the map the report was started from and approved with.
  const edited = { ...form, fields: form.fields.map((f, i) => (i === 0 ? { ...f, label: "Member's full name" } : f)) };
  const refused = await post(handleRender, "/render?format=pdf", { report: signed, receipt, form: edited, requireFinal: true });
  assert.equal(refused.status, 409);
  assert.equal(ProblemSchema.parse(await refused.json()).code, "FORM_MISMATCH");
  // …and once its placeholder file is recomputed it is another version of the question set altogether.
  const reVersioned = { ...edited, file: { ...edited.file, sha256: await questionSetSha256(edited.fields) } };
  const other = await post(handleRender, "/render?format=pdf", { report: signed, receipt, form: reVersioned, requireFinal: true });
  assert.equal(other.status, 409);
  assert.match(ProblemSchema.parse(await other.json()).title, /not the form the report was started from/);

  const copy = buildAnswersCopy({ report: signed, form: copyFormOf(form) });
  assert.equal(copy.approved, true);
  assert.equal(copy.toComplete, 0);
  assert.ok(copy.text.startsWith("Northbridge Health Insurance (fictional) – portal questions\nPatient: Megan Hart\nApproved by Sarah Reid (HCPC PH-DEMO-01) on "));
  assert.ok(copy.text.includes("2. Date of birth: 22/11/1991"));
  assert.ok(!copy.text.includes("Draft – not yet approved"));
});
