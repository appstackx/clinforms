/**
 * bh2 fix round 1 (R1T-WD-L1, a discharge form's visits table): the length box of a visit the record does not have
 * is not asked, the same way as that visit's date and time – no gap, no "optional – no answer yet", nothing printed (its
 * printed "30 min" is cleared) – while a visit that happened still asks for its length, a person's answer still prints,
 * and a report from before this release reads as it did. Fictional form and notes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDraft } from "../ai/assemble";
import { computeFacts } from "./computed-facts";
import { buildFormAnswers } from "./forms/answers";
import { formToTemplate } from "./forms";
import { issueDetails, sessionRowNotAttended } from "./issue-state";
import { createFormReport } from "./report-factory";
import type { FormDefinition, FormField, Report } from "./types";
import { runValidators } from "./validation";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";

function date(id: string, label: string, index: number): FormField {
  return { id, label, guidance: "", answerType: "date", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, fillSource: { kind: "registration", path: "episode.attendedDate", part: { index, of: 3 } }, required: false, confidence: "high" };
}
function length(id: string, label: string): FormField {
  return { id, label, guidance: "How long the visit took, when it was not 30 minutes.", answerType: "short_text", anchor: { kind: "docx", target: "replace_placeholder", blockId: `t0.r${id.slice(2)}.c1`, placeholderText: "30 min" }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" };
}
const FORM: FormDefinition = {
  id: "frm_wd_visits",
  tenantId: "demo",
  referrer: { name: "Eastbrook Case Services (fictional)", type: "mlc" },
  title: "Progress and Discharge Summary",
  file: { fileName: "wd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "a".repeat(64), sizeBytes: 1 },
  kind: "docx",
  fields: [date("F-09", "Visit 2 – date", 2), length("F-10", "Visit 2 – length"), date("F-11", "Visit 3 – date", 3), length("F-12", "Visit 3 – length")],
  status: "confirmed",
  analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
  confirmed: { by: "Test", at: AT },
  createdAt: AT,
  updatedAt: AT,
};

/** Owen Testcase's episode: 2 attended appointments (and 1 not attended), so there is no visit 3. */
function report(): Report {
  const bundle = testBundle();
  return createFormReport({ form: FORM, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_wd_visits", now: new Date(AT), author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } });
}
const stateOf = (r: Report, key: string) => issueDetails(r, FORM).find((b) => b.key === key)?.state;

test("R1T-WD-L1: the length of a visit the record does not have is not asked, like its date; the length of a visit that happened still is", () => {
  const r = report();
  assert.deepEqual(stateOf(r, "F-11"), { kind: "not_applicable", reason: "session_not_attended" }, "visit 3's date (as before)");
  assert.deepEqual(stateOf(r, "F-12"), { kind: "not_applicable", reason: "session_not_attended" }, "visit 3's length");
  assert.equal(stateOf(r, "F-10")?.kind, "blank", "visit 2 happened: its length is still a question");
  const sections = new Map(r.sections.map((s) => [s.key, s] as const));
  assert.equal(sessionRowNotAttended(FORM.fields[3], FORM.fields, sections), true);
  assert.equal(sessionRowNotAttended(FORM.fields[1], FORM.fields, sections), false);
});

test("R1T-WD-L1: no 'optional – no answer yet' on the length of a visit that did not happen; the printed '30 min' is cleared, not printed", () => {
  const r = report();
  const flags = runValidators({ report: r, bundle: r.bundleSnapshot, template: formToTemplate(FORM), computedFacts: computeFacts(r.bundleSnapshot, { asOf: TEST_FACTS_DATE }), form: FORM });
  assert.ok(!flags.some((f) => f.sectionKey === "F-12" && f.code === "MISSING_PLACEHOLDER"), "nothing to answer");
  assert.ok(flags.some((f) => f.sectionKey === "F-10" && f.code === "MISSING_PLACEHOLDER" && f.evidence === "optional field blank"), "visit 2's length is still optional with no answer");
  const answers = buildFormAnswers(r, FORM);
  assert.deepEqual(answers["F-12"], { text: "", blank: true, leftBlank: true });
  assert.deepEqual(answers["F-11"], { text: "", blank: true }, "the date line as before");
});

test("R1T-WD-L1: a person's answer in that box still prints; a report from before this release reads as it did", () => {
  const typed: Report = { ...report(), sections: report().sections.map((s) => (s.key === "F-12" ? { ...s, paragraphs: [{ id: "p1", text: "45 minutes", sourceIds: [], origin: "clinician" as const }] } : s)) };
  assert.equal(stateOf(typed, "F-12")?.kind, "answer");
  const legacy: Report = { ...report() };
  delete (legacy as { reportModel?: number }).reportModel;
  assert.equal(stateOf(legacy, "F-12")?.kind, "blank", "no new reading on a pre-release report");
});

test("R1T-WD-L1 through assembly: no 'the record does not answer' gap on the length of a visit that did not happen; one on a visit that did", () => {
  const bundle = testBundle();
  const res = assembleDraft({
    template: formToTemplate(FORM),
    bundle,
    instructingParty: bundle.referral,
    sectionKeys: ["F-10", "F-12"],
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    output: { sections: [], gaps: [] },
    meta: { mode: "demo_prewritten", sectionKeys: ["F-10", "F-12"], at: AT, promptVersion: "t" },
    form: FORM,
    idSeed: "visits",
    approver: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
  });
  assert.deepEqual(res.gaps.filter((g) => g.sectionKey === "F-12"), []);
  assert.equal(res.sections.find((s) => s.key === "F-12")?.status, "drafted");
  assert.match(res.gaps.find((g) => g.sectionKey === "F-10")?.issue ?? "", /does not answer “Visit 2 – length”/);
});
