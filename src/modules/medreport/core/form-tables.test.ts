/**
 * Table questions (S2): the appointments table filled by code, the "rows" answer through the form
 * helpers (answer kind, text, answered, fill answers, map checks) and the schema.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "./computed-facts";
import { appointmentColumnFromHeader, appointmentColumnsFor, formatPounds, resolveAppointmentsTable, rowsToText } from "./form-tables";
import { answerKindFor, answerToText, buildFormAnswers, checkFormDefinition, formAnchorKey, formToTemplate, isSectionAnswered, parseFormAnswerValue } from "./forms";
import { createFormReport } from "./report-factory";
import { FormDefinitionSchema, ReportSchema } from "./schemas";
import type { Appointment, EpisodeBundle, FormDefinition, FormField } from "./types";
import { validateReport } from "./validation";

const clinician = { name: "S. Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist" };
const other = { name: "T. Ellis", hcpc: "PH-DEMO-02" };

function bundle(appointments: Array<Appointment & { charge?: { amount: number; currency: "GBP"; paid?: boolean } }>): EpisodeBundle {
  return {
    tenantId: "demo",
    source: { connectorId: "tm3-sim", simulated: true, fetchedAt: "2026-10-06T09:00:00.000Z", externalPatientId: "p1", externalEpisodeId: "e1", label: "Simulated TM3 sandbox" },
    registration: { id: "REG", externalPatientId: "p1", firstName: "Test", lastName: "Patient", fullName: "Test Patient", dob: "1992-01-02", sex: "female", addressSummary: "Milton Keynes" },
    referral: { type: "insurer", name: "Example Health (fictional)", reference: "EH/1", contactName: "", address: "" },
    clinicians: [clinician, other],
    notes: [
      { id: "N-001", date: "2026-03-18", type: "initial_assessment", author: clinician, subjective: "Neck pain.", objective: "Reduced rotation.", assessment: "WAD II.", plan: "Exercises." },
      { id: "N-002", date: "2026-03-25", type: "follow_up", author: other, subjective: "Better.", objective: "Improved.", assessment: "Improving.", plan: "Continue." },
      { id: "N-003", date: "2026-04-08", type: "discharge", author: clinician, subjective: "Resolved.", objective: "Full range.", assessment: "Goals met.", plan: "Discharge." },
    ],
    appointments,
    outcomeMeasures: [],
    consent: { disclosureConsentRecorded: true, date: "2026-03-18" },
    episodeStatus: "discharged",
  };
}

const APPOINTMENTS = [
  { id: "A-001", date: "2026-03-18", time: "09:00", status: "ATT" as const, noteId: "N-001", clinician, charge: { amount: 75, currency: "GBP" as const, paid: true } },
  { id: "A-002", date: "2026-03-25", time: "09:00", status: "ATT" as const, noteId: "N-002", charge: { amount: 55, currency: "GBP" as const, paid: false } },
  { id: "A-003", date: "2026-04-01", time: "09:00", status: "DNA" as const },
  { id: "A-004", date: "2026-04-08", time: "10:30", status: "ATT" as const, noteId: "N-003", clinician },
];

const TABLE_FIELD: FormField = {
  id: "F-01",
  label: "Treatment costs you are claiming",
  guidance: "",
  answerType: "table",
  anchor: {
    kind: "pdf_table",
    columns: [
      { key: "provider", header: "Clinic or hospital name" },
      { key: "treatment", header: "Treatment given" },
      { key: "date", header: "Visit date" },
      { key: "amount", header: "Fee charged" },
      { key: "paid", header: "Fee settled?" },
    ],
    rows: [1, 2].map((n) => ({ provider: `ProviderRow${n}`, treatment: `TreatmentRow${n}`, date: `DateRow${n}`, amount: `AmountRow${n}`, paid: `YESNO${3 - n}` })),
  },
  fillSource: { kind: "appointments_table", columns: { provider: "clinic", treatment: "service", date: "date", amount: "amount", paid: "paid" } },
  required: true,
  confidence: "high",
};

function tableForm(fields: FormField[] = [TABLE_FIELD]): FormDefinition {
  return {
    id: "frm_tables",
    tenantId: "demo",
    referrer: { name: "Example Health (fictional)", type: "insurer" },
    title: "Claim form",
    file: { fileName: "claim.pdf", mimeType: "application/pdf", sha256: "1".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

test("appointments table: one row per attended session, by code, in date order; values the record lacks stay blank", () => {
  const b = bundle(APPOINTMENTS);
  const value = resolveAppointmentsTable({ when: "date", who: "clinician", what: "service", where: "clinic", fee: "amount", paid: "paid" }, { bundle: b, computedFacts: computeFacts(b, { asOf: "2026-10-09" }) });
  assert.ok(value);
  assert.deepEqual(value.appointmentIds, ["A-001", "A-002", "A-004"], "the DNA is not listed");
  assert.deepEqual(value.rows, [
    { when: "18/03/2026", who: "S. Reid", what: "Physiotherapy initial assessment", where: "Riverside Physiotherapy (fictional)", fee: "£75.00", paid: "Yes" },
    // No clinician on the appointment: the author of its note.
    { when: "25/03/2026", who: "T. Ellis", what: "Physiotherapy follow-up session", where: "Riverside Physiotherapy (fictional)", fee: "£55.00", paid: "No" },
    // No charge recorded: fee and paid left blank, never guessed.
    { when: "08/04/2026", who: "S. Reid", what: "Physiotherapy session and discharge", where: "Riverside Physiotherapy (fictional)", fee: "", paid: "" },
  ]);
  assert.deepEqual(value.sourceIds, ["N-001", "N-002", "N-003", "FACT-attendance"]);
  assert.deepEqual(value.missing.sort(), ["amount", "paid"]);
  assert.equal(resolveAppointmentsTable({ d: "date" }, { bundle: bundle([APPOINTMENTS[2]]), computedFacts: [] }), null, "no attended appointment");
  assert.equal(formatPounds(1250.5), "£1,250.50");
});

test("column headers map to what the appointment record holds (Freedom's expenses table)", () => {
  assert.equal(appointmentColumnFromHeader("Clinic or hospital name (or the doctor’s)"), "clinic");
  assert.equal(appointmentColumnFromHeader("Treatment given (e.g. a session or a scan)"), "service");
  assert.equal(appointmentColumnFromHeader("Visit date"), "date");
  assert.equal(appointmentColumnFromHeader("Fee charged"), "amount");
  assert.equal(appointmentColumnFromHeader("Fee settled?"), "paid");
  assert.equal(appointmentColumnFromHeader("Treating therapist"), "clinician");
  assert.equal(appointmentColumnFromHeader("Medication"), null);
  assert.deepEqual(appointmentColumnsFor([{ key: "a", header: "Medication" }, { key: "b", header: "Dose" }]), null, "no date column → not an appointments table");
});

test("createFormReport fills a table question by code: rows answer, cited support, no blocking flag", () => {
  const b = bundle(APPOINTMENTS);
  const form = tableForm();
  FormDefinitionSchema.parse(form);
  assert.deepEqual(checkFormDefinition(form), []);
  const report = createFormReport({ form, bundle: b, instructingParty: b.referral, computedFacts: computeFacts(b, { asOf: "2026-10-09" }), now: new Date("2026-10-09T09:00:00Z") });
  ReportSchema.parse(report);
  const section = report.sections[0];
  assert.equal(section.kind, "from_records");
  assert.equal(section.status, "complete");
  assert.equal(section.answer?.kind, "rows");
  assert.equal(Array.isArray(section.answer?.value) && section.answer.value.length, 3);
  assert.equal(section.paragraphs[0].origin, "from_records");
  assert.match(section.paragraphs[0].text, /3 attended sessions, 18\/03\/2026 to 08\/04\/2026/);
  assert.match(section.paragraphs[0].text, /does not hold every fee \(£\) or paid \(yes \/ no\)/);
  assert.equal(report.gaps.length, 0);
  assert.ok(isSectionAnswered(section));
  assert.equal(answerToText(section).split("\n")[0], "Riverside Physiotherapy (fictional) · Physiotherapy initial assessment · 18/03/2026 · £75.00 · Yes");

  const result = validateReport(report, formToTemplate(form));
  assert.deepEqual(result.flags.filter((f) => f.severity === "blocking"), []);
  assert.ok(!result.flags.some((f) => f.code === "UNKNOWN_SOURCE_ID"), "appointment support cites notes and facts only");

  // The forms engine gets the rows, not a single value.
  const answers = buildFormAnswers(report, form);
  assert.equal(answers["F-01"].rows?.length, 3);
  assert.equal(answers["F-01"].value, undefined);
});

test("a required table with no attended appointment is left blank with a gap", () => {
  const b = bundle([APPOINTMENTS[2]]);
  const report = createFormReport({ form: tableForm(), bundle: b, instructingParty: b.referral, computedFacts: [] });
  assert.equal(report.sections[0].status, "needs_input");
  assert.deepEqual(report.sections[0].answer, { kind: "rows", value: null });
  assert.equal(report.gaps.length, 1);
  assert.match(report.gaps[0].issue, /no attended appointment/);
  assert.ok(!isSectionAnswered(report.sections[0]));
  assert.deepEqual(buildFormAnswers(report, tableForm())["F-01"], {});
});

test("rows answers: kind, parsing, empty rows, anchor keys and map checks", () => {
  assert.equal(answerKindFor("table"), "rows");
  assert.deepEqual(parseFormAnswerValue({ answerType: "table" }, "anything"), { kind: "rows", value: null });
  assert.ok(!isSectionAnswered({ paragraphs: [], answer: { kind: "rows", value: [] } }));
  assert.ok(!isSectionAnswered({ paragraphs: [], answer: { kind: "rows", value: [{ a: " " }] } }));
  assert.equal(rowsToText([{ b: "2", a: "1" }], [{ key: "a" }, { key: "b" }]), "1 · 2");
  assert.match(formAnchorKey(TABLE_FIELD.anchor), /^pdftable:ProviderRow1\|/);

  // A table needs a table position and the appointments (or blank); a table position needs a table.
  const wrongAnchor = { ...TABLE_FIELD, anchor: { kind: "pdf_field" as const, fieldName: "x", fieldType: "text" as const } };
  assert.ok(checkFormDefinition(tableForm([wrongAnchor])).some((p) => /needs the table's rows and columns/.test(p)));
  const drafted = { ...TABLE_FIELD, fillSource: { kind: "notes_narrative" as const } };
  assert.ok(checkFormDefinition(tableForm([drafted])).some((p) => /filled from the appointment record, or left blank/.test(p)));
  const notTable = { ...TABLE_FIELD, answerType: "short_text" as const };
  assert.ok(checkFormDefinition(tableForm([notTable])).some((p) => /only a table question/.test(p)));
  // Flat PDFs accept the overlay table and tick anchors.
  const flat: FormDefinition = {
    ...tableForm([
      { ...TABLE_FIELD, anchor: { kind: "pdf_overlay_table", page: 1, columns: [{ key: "date", header: "Date", x: 50, width: 80 }], rowTops: [700, 680], rowHeight: 20 }, fillSource: { kind: "appointments_table", columns: { date: "date" } } },
      { ...TABLE_FIELD, id: "F-02", label: "Referral letter?", answerType: "yes_no", options: ["Yes", "No"], anchor: { kind: "pdf_overlay_ticks", page: 1, options: [{ option: "Yes", x: 200, y: 500, size: 16.8 }, { option: "No", x: 250, y: 500, size: 16.8 }] }, fillSource: { kind: "notes_narrative" } },
    ]),
    kind: "pdf_flat",
  };
  FormDefinitionSchema.parse(flat);
  assert.deepEqual(checkFormDefinition(flat), []);
});
