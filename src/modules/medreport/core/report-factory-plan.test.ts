/**
 * bh2 fix round 1 (R1T-WA1-06, Ascenti P1 – a regression against production): a box the template calls draftable
 * (notes_narrative) but report creation filled by code from the record – the attended session dates of a discharge
 * form (core/session-dates.ts) – is never planned for drafting. Drafting it added drafted text to a record box, the
 * clinic's store refused that save (403 drafted-text-added), and every later save of the report carried it and was
 * refused too: 14–20 boxes stayed "Not drafted yet". Fictional form and bundle only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "./computed-facts";
import { formToTemplate } from "./forms";
import { createFormReport, planDraftGroups } from "./report-factory";
import type { FormDefinition, FormField } from "./types";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";

function field(n: number, label: string, rest: Pick<FormField, "answerType" | "fillSource"> & Partial<FormField>): FormField {
  return { id: `F-${String(n).padStart(2, "0")}`, label, guidance: "", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${n}.c1` }, required: true, confidence: "high", ...rest };
}

function dischargeForm(): FormDefinition {
  return {
    id: "frm_test_discharge_dates",
    tenantId: "demo",
    referrer: { name: "Example Case Management Ltd (fictional)", type: "other" },
    title: "Discharge report",
    file: { fileName: "discharge.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "d".repeat(64), sizeBytes: 1000 },
    kind: "docx",
    fields: [
      field(1, "Patient name", { answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
      field(2, "Presenting complaint", { answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      // Filled by code from the attended appointments – the template still calls it a drafted box.
      field(3, "Dates of treatment sessions", { answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      field(4, "Treatment provided", { answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      field(5, "Prognosis", { answerType: "long_text", fillSource: { kind: "clinician_opinion" } }),
    ],
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "test", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

test("planDraftGroups never plans a box report creation filled by code (the attended session dates of a discharge form)", () => {
  const form = dischargeForm();
  const bundle = testBundle();
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_plan_test", now: new Date(AT) });
  const dates = report.sections.find((s) => s.key === "F-03");
  assert.equal(dates?.kind, "from_records", "the session dates are filled by code");
  assert.equal(dates?.status, "complete");
  assert.match(dates?.paragraphs[0]?.text ?? "", /\d{2}\/\d{2}\/\d{4}/);
  const template = formToTemplate(form);
  assert.equal(template.sections.find((s) => s.key === "F-03")?.kind, "ai_narrative", "the template alone would draft it");

  const planned = planDraftGroups(report, template).flat();
  assert.equal(planned.includes("F-03"), false, "never drafted");
  assert.deepEqual(planned, ["F-02", "F-04", "F-05"], "every other drafted box still is");
  // "Draft them now" / a retry asks for chosen keys: a code-filled box is not drafted even when asked for.
  assert.deepEqual(
    planDraftGroups(report, template)
      .map((g) => g.filter((k) => ["F-03", "F-04"].includes(k)))
      .filter((g) => g.length > 0)
      .flat(),
    ["F-04"],
  );
});
