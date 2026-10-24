/**
 * P3 (10/2026, scope by question – core/forms.ts formScope): a case-manager referrer's form that
 * explicitly ASKS for the past medical or social history gets it drafted (its note field and terms are sent), with
 * those terms confined to the asking questions (SCOPE_TERM, blocking, anywhere else); an employer's own form,
 * return-to-work forms and forms that do not ask keep the minimisation; every other referrer type has no scope, as before. Fictional data only
 * (Daniel Brooks, sim-pat-002, whose first note carries a structured past medical and social history).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import { buildFormPromptParts } from "@/modules/medreport/ai/form-prompts";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { formScope, formToTemplate } from "@/modules/medreport/core/forms";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { applyScope } from "@/modules/medreport/core/scope";
import type { FormDefinition, FormField, ReferrerType } from "@/modules/medreport/core/types";
import { validateReport } from "@/modules/medreport/core/validation";
import { KINGSWAY_FORM } from "@/modules/medreport/forms/samples/maps/kingsway";
import { getDemoBundle } from "./dev-bundles";

const AT = "2026-10-24T09:00:00.000Z";

function field(id: string, label: string, fillSource: FormField["fillSource"] = { kind: "notes_narrative" }): FormField {
  return {
    id,
    label,
    guidance: `Answer ${label}.`,
    answerType: "long_text",
    anchor: { kind: "docx", target: "after_paragraph", blockId: `p${Number(id.slice(2)) * 2}` },
    fillSource,
    required: true,
    confidence: "high",
  };
}

function form(type: ReferrerType, title: string, labels: string[]): FormDefinition {
  return {
    id: "frm_scope_test",
    tenantId: "demo",
    referrer: { name: "Larkfield Rehabilitation Network (fictional)", type },
    title,
    file: { fileName: "ia.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "c".repeat(64), sizeBytes: 1000 },
    kind: "docx",
    fields: [field("F-01", "Patient name", { kind: "registration", path: "patient.fullName" }), ...labels.map((l, i) => field(`F-${String(i + 2).padStart(2, "0")}`, l))],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "rules-2", at: AT, warnings: [] },
    confirmed: { by: "Sarah Reid", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

const IA = (type: ReferrerType) => form(type, "Initial Assessment Report", ["History of presenting complaint", "Past medical history", "Social history", "Treatment plan"]);

test("formScope: asked history is in scope for case managers – confined to its questions; employers' own forms, RTW forms and other forms keep minimisation", () => {
  for (const type of ["mlc", "solicitor", "insurer", "other"] as const) assert.deepEqual(formScope(type, IA(type)), { excludeFields: [], excludeTerms: [] }, type);

  const cm = formScope("case_manager", IA("case_manager"));
  assert.deepEqual(cm.excludeFields, [], "both histories are asked for");
  assert.deepEqual(cm.excludeTerms, ["family history"]);
  assert.deepEqual(cm.confineTerms, [
    { terms: ["past medical history", "previous medical history", "medical history", "PMH"], sectionKeys: ["F-03"] },
    { terms: ["social history", "smoker", "smoking", "alcohol", "units per week", "recreational drugs"], sectionKeys: ["F-04"] },
  ]);
  // Only the past medical history asked: the social history stays withheld.
  const pmhOnly = formScope("case_manager", form("case_manager", "Physiotherapy Assessment", ["Relevant medical history", "Findings"]));
  assert.deepEqual(pmhOnly.excludeFields, ["note.socialHistory"]);
  assert.ok(pmhOnly.excludeTerms.includes("smoking") && !pmhOnly.excludeTerms.includes("medical history"));
  assert.deepEqual(pmhOnly.confineTerms?.map((g) => g.sectionKeys), [["F-02"]]);

  const employerScope = formScope("employer");
  // An employer's own form goes to the employer: minimisation whatever it asks (verify fix 10/2026).
  assert.deepEqual(formScope("employer", IA("employer")), employerScope);
  assert.deepEqual(formScope("employer", form("employer", "Physiotherapy Assessment", ["Relevant medical history", "Social history"])), employerScope);
  // Return-to-work forms (by title or by a question) and forms that do not ask: unchanged minimisation.
  assert.deepEqual(formScope("case_manager", form("case_manager", "Return to Work Report", ["Past medical history", "Fitness"])), employerScope);
  assert.deepEqual(formScope("employer", form("employer", "Physiotherapy Report", ["Past medical history", "Is the employee fit to return to their normal duties?"])), employerScope);
  assert.deepEqual(formScope("case_manager", form("case_manager", "Progress Report", ["Progress", "Plan"])), employerScope);
  assert.deepEqual(formScope("case_manager", KINGSWAY_FORM), employerScope, "the bundled case-manager form is unchanged");
  // A question filled by code or left blank does not count as asking for history to be drafted.
  const byCode = form("case_manager", "Initial Assessment Report", ["Findings"]);
  byCode.fields.push({ ...field("F-09", "Past medical history"), fillSource: { kind: "leave_blank" } });
  assert.deepEqual(formScope("case_manager", byCode), employerScope);
});

test("drafting: the asked history reaches the drafting call, with an instruction to keep it to its question", () => {
  const bundle = getDemoBundle("daniel-brooks");
  assert.ok(bundle.notes.some((n) => n.pastMedicalHistory?.includes("asthma")), "fixture: Daniel's first note has a past medical history");
  const f = IA("case_manager");
  const template = formToTemplate(f);
  const scoped = applyScope(bundle, template);
  assert.ok(scoped.notes.some((n) => n.pastMedicalHistory?.includes("asthma")), "the past medical history is kept");
  assert.ok(scoped.notes.some((n) => n.socialHistory?.includes("Non-smoker")), "the social history is kept (asked too)");
  const parts = buildFormPromptParts({ form: f, template, bundle, instructingParty: bundle.referral, sectionKeys: ["F-03"], computedFacts: computeFacts(bundle, { asOf: "2026-10-24" }) });
  assert.match(parts.template, /Only in the answer to F-03 \(the form asks for it there\) – never anywhere else: past medical history; previous medical history; medical history; PMH\./);
  assert.match(parts.episode, /asthma/);
  // A return-to-work form for the same patient: withheld, as before.
  const rtw = form("case_manager", "Return to Work Report", ["Past medical history", "Fitness for work"]);
  const rtwScoped = applyScope(bundle, formToTemplate(rtw));
  assert.ok(rtwScoped.notes.every((n) => !n.pastMedicalHistory && !n.socialHistory), "history withheld on a return-to-work form");
  assert.doesNotMatch(buildFormPromptParts({ form: rtw, template: formToTemplate(rtw), bundle, instructingParty: bundle.referral, sectionKeys: ["F-02"], computedFacts: [] }).episode, /asthma/);
});

test("validation: history terms are fine in the question that asks for them and blocking anywhere else", () => {
  const bundle = getDemoBundle("daniel-brooks");
  const f = form("case_manager", "Initial Assessment Report", ["History of presenting complaint", "Past medical history", "Treatment plan"]);
  const template = formToTemplate(f);
  const report = createFormReport({ form: f, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-24" }), now: new Date(AT), id: "rpt_scope" });
  const write = (key: string, text: string) => {
    const s = report.sections.find((x) => x.key === key);
    assert.ok(s, key);
    s.paragraphs = [{ id: `${key}-p1`, text, sourceIds: [], origin: "clinician" }];
    s.status = "complete";
  };
  write("F-02", "Lower back pain after lifting at work (fictional).");
  write("F-03", "Past medical history: right knee arthroscopy in 2015 and mild asthma (fictional).");
  write("F-04", "Weekly physiotherapy; graded return to activity.");
  const clean = validateReport(report, template, { form: f }).flags.filter((x) => x.code === "SCOPE_TERM");
  assert.deepEqual(clean, [], "the asked history in its own answer is not a scope problem");

  write("F-04", "Weekly physiotherapy, taking his medical history into account.");
  const flagged = validateReport(report, template, { form: f }).flags.filter((x) => x.code === "SCOPE_TERM");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].sectionKey, "F-04");
  assert.equal(flagged[0].severity, "blocking");
  assert.match(flagged[0].message, /belongs only in the answer to “Past medical history”/);

  write("F-04", "Weekly physiotherapy; he is a non-smoker.");
  const social = validateReport(report, template, { form: f }).flags.filter((x) => x.code === "SCOPE_TERM");
  assert.equal(social.length, 1, "the social history is not asked for: still out of scope everywhere");
  assert.match(social[0].message, /out of scope/);
});
