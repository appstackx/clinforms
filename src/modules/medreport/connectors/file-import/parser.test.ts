import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImport, parseCsvRecords, toIsoDate, extractScores } from "./parser";
import { PRIYA_NAIR_IMPORT, SAMPLE_IMPORT_FILES, buildSampleCsv } from "./samples";
import { computeFacts } from "../../core/computed-facts";
import { runDataChecks } from "../../core/validation/data-checks";
import type { ImportPayload } from "../../core/types";

const now = new Date("2026-10-06T09:00:00.000Z");
const opts = { tenantId: "demo", now };

function parseOk(payload: ImportPayload) {
  const result = parseImport(payload, opts);
  if (!result.ok) assert.fail(`expected ok, got issues: ${JSON.stringify(result.issues, null, 2)}`);
  return result;
}

test("sample JSON export parses into a file-import bundle with mapper IDs", () => {
  const { bundle, stats } = parseOk({ format: "json", content: SAMPLE_IMPORT_FILES.json.content, fileName: "sample.json" });
  assert.deepEqual(stats, { notes: 6, appointments: 7, outcomeSeries: 2, clinicians: 1 });
  assert.equal(bundle.source.connectorId, "file-import");
  assert.equal(bundle.source.simulated, false);
  assert.equal(bundle.source.label, "sample.json");
  assert.equal(bundle.source.externalPatientId, "imp-pat-3017");
  assert.equal(bundle.tenantId, "demo");
  assert.deepEqual(bundle.notes.map((n) => n.id), ["N-001", "N-002", "N-003", "N-004", "N-005", "N-006"]);
  assert.equal(bundle.appointments[2].status, "CNC");
  assert.equal(bundle.appointments[0].noteId, "N-001");
  assert.deepEqual(bundle.outcomeMeasures.map((m) => m.id), ["OM-QuickDASH", "OM-NPRS"]);
  assert.deepEqual(bundle.outcomeMeasures[0].points.map((p) => [p.value, p.noteId]), [[52, "N-001"], [34, "N-004"], [20, "N-006"]]);
  assert.equal(bundle.notes[0].pastMedicalHistory, "Mild hypertension, controlled on medication. No previous shoulder injury.");
  assert.equal(bundle.incident?.date, "2026-04-03");
  assert.equal(bundle.consent.disclosureConsentRecorded, true);
  assert.equal(bundle.episodeStatus, "discharged");
});

test("sample CSV and JSON give the same clinical content", () => {
  const fromJson = parseOk({ format: "json", content: SAMPLE_IMPORT_FILES.json.content }).bundle;
  const fromCsv = parseOk({ format: "csv", content: SAMPLE_IMPORT_FILES.csv.content }).bundle;
  const strip = (b: typeof fromJson) => ({
    notes: b.notes.map(({ externalId: _e, author, ...n }) => ({ ...n, author: { name: author.name, hcpc: author.hcpc } })),
    appointments: b.appointments.map(({ externalId: _e, clinician, ...a }) => ({ ...a, clinician: clinician?.hcpc })),
    outcomes: b.outcomeMeasures.map((m) => ({ instrument: m.instrument, unit: m.unit, points: m.points })),
    referral: b.referral,
    incident: b.incident,
    consent: b.consent,
    registration: { first: b.registration.firstName, last: b.registration.lastName, dob: b.registration.dob, sex: b.registration.sex },
    status: b.episodeStatus,
  });
  assert.deepEqual(strip(fromCsv), strip(fromJson));
});

test("sample pasted notes parse into notes with SOAP fields and outcome scores, no attendance", () => {
  const result = parseOk({ format: "text", content: SAMPLE_IMPORT_FILES.text.content });
  const { bundle } = result;
  assert.equal(bundle.source.label, "Pasted notes");
  assert.equal(bundle.notes.length, 6);
  assert.equal(bundle.appointments.length, 0);
  assert.equal(bundle.notes[0].type, "initial_assessment");
  assert.equal(bundle.notes[5].type, "discharge");
  assert.equal(bundle.notes[1].type, "follow_up");
  assert.equal(bundle.notes[0].author.hcpc, "PH-DEMO-01");
  assert.equal(bundle.notes[0].time, "10:00");
  assert.equal(bundle.notes[0].subjective, PRIYA_NAIR_IMPORT.notes[0].subjective);
  assert.equal(bundle.notes[0].objective, PRIYA_NAIR_IMPORT.notes[0].objective);
  assert.equal(bundle.notes[0].pastMedicalHistory, PRIYA_NAIR_IMPORT.notes[0].past_medical_history);
  assert.deepEqual(
    bundle.outcomeMeasures.map((m) => [m.instrument, m.points.map((p) => p.value)]),
    [["QuickDASH", [52, 34, 20]], ["NPRS", [6, 3, 1]]],
  );
  assert.equal(bundle.referral.type, "solicitor");
  assert.equal(bundle.referral.reference, "CM/PI/0815");
  assert.equal(bundle.consent.date, "2026-04-10");
  assert.equal(bundle.episodeStatus, "discharged");
  assert.ok(result.warnings.some((w) => /no attendance record/.test(w.message)));
});

