/**
 * Fix round 1 (B0-7), found live on the Proclaim Care final report: a conditional question that does not apply
 * ("If not back at work, expected return to work date" after "Has the patient returned to work?" = Yes) still blocked
 * approval on a freshly drafted report, because its gaps were settled only by the review's reducer – never after the
 * first drafting run. generateReport() settles them before the report is checked (audited, "System").
 * Fictional form and patient.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFacts } from "../../../core/computed-facts";
import type { FormDefinition, FormField } from "../../../core/types";
import { testBundle } from "../../../core/validation/test-fixtures";
import { generateReport, type GenerateInput } from "./generate";

const AT = "2026-10-06T09:00:00.000Z";

function field(id: string, spec: Partial<FormField> & Pick<FormField, "label" | "answerType" | "fillSource">): FormField {
  return {
    id,
    guidance: `Answer “${spec.label}”.`,
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` },
    required: true,
    confidence: "high",
    ...spec,
  };
}

function form(): FormDefinition {
  return {
    id: "frm_test_conditions",
    tenantId: "demo",
    referrer: { name: "Example Case Management (fictional)", type: "case_manager" },
    title: "FINAL ASSESSMENT REPORT",
    file: { fileName: "example.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "c".repeat(64), sizeBytes: 1000 },
    kind: "docx",
    fields: [
      field("F-01", { label: "Has the patient returned to work?", section: "Work", answerType: "yes_no", options: ["Yes", "No"], fillSource: { kind: "notes_narrative" } }),
      field("F-02", { label: "If not back at work, expected return to work date", section: "Work", answerType: "date", fillSource: { kind: "clinician_opinion" }, required: false }),
    ],
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "test", at: AT, warnings: [] },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

test("fix round 1 (B0-7): after drafting, a question whose condition does not hold has its gaps settled as not applicable", async () => {
  const bundle = testBundle();
  const client: GenerateInput["client"] = {
    async drafts(body) {
      const sections = [];
      const gaps = [];
      if (body.sectionKeys.includes("F-01")) {
        sections.push({
          key: "F-01",
          title: "Has the patient returned to work?",
          kind: "ai_narrative" as const,
          status: "drafted" as const,
          answer: { kind: "yes_no" as const, value: true },
          paragraphs: [{ id: "F-01-p1", text: "Back at work on full duties.", sourceIds: ["N-002"], origin: "ai" as const, basis: "patient_reported" as const }],
        });
      }
      if (body.sectionKeys.includes("F-02")) {
        sections.push({ key: "F-02", title: "If not back at work, expected return to work date", kind: "clinician_opinion" as const, status: "needs_input" as const, paragraphs: [] });
        gaps.push({ id: "gap-F-02-1", sectionKey: "F-02", issue: "No return to work date is recorded.", suggestedQuestion: "When?", relatedNoteIds: [], raisedBy: "ai" as const });
      }
      return { sections, gaps, flags: [], generation: { mode: "demo_prewritten", promptVersion: "test", at: AT } } as unknown as Awaited<ReturnType<GenerateInput["client"]["drafts"]>>;
    },
    async validate() {
      throw new Error("validation is best effort here");
    },
  } as GenerateInput["client"];

  const { report } = await generateReport({
    client,
    data: { bundle, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }) },
    target: { kind: "form", form: form() },
    livePossible: true,
    concurrency: 1,
    now: () => new Date("2026-10-06T10:00:00Z"),
  });

  const gap = report.gaps.find((g) => g.id === "gap-F-02-1");
  assert.ok(gap, "the drafted gap is kept");
  assert.equal(gap?.resolution?.kind, "resolved", "no longer blocks approval");
  assert.equal(gap?.resolution?.notApplicable, true);
  assert.equal(gap?.resolution?.text, "Not applicable: “Has the patient returned to work?” is “Yes”.");
  assert.ok(report.activity.some((a) => a.actor === "System" && a.detail.startsWith("F-02: resolved gap “No return to work date is recorded.” – Not applicable")), "audited");
});
