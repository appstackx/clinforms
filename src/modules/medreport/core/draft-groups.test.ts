/**
 * Fix round 2 (B1-4): on a clinic's own form the numbered rows of one table ("Activity 1"… "Activity 2 – comments") are
 * drafted in one call, so each row can take a different item; a bundled sample form keeps its groups (its recordings
 * are keyed to them). 10Bridge Initial Assessment layout; fictional record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftsRequestSchema } from "../api/contract";
import { MAX_FORM_FIELDS_PER_DRAFT } from "../config.public";
import { computeFacts } from "./computed-facts";
import { formToTemplate } from "./forms";
import { createFormReport, planDraftGroups } from "./report-factory";
import type { FormDefinition, FormField } from "./types";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

const cell = (id: string, label: string, blockId: string, answerType: FormField["answerType"] = "short_text"): FormField => ({
  id,
  label,
  guidance: "",
  answerType,
  anchor: { kind: "docx", target: "table_cell", blockId },
  fillSource: { kind: "notes_narrative" },
  required: false,
  confidence: "high",
});

const FIELDS: FormField[] = [
  cell("F-21", "Pre-existing conditions", "t2.r2.c0", "long_text"),
  cell("F-23", "Is the claimant taking medication?", "t3.r0.c0.p0", "yes_no"),
  cell("F-24", "Medication 1", "t3.r2.c0"),
  cell("F-25", "Medication 1 – frequency", "t3.r2.c1"),
  cell("F-26", "Medication 2", "t3.r3.c0"),
  cell("F-27", "Medication 2 – frequency", "t3.r3.c1"),
  cell("F-28", "Activity 1", "t4.r2.c0"),
  cell("F-29", "Activity 1 – frequency before the injury", "t4.r2.c1"),
  cell("F-30", "Activity 1 – frequency since the injury", "t4.r2.c2"),
  cell("F-31", "Activity 1 – comments", "t4.r2.c3"),
  cell("F-32", "Activity 2", "t4.r3.c0"),
  cell("F-33", "Activity 2 – frequency before the injury", "t4.r3.c1"),
  cell("F-34", "Activity 2 – frequency since the injury", "t4.r3.c2"),
  cell("F-35", "Activity 2 – comments", "t4.r3.c3"),
  cell("F-40", "Details of red flags", "t6.r1.c0", "long_text"),
];

function formOf(extra: Partial<FormDefinition> = {}): FormDefinition {
  return {
    id: "frm_rows",
    tenantId: "demo",
    title: "Initial Assessment Report",
    referrer: { name: "10Bridge", type: "mlc" },
    kind: "docx",
    file: { fileName: "ia.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "b".repeat(64), sizeBytes: 1 },
    fields: FIELDS,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
    ...extra,
  } as FormDefinition;
}

function groupsFor(form: FormDefinition): string[][] {
  const bundle = testBundle();
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_rows" });
  return planDraftGroups(report, formToTemplate(form), { form });
}

test("fix round 2 (B1-4): a clinic's own form drafts the numbered rows of one table together", () => {
  const groups = groupsFor(formOf());
  assert.ok(groups.some((g) => g.join() === "F-24,F-25,F-26,F-27"), JSON.stringify(groups));
  assert.ok(groups.some((g) => g.join() === "F-28,F-29,F-30,F-31,F-32,F-33,F-34,F-35"), "Activity 1 and Activity 2, in one call");
  assert.deepEqual(groups.flat(), FIELDS.map((f) => f.id), "every question once, in form order");
  // The server accepts a row group of that size.
  const bundle = testBundle();
  assert.equal(DraftsRequestSchema.safeParse({ templateId: "form:frm_rows", bundle, instructingParty: bundle.referral, sectionKeys: groups.find((g) => g.length === 8), form: formOf() }).success, true);
});

test("fix round 2 (B1-4): a bundled sample form keeps its groups (recordings)", () => {
  for (const extra of [{ builtIn: true, sampleId: "sample-x" }, { sampleId: "sample-x" }]) {
    const groups = groupsFor(formOf(extra));
    assert.ok(groups.every((g) => g.length <= MAX_FORM_FIELDS_PER_DRAFT), JSON.stringify(groups));
  }
});

test("fix round 2 (B1-4): the drafting call is told the rows of one table each take a different item", async () => {
  const { buildFormFinalInstruction } = await import("../ai/form-prompts");
  assert.match(buildFormFinalInstruction(formOf(), ["F-28", "F-29", "F-32", "F-33"]), /These are the numbered rows of one table: each row takes a different item, in the order the notes record them; the later rows stay empty when there are no more items\./);
  assert.doesNotMatch(buildFormFinalInstruction(formOf(), ["F-21", "F-23", "F-24", "F-25"]), /numbered rows/);
});
