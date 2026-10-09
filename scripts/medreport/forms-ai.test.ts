/**
 * Referrer forms – AI slice, end to end without live AI (demo mode): POST /drafts with a form (409
 * for an unconfirmed map, 422 for too many sections of a built-in template, 404 when no demo answers
 * exist), POST /validate with a form, POST /forms/analyse on the bundled sample files (recorded /
 * pre-written map, or rules), and the hand-made form maps on the two demo cases (code-filled
 * registration answers, draft groups, planted gaps). Run with `npm run test:medreport`.
 *
 * Owner: ai agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import { getDemoBundle } from "./dev-bundles";
import { HAND_EMPLOYER_FORM, HAND_MLC_FORM } from "./form-fixtures";
import { route } from "@/app/api/_medreport-glue";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { handleValidate } from "@/modules/medreport/api/handlers/validate";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { FormsAnalyseResponseSchema, ProblemSchema, ValidateResponseSchema } from "@/modules/medreport/api/contract";
import { checkFormDefinition, formTemplateId, formToTemplate } from "@/modules/medreport/core/forms";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { createFormReport, planDraftGroups } from "@/modules/medreport/core/report-factory";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import type { FormDefinition } from "@/modules/medreport/core/types";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { demoBearer } from "./test-actors";

const drafts = route(handleDrafts);
const validate = route(handleValidate);
const analyse = route(handleFormsAnalyse);

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:9${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: demoBearer(), ...headers },
    body: JSON.stringify(body),
  });
}

async function problemOf(res: Response) {
  return ProblemSchema.parse(await res.json());
}

function formReport(form: FormDefinition, slug: "megan-hart" | "daniel-brooks") {
  const bundle = getDemoBundle(slug);
  return createFormReport({
    form,
    bundle,
    instructingParty: bundle.referral,
    computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }),
    now: new Date("2026-10-06T09:30:00.000Z"),
    id: `rpt_${slug}`,
  });
}

test("hand-made form maps pass the confirmation checks", () => {
  assert.deepEqual(checkFormDefinition(HAND_MLC_FORM), []);
  assert.deepEqual(checkFormDefinition(HAND_EMPLOYER_FORM), []);
});

test("case A on the MLC form: identifiers and figures by code, the rest grouped for drafting", () => {
  const report = formReport(HAND_MLC_FORM, "megan-hart");
  const text = (k: string) => report.sections.find((s) => s.key === k)?.paragraphs.map((p) => p.text).join(" ");
  assert.equal(text("F-01"), "Megan Hart");
  assert.equal(text("F-02"), "22/11/1991");
  assert.equal(text("F-03"), "HP/RTA/2291");
  assert.equal(text("F-05"), "18/03/2026");
  assert.equal(text("F-06"), "10");
  // The form is from a medico-legal company and asks for the INSTRUCTING party's reference: the
  // solicitor's reference is the right value, filled by code.
  assert.deepEqual(report.gaps.map((g) => g.id), []);
  const groups = planDraftGroups(report, formToTemplate(HAND_MLC_FORM));
  // Long narratives count double: at most two of them per call.
  assert.deepEqual(groups, [
    ["F-07", "F-08"],
    ["F-09", "F-10"],
    ["F-11", "F-12", "F-13"],
    ["F-14"],
  ]);
});

test("POST /drafts with a form: unconfirmed map 409, demo answers missing 404, built-in limits kept", async () => {
  const bundle = getDemoBundle("megan-hart");
  const base = { templateId: formTemplateId(HAND_MLC_FORM.id), bundle, instructingParty: bundle.referral, sectionKeys: ["F-12", "F-13", "F-14"], prefer: "demo" };

  const unconfirmed = await drafts(post("/api/reports/v1/drafts", { ...base, form: { ...HAND_MLC_FORM, status: "proposed", confirmed: undefined } }), { params: {} });
  assert.equal(unconfirmed.status, 409);
  assert.equal((await problemOf(unconfirmed)).code, "FORM_NOT_CONFIRMED");

  // "confirmed" is only the browser's claim: without the server's attestation of exactly this map → 409.
  const claimedOnly = await drafts(post("/api/reports/v1/drafts", { ...base, form: HAND_MLC_FORM }), { params: {} });
  assert.equal(claimedOnly.status, 409);
  assert.equal((await problemOf(claimedOnly)).code, "FORM_NOT_CONFIRMED");

  const attested = withAttestedConfirmation(HAND_MLC_FORM, "Practice manager", "2026-10-01T09:00:00.000Z");
  // Changing anything that decides where/how answers go after confirmation invalidates it.
  const tampered = {
    ...attested,
    fields: attested.fields.map((f) => (f.id === "F-12" ? { ...f, fillSource: { kind: "leave_blank" as const } } : f)),
  };
  const tamperedRes = await drafts(post("/api/reports/v1/drafts", { ...base, sectionKeys: ["F-13"], form: tampered }), { params: {} });
  assert.equal(tamperedRes.status, 409);
  assert.equal((await problemOf(tamperedRes)).code, "FORM_NOT_CONFIRMED");

  const noDemo = await drafts(post("/api/reports/v1/drafts", { ...base, form: attested }), { params: {} });
  assert.equal(noDemo.status, 404);
  assert.equal((await problemOf(noDemo)).code, "NO_DEMO_DRAFT");

  const codeField = await drafts(post("/api/reports/v1/drafts", { ...base, sectionKeys: ["F-01"], form: attested }), { params: {} });
  assert.equal(codeField.status, 422, "registration fields are filled by code, never drafted");

  const missingForm = await drafts(post("/api/reports/v1/drafts", { ...base, form: undefined, sectionKeys: ["F-12"] }), { params: {} });
  assert.equal(missingForm.status, 422);

  const builtInTooMany = await drafts(
    post("/api/reports/v1/drafts", { ...base, templateId: "solicitor-rta-treating-physio", sectionKeys: ["incident_history", "presenting_complaints", "prognosis"], form: HAND_MLC_FORM }),
    { params: {} },
  );
  assert.equal(builtInTooMany.status, 422);

  const liveUnavailable = await drafts(post("/api/reports/v1/drafts", { ...base, form: attested, prefer: "live" }), { params: {} });
  assert.equal(liveUnavailable.status, 503);
  assert.equal((await problemOf(liveUnavailable)).code, "LIVE_AI_UNAVAILABLE");
});

test("POST /validate with a form report: per-field flags, sign-off blocked until answered", async () => {
  const report = formReport(HAND_EMPLOYER_FORM, "daniel-brooks");
  const res = await validate(post("/api/reports/v1/validate", { report, form: HAND_EMPLOYER_FORM }), { params: {} });
  assert.equal(res.status, 200);
  const body = ValidateResponseSchema.parse(await res.json());
  assert.equal(body.canSign, false);
  const empty = body.flags.filter((f) => f.code === "MISSING_PLACEHOLDER" && f.severity === "blocking").map((f) => f.sectionKey);
  assert.deepEqual(empty.sort(), ["F-05", "F-06", "F-07", "F-08", "F-09", "F-10"]);

  const missing = await validate(post("/api/reports/v1/validate", { report }), { params: {} });
  assert.equal(missing.status, 422, "a form report needs its form map");
});

test("POST /forms/analyse in demo mode maps every bundled sample form (no AI call)", async () => {
  assert.ok(SAMPLE_FORMS.length > 0, "the forms engine bundles sample forms");
  for (const sample of SAMPLE_FORMS) {
    const bytes = await sample.loadFile();
    const res = await analyse(
      post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(bytes).toString("base64"), fileName: sample.fileName, prefer: "demo" }),
      { params: {} },
    );
    assert.equal(res.status, 200, sample.id);
    const body = FormsAnalyseResponseSchema.parse(await res.json());
    assert.equal(body.form.status, "proposed");
    assert.equal(body.form.kind, sample.kind);
    assert.ok(["demo_recorded", "demo_prewritten", "rules"].includes(body.form.analysis.mode), body.form.analysis.mode);
    assert.ok(body.form.fields.length >= 10, `${sample.id}: ${body.form.fields.length} fields`);
    assert.ok(body.outlineSummary.answerSpaces > 0);
    assert.ok((body.trace ?? []).length >= 2);
    // Identifiers are always filled by code; nothing identifying is drafted.
    const name = body.form.fields.find((f) => /name/i.test(f.label) && !/therapist|physiotherapist|clinician|^name$/i.test(f.label));
    if (name) assert.equal(name.fillSource.kind, "registration", `${sample.id}: ${name.label}`);
    assert.deepEqual(
      checkFormDefinition(body.form).filter((p) => !/single-choice question needs its options/.test(p)),
      [],
      `${sample.id} map is internally consistent`,
    );
  }
});

test("POST /forms/analyse rejects non-forms and asks for a passcode before live analysis", async () => {
  const notAForm = await analyse(post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from("hello").toString("base64"), fileName: "x.txt" }), { params: {} });
  assert.equal(notAForm.status, 422);
  assert.equal((await problemOf(notAForm)).code, "FORM_INVALID");

  const sample = SAMPLE_FORMS[0];
  const bytes = await sample.loadFile();
  const live = await analyse(
    post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(bytes).toString("base64"), fileName: sample.fileName, prefer: "live" }),
    { params: {} },
  );
  assert.equal(live.status, 503);
  assert.equal((await problemOf(live)).code, "LIVE_AI_UNAVAILABLE");
});

test("live analysis that fails part-way falls back to the stored map of a known file, and says so", async () => {
  const { analyseFormFile } = await import("@/modules/medreport/ai/analyse-form");
  const { decodeFormFile } = await import("@/modules/medreport/forms/file");
  const { DraftGenerationError } = await import("@/modules/medreport/ai/types");
  const sample = SAMPLE_FORMS.find((s) => s.id === "harrow-pike-treating-physio");
  assert.ok(sample);
  const file = decodeFormFile(Buffer.from(await sample.loadFile()).toString("base64"));
  const failing = {
    beta: {
      messages: {
        parse: async () => {
          throw new DraftGenerationError("AI_ERROR", "Claude rejected the form analysis request.", false);
        },
      },
    },
  } as unknown as Parameters<typeof analyseFormFile>[0]["client"];
  const result = await analyseFormFile({ file, fileName: "form.docx", mode: "live", client: failing });
  assert.notEqual(result.form.analysis.mode, "rules");
  assert.notEqual(result.form.analysis.mode, "live");
  assert.ok(result.form.analysis.warnings.some((w) => /Live form reading could not finish just now/.test(w)));
  assert.ok(result.trace.some((s) => s.status === "warning" && /stored map of this exact form/.test(s.detail ?? "")));
  assert.ok(result.form.fields.length > 0);
});
