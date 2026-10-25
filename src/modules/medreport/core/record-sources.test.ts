/**
 * Fix round 2 (B1-15): where a record value comes from, said by what it is – a staff entry by its answer type (tick it /
 * choose it / type it), a restriction or work status as the physiotherapist's choice, a discharge the notes do not have.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "./computed-facts";
import { recordSourceOf } from "./forms";
import { recordSourceLong, staffEntryVerb } from "./labels";
import { createFormReport } from "./report-factory";
import type { FormDefinition, FormField } from "./types";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

const field = (id: string, label: string, answerType: FormField["answerType"], path: string, guidance = ""): FormField =>
  ({ id, label, guidance, answerType, anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, fillSource: { kind: "registration", path }, required: true, confidence: "medium" }) as FormField;

test("staff entries say what to do by their answer type", () => {
  assert.equal(staffEntryVerb("checkbox"), "tick it");
  assert.equal(staffEntryVerb("single_choice"), "choose it");
  assert.equal(staffEntryVerb("date"), "type it");
  assert.equal(recordSourceLong("staff_entry", "checkbox"), "Entered by staff on each report – tick it from your records");
  assert.equal(recordSourceLong("physio_choice", "checkbox"), "Chosen by the physiotherapist on each report");
});

test("a staff-entry tick or choice about restrictions or work status is the physiotherapist's choice", () => {
  const restriction = field("F-25", "Restriction required – no squatting or kneeling", "checkbox", "staff.entry", "Ticked when this restriction is required to remain at or return to work (kept on the form); otherwise it is deleted.");
  assert.equal(recordSourceOf(restriction), "physio_choice");
  assert.equal(recordSourceOf(field("F-05", "Confirmation of ID seen", "checkbox", "staff.entry", "Ticked when the patient's identity was checked at the assessment.")), "staff_entry");
  assert.equal(recordSourceOf(field("F-07", "Date referral received", "date", "staff.entry")), "staff_entry");
});

test("gaps say where a value comes from: a tick from your records; a discharge the notes do not have", () => {
  const bundle = { ...testBundle(), episodeStatus: "open" as const };
  bundle.notes = bundle.notes.map((n) => ({ ...n, type: n.type === "discharge" ? ("follow_up" as const) : n.type }));
  const form = {
    id: "frm_src",
    tenantId: "demo",
    title: "Discharge Report",
    referrer: { name: "Physio-Link", type: "mlc" },
    kind: "docx",
    file: { fileName: "f.docx", mimeType: "x", sha256: "e".repeat(64), sizeBytes: 1 },
    fields: [field("F-05", "Confirmation of ID seen", "checkbox", "staff.entry"), field("F-07", "Date treatment completed", "date", "episode.dischargeDate")],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  } as unknown as FormDefinition;
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_src" });
  assert.equal(report.gaps.find((g) => g.sectionKey === "F-05")?.suggestedQuestion, "What should be entered for “Confirmation of ID seen”? Tick it from your records.");
  const discharge = report.gaps.find((g) => g.sectionKey === "F-07");
  assert.equal(discharge?.issue, "The notes have no discharge, so “Date treatment completed” has been left blank.");
  assert.doesNotMatch(`${discharge?.issue} ${discharge?.suggestedQuestion}`, /registration details/);
});

test("fix round 2 (B1-16): stored guidance says what a box left blank prints now", async () => {
  const { currentGuidance } = await import("./forms");
  assert.equal(currentGuidance("Tick if acupuncture was used; untick if not (unanswered: the printed default stays)."), "Tick if acupuncture was used; untick if not (left blank, the printed default is removed).");
  assert.equal(currentGuidance("Ticked when the treatment plan includes massage; unanswered, the printed default stays."), "Ticked when the treatment plan includes massage; left blank, the printed default is removed.");
  assert.equal(currentGuidance("The session's length when it was not 30 minutes (e.g. “60 minutes”): it replaces the printed “30 minutes”; unanswered, “30 minutes” stays."), "The session's length when it was not 30 minutes (e.g. “60 minutes”): it replaces the printed “30 minutes”; left blank, the printed “30 minutes” is removed.");
  assert.equal(currentGuidance("Any other comments: they replace the printed “No.” (unanswered, “No.” stays)."), "Any other comments: they replace the printed “No.” (left blank, the printed “No.” is removed).");
  assert.equal(currentGuidance("Kept on the form when planned; deleted when not (unanswered: kept as printed)."), "Kept on the form when planned; deleted when not (left blank: it is deleted too).");
  assert.equal(currentGuidance("The date the report is approved."), "The date the report is approved.");
});
