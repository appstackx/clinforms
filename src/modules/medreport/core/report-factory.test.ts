import { test } from "node:test";
import assert from "node:assert/strict";
import { ReportSchema } from "./schemas";
import { applyDraftResult, createReport, planDraftGroups } from "./report-factory";
import { canSign } from "./validation";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE, listTemplates } from "../templates/registry";
import { ReportTemplateSchema } from "./schemas";
import type { EpisodeBundle } from "./types";

const bundle: EpisodeBundle = {
  tenantId: "demo",
  source: { connectorId: "tm3-sim", simulated: true, fetchedAt: "2026-10-06T09:00:00.000Z", externalPatientId: "p1", externalEpisodeId: "e1", label: "Simulated TM3 sandbox" },
  registration: { id: "REG", externalPatientId: "p1", firstName: "Test", lastName: "Patient", fullName: "Test Patient", dob: "1992-01-02", sex: "female", addressSummary: "Milton Keynes", occupation: "Office administrator" },
  referral: { type: "solicitor", name: "Example Solicitors (fictional)", reference: "EX/1", contactName: "A. Clerk", address: "Milton Keynes" },
  incident: { date: "2026-03-12", mechanism: "Rear-end collision while stationary", type: "road_traffic_accident" },
  clinicians: [{ name: "S. Reid", hcpc: "PH-DEMO-01" }],
  notes: [{ id: "N-001", date: "2026-03-18", type: "initial_assessment", author: { name: "S. Reid", hcpc: "PH-DEMO-01" }, subjective: "Neck pain.", objective: "Reduced rotation.", assessment: "WAD II.", plan: "Exercises." }],
  appointments: [{ id: "A1", date: "2026-03-18", time: "09:00", status: "ATT", noteId: "N-001" }],
  outcomeMeasures: [{ id: "OM1", instrument: "NDI", unit: "%", higherIsWorse: true, points: [{ date: "2026-03-18", value: 42 }] }],
  consent: { disclosureConsentRecorded: true, date: "2026-03-18" },
  episodeStatus: "open",
};

test("built-in templates satisfy the template schema and have unique section keys", () => {
  for (const t of listTemplates()) {
    ReportTemplateSchema.parse(t);
    assert.equal(new Set(t.sections.map((s) => s.key)).size, t.sections.length, t.id);
  }
});

test("createReport produces a schema-valid draft with from-records sections filled", () => {
  const report = createReport({
    template: SOLICITOR_RTA_TEMPLATE,
    bundle,
    instructingParty: bundle.referral,
    computedFacts: [],
    now: new Date("2026-10-06T09:00:00Z"),
  });
  ReportSchema.parse(report);
  assert.equal(report.sections.length, SOLICITOR_RTA_TEMPLATE.sections.length);
  const details = report.sections.find((s) => s.key === "claimant_details");
  assert.equal(details?.status, "complete");
  assert.ok(details?.paragraphs.some((p) => p.text === "Date of birth: 02/01/1992"));
  assert.equal(report.sections.find((s) => s.key === "prognosis")?.status, "pending");

  const withoutOptional = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: [], includeOptionalSections: false });
  assert.ok(!withoutOptional.sections.some((s) => s.key === "declaration"));

  assert.deepEqual(planDraftGroups(report, SOLICITOR_RTA_TEMPLATE), [
    ["incident_history", "presenting_complaints"],
    ["examination_findings", "treatment_provided"],
    ["progress_current_status", "prognosis"],
  ]);
  assert.equal(planDraftGroups(createReport({ template: EMPLOYER_FFW_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: [] }), EMPLOYER_FFW_TEMPLATE).flat().length, 6);
});

test("applyDraftResult merges a group; canSign blocks on open gaps until resolved", () => {
  const report = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: [] });
  const merged = applyDraftResult(report, {
    sections: [{ key: "prognosis", title: "x", kind: "clinician_opinion", status: "needs_input", paragraphs: [] }],
    gaps: [{ id: "G1", sectionKey: "prognosis", issue: "No prognosis recorded", suggestedQuestion: "What is your prognosis?", relatedNoteIds: [] }],
    flags: [],
    generation: { mode: "demo_prewritten", sectionKeys: ["prognosis"], at: "2026-10-06T09:00:00.000Z", promptVersion: "1" },
  });
  ReportSchema.parse(merged);
  assert.equal(merged.sections.find((s) => s.key === "prognosis")?.title, "Prognosis (treating clinician's opinion)");
  assert.equal(merged.generation.length, 1);
  assert.equal(canSign(merged.flags, merged.gaps).ok, false);
  const resolved = merged.gaps.map((g) => ({ ...g, resolution: { kind: "resolved" as const, text: "Written by clinician", at: "2026-10-06T10:00:00.000Z" } }));
  assert.equal(canSign(merged.flags, resolved).ok, true);
});