test("sample case: facts and data checks look right", () => {
  const { bundle } = parseOk({ format: "json", content: SAMPLE_IMPORT_FILES.json.content });
  const facts = computeFacts(bundle, { asOf: "2026-10-06" });
  const byId = new Map(facts.map((f) => [f.id, f]));
  assert.equal(byId.get("FACT-attendance")?.value, "6 appointments attended to date, none missed (1 cancelled with notice)");
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /Cancelled with notice \(CNC, not counted above\): 1 – 24\/04\/2026 \(A-003\)/);
  assert.equal(byId.get("FACT-age")?.value, "42 years");
  assert.equal(byId.get("FACT-outcomes-QuickDASH")?.value, "QuickDASH 52/100 → 34/100 → 20/100 (lower is better)");
  // Pre-incident history and consent recorded, one clinician, discharged with a note → no checks.
  assert.deepEqual(runDataChecks(bundle), []);
});

test("plain-English issues for broken JSON, CSV and text", () => {
  const badJson = parseImport({ format: "json", content: "{ \"patient\": " }, opts);
  assert.equal(badJson.ok, false);
  if (!badJson.ok) assert.match(badJson.issues[0].message, /not valid JSON/);

  const missingDob = parseImport({ format: "json", content: JSON.stringify({ ...PRIYA_NAIR_IMPORT, patient: { ...PRIYA_NAIR_IMPORT.patient, date_of_birth: undefined } }) }, opts);
  assert.equal(missingDob.ok, false);
  if (!missingDob.ok) assert.deepEqual(missingDob.issues.map((i) => i.where), ["patient.date_of_birth"]);

  const badDate = parseImport({ format: "json", content: JSON.stringify({ ...PRIYA_NAIR_IMPORT, patient: { ...PRIYA_NAIR_IMPORT.patient, date_of_birth: "31/02/1984" } }) }, opts);
  assert.equal(badDate.ok, false);
  if (!badDate.ok) assert.match(badDate.issues[0].message, /not a valid date/);

  const csv = buildSampleCsv().replace(",10:00,initial_assessment,", ",9.3,initial_assessment,");
  const badCsv = parseImport({ format: "csv", content: csv }, opts);
  assert.equal(badCsv.ok, false);
  if (!badCsv.ok) {
    assert.match(badCsv.issues[0].where, /^line \d+, column 'time'$/);
    assert.match(badCsv.issues[0].message, /"9\.3" is not a 24-hour time/);
  }

  const noHeader = parseImport({ format: "csv", content: "date,author\n18/03/2026,Sarah Reid\n" }, opts);
  assert.equal(noHeader.ok, false);
  if (!noHeader.ok) assert.ok(noHeader.issues.some((i) => /missing the columns: type, hcpc/.test(i.message)));

  const noDates = parseImport({ format: "text", content: "Just some text without dated headings." }, opts);
  assert.equal(noDates.ok, false);
  if (!noDates.ok) assert.match(noDates.issues[0].message, /No dated notes found/);

  const noDob = parseImport({ format: "text", content: "Instructing party: Example Solicitors (fictional)\n18/03/2026 – Initial assessment\nS: Neck pain." }, opts);
  assert.equal(noDob.ok, false);
  if (!noDob.ok) assert.match(noDob.issues[0].message, /Date of birth: DD\/MM\/YYYY/);
});

test("self-referrals are refused with a clear reason", () => {
  const doc = structuredClone(PRIYA_NAIR_IMPORT);
  doc.episode.referral.source_type = "self";
  const result = parseImport({ format: "json", content: JSON.stringify(doc) }, opts);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0].where, "episode.referral.source_type");
    assert.match(result.issues[0].message, /self-referral/);
  }
});

