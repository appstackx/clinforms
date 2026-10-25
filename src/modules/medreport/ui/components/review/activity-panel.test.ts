/**
 * Fix round 2 (B1-19): the activity log never shows a raw code – every action the Studio records has a label – and a
 * drafted group lists only the questions that received an answer, plus those left for the clinician.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_ACTIVITY_ACTIONS } from "../../../core/report-factory";
import { WORDING } from "../../wording";
import { ACTION_LABELS, activityLabel } from "./activity-panel";

test("every known activity action has a label; an unknown one reads “Updated”", () => {
  for (const action of KNOWN_ACTIVITY_ACTIONS) assert.ok(ACTION_LABELS[action], `no label for ${action}`);
  assert.equal(activityLabel("amendment_started"), "Amended version started");
  assert.equal(activityLabel("superseded"), "Replaced by a newer version");
  assert.equal(activityLabel("something_new"), "Updated");
});

test("a drafted group names the questions answered and those left for the clinician", () => {
  assert.equal(WORDING.drafting.activityDrafted(["F-13"], "live", undefined, ["F-14", "F-15"]), "Drafted F-13 from the notes. Left for the clinician: F-14, F-15.");
  assert.equal(WORDING.drafting.activityDrafted(["F-13", "F-14"], "live"), "Drafted F-13, F-14 from the notes.");
  assert.equal(WORDING.drafting.activityDrafted([], "live", undefined, ["F-14"]), "Nothing drafted from the notes – left for the clinician: F-14.");
});

test("the log says what was drafted and a tick box as the screen says it", async () => {
  const { applyDraftResult, createFormReport } = await import("../../../core/report-factory");
  const { setStructuredAnswer } = await import("./review-model");
  const { computeFacts } = await import("../../../core/computed-facts");
  const { testBundle, TEST_FACTS_DATE } = await import("../../../core/validation/test-fixtures");
  const fields = [
    { id: "F-13", label: "Current Physical Findings:", answerType: "long_text", fillSource: { kind: "notes_narrative" } },
    { id: "F-14", label: "Are there any restrictions with activities of daily living?", answerType: "long_text", fillSource: { kind: "clinician_opinion" } },
    { id: "F-44", label: "Electrotherapy", answerType: "checkbox", fillSource: { kind: "notes_narrative" } },
  ].map((f, i) => ({ ...f, guidance: "", anchor: { kind: "docx", target: "table_cell", blockId: `t${i}.r1.c0` }, required: false, confidence: "high" }));
  const form = { id: "frm_act", tenantId: "demo", title: "FINAL ASSESSMENT REPORT", referrer: { name: "Bodycare Clinics", type: "mlc" }, kind: "docx", file: { fileName: "f.docx", mimeType: "x", sha256: "d".repeat(64), sizeBytes: 1 }, fields, status: "confirmed", analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] }, createdAt: "2026-10-25T09:00:00.000Z", updatedAt: "2026-10-25T09:00:00.000Z" } as never;
  const bundle = testBundle();
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_act" });
  const drafted = applyDraftResult(report, {
    sections: [
      { key: "F-13", title: "", kind: "ai_narrative", status: "drafted", paragraphs: [{ id: "p1", text: "Full movement.", sourceIds: ["N-002"], origin: "ai" }] },
      { key: "F-14", title: "", kind: "clinician_opinion", status: "needs_input", paragraphs: [] },
    ],
    gaps: [],
    flags: [],
    generation: { mode: "live", sectionKeys: ["F-13", "F-14"], at: "2026-10-25T09:00:00.000Z", promptVersion: "t" },
  });
  assert.equal(drafted.activity[drafted.activity.length - 1].detail, "Drafted F-13 from the notes. Left for the clinician: F-14.");
  const ticked = setStructuredAnswer(drafted, "F-44", false, "Sarah Reid");
  assert.equal(ticked.activity[ticked.activity.length - 1].detail, "F-44: answer to “Electrotherapy” set to Not ticked (was blank).");
});
