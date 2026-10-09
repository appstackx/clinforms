/**
 * Table answers on the review screen (S2): staff edits of the rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFormReport } from "../../../core/report-factory";
import { ReportSchema } from "../../../core/schemas";
import type { EpisodeBundle, FormDefinition } from "../../../core/types";
import { setRowsAnswer, tableColumnsForReview } from "./table-answer-model";

const clinician = { name: "S. Reid", hcpc: "PH-DEMO-01" };
const bundle: EpisodeBundle = {
  tenantId: "demo",
  source: { connectorId: "tm3-sim", simulated: true, fetchedAt: "2026-10-06T09:00:00.000Z", externalPatientId: "p1", externalEpisodeId: "e1" },
  registration: { id: "REG", externalPatientId: "p1", firstName: "Test", lastName: "Patient", fullName: "Test Patient", dob: "1992-01-02", sex: "female", addressSummary: "Milton Keynes" },
  referral: { type: "insurer", name: "Example Health (fictional)", reference: "EH/1", contactName: "", address: "" },
  clinicians: [clinician],
  notes: [{ id: "N-001", date: "2026-03-18", type: "initial_assessment", author: clinician, subjective: "s", objective: "o", assessment: "a", plan: "p" }],
  appointments: [
    { id: "A-001", date: "2026-03-18", time: "09:00", status: "ATT", noteId: "N-001", clinician },
    { id: "A-002", date: "2026-03-25", time: "09:00", status: "ATT", clinician },
    { id: "A-003", date: "2026-04-08", time: "09:00", status: "ATT", clinician },
  ],
  outcomeMeasures: [],
  consent: { disclosureConsentRecorded: true },
  episodeStatus: "discharged",
};

const form: FormDefinition = {
  id: "frm_tables",
  tenantId: "demo",
  referrer: { name: "Example Health (fictional)", type: "insurer" },
  title: "Claim form",
  file: { fileName: "claim.pdf", mimeType: "application/pdf", sha256: "1".repeat(64), sizeBytes: 1 },
  kind: "pdf_acroform",
  fields: [
    {
      id: "F-01",
      label: "Treatment costs you are claiming",
      guidance: "",
      answerType: "table",
      anchor: { kind: "pdf_table", columns: [{ key: "date", header: "Visit date" }, { key: "amount", header: "Fee charged" }, { key: "paid", header: "Paid?" }], rows: [{ date: "D1", amount: "A1", paid: "P1" }] },
      fillSource: { kind: "appointments_table", columns: { date: "date", amount: "amount", paid: "paid" } },
      required: true,
      confidence: "high",
    },
  ],
  status: "confirmed",
  analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
};

test("review: staff edit the rows – trimmed, empty rows dropped, logged, signed reports untouched", () => {
  const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: [] });
  assert.deepEqual(tableColumnsForReview(form.fields[0], []).map((c) => c.header), ["Visit date", "Fee charged", "Paid?"]);
  const rows = (report.sections[0].answer?.value as Array<Record<string, string>>).slice();
  rows[2] = { ...rows[2], amount: " £55.00 ", paid: "No" };
  const edited = setRowsAnswer(report, "F-01", [...rows, { amount: " ", date: "" }], "S. Reid", new Date("2026-10-09T10:00:00Z"));
  const value = edited.sections[0].answer?.value as Array<Record<string, string>>;
  assert.equal(value.length, 3);
  assert.equal(value[2].amount, "£55.00");
  const last = edited.activity[edited.activity.length - 1];
  assert.equal(last.action, "answer_set");
  assert.match(last.detail, /^F-01: table “Treatment costs you are claiming” changed \(3 rows, was 3\)/);
  assert.equal(setRowsAnswer(edited, "F-01", value, "S. Reid"), edited, "no change → same report");
  const cleared = setRowsAnswer(edited, "F-01", [], "S. Reid");
  assert.equal(cleared.sections[0].answer?.value, null);
  assert.equal(cleared.sections[0].status, "needs_input");
  const signed = { ...edited, status: "signed" as const };
  assert.equal(setRowsAnswer(signed, "F-01", [], "S. Reid"), signed);
  ReportSchema.parse(edited);
});