test("minimal pasted notes: defaults, author from header, untyped notes", () => {
  const text = [
    "Date of birth: 02/01/1990",
    "Solicitor: Example & Co Solicitors (fictional)",
    "Clinician: Tom Ellis (PH-DEMO-02)",
    "",
    "**21 March 2026**",
    "Neck pain since the accident. Outcome measures: NDI 40%, NPRS 6/10.",
    "02/04/2026 – Discharge",
    "S: Much better.",
    "Outcome measures: NDI 10%",
  ].join("\n");
  const { bundle, warnings } = parseOk({ format: "text", content: text });
  assert.equal(bundle.registration.fullName, "Anonymised Patient");
  assert.equal(bundle.referral.type, "solicitor");
  assert.deepEqual(bundle.notes.map((n) => [n.date, n.type, n.author.name]), [
    ["2026-03-21", "other", "Tom Ellis"],
    ["2026-04-02", "discharge", "Tom Ellis"],
  ]);
  assert.match(bundle.notes[0].freeText ?? "", /^Neck pain since the accident/);
  assert.deepEqual(bundle.outcomeMeasures.map((m) => [m.instrument, m.points.length]), [["NDI", 2], ["NPRS", 1]]);
  assert.equal(bundle.consent.disclosureConsentRecorded, false);
  assert.ok(warnings.some((w) => /recorded as "other"/.test(w.message)));
  assert.deepEqual(runDataChecks(bundle).map((c) => c.code), ["CONSENT_NOT_RECORDED", "NO_PRE_INCIDENT_HISTORY", "SINGLE_TIMEPOINT_OUTCOME", "INCIDENT_DATE_MISSING"]);
});

test("helpers: dates, CSV records, score extraction", () => {
  assert.equal(toIsoDate("18/03/2026"), "2026-03-18");
  assert.equal(toIsoDate("8/3/2026"), "2026-03-08");
  assert.equal(toIsoDate("2026-03-18"), "2026-03-18");
  assert.equal(toIsoDate("18th March 2026"), "2026-03-18");
  assert.equal(toIsoDate("31/02/2026"), null);
  assert.deepEqual(
    parseCsvRecords('a,b\r\n"x, y","multi\nline ""quoted"""\n\n1,2').map((r) => [r.line, r.cells]),
    [[1, ["a", "b"]], [2, ["x, y", 'multi\nline "quoted"']], [5, ["1", "2"]]],
  );
  assert.deepEqual(extractScores("NDI 42%, NPRS 7/10, QuickDASH: 52, ODI 30 %"), [
    { instrument: "NDI", value: 42 },
    { instrument: "NPRS", value: 7 },
    { instrument: "QuickDASH", value: 52 },
    { instrument: "ODI", value: 30 },
  ]);
});

test("JSON import: optional insurer identifiers and appointment charges reach the bundle (absent when not given)", () => {
  const doc = JSON.parse(SAMPLE_IMPORT_FILES.json.content);
  const plain = parseOk({ format: "json", content: JSON.stringify(doc) }).bundle;
  assert.equal(plain.referral.membershipNumber, undefined);
  assert.equal(plain.appointments.some((a) => a.charge), false);

  doc.episode.referral = {
    ...doc.episode.referral,
    source_type: "insurer",
    organisation_name: "Example Health Insurance (fictional)",
    insurer_name: "Example Health Insurance (fictional)",
    membership_number: "TEST-POL-0001",
    authorisation_number: " TEST-AUTH-0001 ",
  };
  doc.appointments[0] = { ...doc.appointments[0], charge: { amount: 70, paid: true } };
  doc.appointments[1] = { ...doc.appointments[1], charge: { amount: 55, currency: "GBP", paid: false } };
  const insured = parseOk({ format: "json", content: JSON.stringify(doc) }).bundle;
  assert.equal(insured.referral.insurerName, "Example Health Insurance (fictional)");
  assert.equal(insured.referral.membershipNumber, "TEST-POL-0001");
  assert.equal(insured.referral.authorisationNumber, "TEST-AUTH-0001");
  assert.deepEqual(insured.appointments[0].charge, { amount: 70, currency: "GBP", paid: true });
  assert.deepEqual(insured.appointments[1].charge, { amount: 55, currency: "GBP", paid: false });

  doc.appointments[0] = { ...doc.appointments[0], charge: { amount: -1, paid: true } };
  const refused = parseImport({ format: "json", content: JSON.stringify(doc) }, opts);
  assert.equal(refused.ok, false);
});
