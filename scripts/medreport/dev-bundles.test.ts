/**
 * Full-fixture checks: the three demo cases map through the real tm3-sim mapper into schema-valid bundles
 * with the counts, links and planted gaps the demo script relies on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EpisodeBundleSchema } from "@/modules/medreport/core/schemas";
import { EMPLOYER_FFW_TEMPLATE } from "@/modules/medreport/templates/registry";
import { applyScope } from "@/modules/medreport/core/scope";
import { DEMO_FETCHED_AT, getDemoBundle, getDemoEpisodeData, listDemoPatients } from "./dev-bundles";

const allText = (b: ReturnType<typeof getDemoBundle>) =>
  b.notes.map((n) => [n.subjective, n.objective, n.assessment, n.plan, n.freeText ?? ""].join("\n")).join("\n");

test("dev-bundles: patient list – 3 full cases + 3 registration-only", () => {
  const patients = listDemoPatients();
  assert.deepEqual(
    patients.map((p) => [p.patientId, p.displayName, p.slug, p.episodeIds, p.registrationOnly]),
    [
      ["sim-pat-001", "Megan Hart", "megan-hart", ["sim-ep-1001"], false],
      ["sim-pat-002", "Daniel Brooks", "daniel-brooks", ["sim-ep-1002"], false],
      ["sim-pat-003", "Aisha Rahman", null, [], true],
      ["sim-pat-004", "George Whitfield", null, [], true],
      ["sim-pat-005", "Chloe Bennett", null, [], true],
      ["sim-pat-006", "Rebecca Lane", "rebecca-lane", ["sim-ep-1006"], false],
    ],
  );
});

test("dev-bundles: every case is schema-valid and stable; slug, patient ID and episode ID all resolve", () => {
  for (const [slug, pid, eid] of [
    ["megan-hart", "sim-pat-001", "sim-ep-1001"],
    ["daniel-brooks", "sim-pat-002", "sim-ep-1002"],
    ["rebecca-lane", "sim-pat-006", "sim-ep-1006"],
  ] as const) {
    const b = getDemoBundle(slug);
    const parsed = EpisodeBundleSchema.safeParse(b);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2));
    assert.deepEqual(getDemoBundle(pid), b);
    assert.deepEqual(getDemoBundle(eid), b);
    assert.equal(b.tenantId, "demo");
    assert.equal(b.source.connectorId, "tm3-sim");
    assert.equal(b.source.simulated, true);
    assert.equal(b.source.fetchedAt, DEMO_FETCHED_AT);
    assert.equal(b.source.externalPatientId, pid);
    assert.equal(b.source.externalEpisodeId, eid);
    assert.equal(b.episodeStatus, slug === "rebecca-lane" ? "open" : "discharged");
    assert.equal(b.consent.disclosureConsentRecorded, true);
    // Every note ID is sequential and every link points at an existing note.
    const ids = b.notes.map((n) => n.id);
    assert.deepEqual(ids, ids.map((_, i) => `N-${String(i + 1).padStart(3, "0")}`));
    const sortedDates = b.notes.map((n) => n.date).slice().sort();
    assert.deepEqual(b.notes.map((n) => n.date), sortedDates);
    for (const a of b.appointments) {
      if (a.status === "ATT") assert.ok(a.noteId && ids.includes(a.noteId), `${a.id} should link to a note`);
      else assert.equal(a.noteId, undefined);
    }
    for (const s of b.outcomeMeasures) for (const p of s.points) assert.ok(p.noteId && ids.includes(p.noteId));
    // Fictional-data rules (the PMI case names the insurer on record as "Bupa": the demo fills its public form).
    if (slug === "rebecca-lane") assert.equal(b.referral.name, "Bupa");
    else assert.match(b.referral.name, /\(fictional\)$/);
    for (const c of b.clinicians) assert.match(c.hcpc, /^PH-DEMO-\d{2}$/);
  }
  assert.throws(() => getDemoBundle("nobody"), /Unknown demo case/);
});

test("Case A – Megan Hart: 10 notes, 11 appointments (10 ATT, 1 DNA without reason), NDI/NPRS", () => {
  const b = getDemoBundle("megan-hart");
  assert.equal(b.registration.fullName, "Megan Hart");
  assert.equal(b.registration.dob, "1991-11-22");
  assert.equal(b.referral.type, "solicitor");
  assert.equal(b.referral.name, "Harrow & Pike Solicitors (fictional)");
  assert.equal(b.referral.reference, "HP/RTA/2291");
  assert.deepEqual(b.incident, {
    date: "2026-03-12",
    type: "road_traffic_accident",
    mechanism: b.incident?.mechanism,
  });
  assert.equal(b.notes.length, 10);
  assert.equal(b.appointments.length, 11);
  assert.equal(b.appointments.filter((a) => a.status === "ATT").length, 10);
  const dnas = b.appointments.filter((a) => a.status === "DNA");
  assert.equal(dnas.length, 1);
  assert.equal(dnas[0].date, "2026-04-15");
  assert.equal(dnas[0].reason, undefined, "planted gap: DNA reason missing");
  assert.equal(b.notes[0].type, "initial_assessment");
  assert.equal(b.notes[0].date, "2026-03-18");
  assert.equal(b.notes[9].type, "discharge");
  assert.equal(b.notes[9].date, "2026-07-07");
  assert.deepEqual(
    b.clinicians.map((c) => [c.name, c.hcpc]),
    [
      ["Sarah Reid", "PH-DEMO-01"],
      ["Tom Ellis", "PH-DEMO-02"],
    ],
  );
  assert.deepEqual(new Set(b.notes.map((n) => n.author.hcpc)).size, 2);
  const series = Object.fromEntries(b.outcomeMeasures.map((s) => [s.instrument, s.points.map((p) => [p.value, p.noteId])]));
  assert.deepEqual(series.NDI, [
    [42, "N-001"],
    [24, "N-006"],
    [12, "N-010"],
  ]);
  assert.deepEqual(series.NPRS, [
    [7, "N-001"],
    [4, "N-006"],
    [2, "N-010"],
  ]);
  // Planted gap: no pre-accident history anywhere.
  for (const n of b.notes) {
    assert.equal(n.pastMedicalHistory, undefined);
    assert.equal(n.socialHistory, undefined);
  }
  assert.doesNotMatch(allText(b), /\bPMH\b|previous (episode|history|neck)|past (medical )?history|pre-accident/i);
  // Planted gap: no prognosis recorded by any clinician.
  assert.doesNotMatch(allText(b), /prognos|expected to|full recovery|will recover|likely to resolve/i);
});

test("Case B – Daniel Brooks: 7 appointments incl. 1 LCN with reason, ODI, PMH stripped by employer scope", () => {
  const b = getDemoBundle("daniel-brooks");
  assert.equal(b.registration.fullName, "Daniel Brooks");
  assert.equal(b.registration.employer, "Ashby Freight Ltd (fictional)");
  assert.equal(b.referral.type, "employer");
  assert.equal(b.referral.reference, "AF-OH-0457");
  assert.equal(b.incident?.date, "2026-06-02");
  assert.equal(b.incident?.type, "workplace");
  assert.equal(b.appointments.length, 7);
  assert.equal(b.appointments.filter((a) => a.status === "ATT").length, 6);
  const lcn = b.appointments.filter((a) => a.status === "LCN");
  assert.equal(lcn.length, 1);
  assert.ok(lcn[0].reason && lcn[0].reason.length > 10);
  assert.equal(b.notes.length, 6);
  assert.equal(b.notes[5].type, "discharge");
  assert.equal(b.notes[5].date, "2026-09-22");
  assert.deepEqual(
    b.outcomeMeasures.map((s) => [s.instrument, s.points.map((p) => [p.value, p.noteId])]),
    [
      [
        "ODI",
        [
          [48, "N-001"],
          [30, "N-004"],
          [18, "N-006"],
        ],
      ],
    ],
  );
  // The recorded return-to-duties opinion the AI may attribute.
  const discharge = `${b.notes[5].assessment}\n${b.notes[5].plan}`;
  assert.match(discharge, /phased return to normal duties over 2 weeks/);
  assert.match(discharge, /avoid repetitive lifting >15 kg for 4 weeks/);
  assert.match(discharge, /review in 6 weeks/);
  // Unrelated history sits only in the structured fields …
  assert.match(b.notes[0].pastMedicalHistory ?? "", /arthroscopy.*2015[\s\S]*asthma/i);
  assert.match(b.notes[0].socialHistory ?? "", /smoker/i);
  assert.doesNotMatch(allText(b), /asthma|arthroscop|meniscectomy|salbutamol|football/i);
  // … and the employer template's scope strips it; no excluded term survives in the note text.
  const scoped = applyScope(b, EMPLOYER_FFW_TEMPLATE);
  for (const n of scoped.notes) {
    assert.equal(n.pastMedicalHistory, undefined);
    assert.equal(n.socialHistory, undefined);
  }
  const scopedText = allText(scoped).toLowerCase();
  for (const term of EMPLOYER_FFW_TEMPLATE.scope.excludeTerms) {
    assert.equal(scopedText.includes(term.toLowerCase()), false, `excluded term "${term}" in note text`);
  }
  // Planted gap: no formal lifting / functional capacity test documented.
  assert.doesNotMatch(allText(b), /functional capacity|FCE|lifting (test|assessment|capacity)|lift test/i);
});

test("Case C – Rebecca Lane: private medical insurance, open episode, 5 of 6 sessions used, no prognosis", () => {
  const b = getDemoBundle("rebecca-lane");
  // Registration: title, contact details (fictional ranges only).
  assert.equal(b.registration.fullName, "Rebecca Lane");
  assert.notEqual(b.registration.firstName, "Daniel");
  assert.equal(b.registration.title, "Mrs");
  assert.equal(b.registration.dob, "1981-07-23");
  assert.match(b.registration.contact?.phone ?? "", /^07700 900\d{3}$/, "Ofcom drama range");
  assert.match(b.registration.contact?.email ?? "", /@example\.com$/);
  assert.match(b.registration.addressSummary, /\(fictional\)/);
  assert.match(b.registration.employer ?? "", /\(fictional\)$/);
  // Referral: the insurer on record and its (obviously fake) identifiers; the GP practice is fictional.
  assert.deepEqual(
    [b.referral.type, b.referral.name, b.referral.insurerName, b.referral.membershipNumber, b.referral.authorisationNumber],
    ["insurer", "Bupa", "Bupa", "DEMO-POL-0001", "DEMO-AUTH-0001"],
  );
  assert.equal(b.referral.reference, "DEMO-AUTH-0001");
  assert.equal(b.referral.referralDate, "2026-08-28");
  assert.match(b.referral.reason ?? "", /Kents Hill Medical Practice \(fictional\)/);
  assert.match(b.referral.reason ?? "", /6 sessions in total/);
  // Identifiers never reach the text the drafting service sees (referral reason and notes).
  assert.doesNotMatch(`${b.referral.reason}\n${allText(b)}`, /DEMO-POL|DEMO-AUTH|07700|example\.com/);
  assert.deepEqual(b.incident && [b.incident.date, b.incident.type], ["2026-08-22", "other"]);
  assert.match(b.incident?.mechanism ?? "", /overhead locker/);
  assert.equal(b.episodeStatus, "open");
  assert.equal(b.consent.date, "2026-09-01");
  // Appointments: IA + 4 follow-ups attended, 1 CNC with a reason, the 6th pre-authorised session booked.
  assert.deepEqual(
    b.appointments.map((a) => [a.id, a.date, a.status, a.noteId ?? null]),
    [
      ["A-001", "2026-09-01", "ATT", "N-001"],
      ["A-002", "2026-09-08", "ATT", "N-002"],
      ["A-003", "2026-09-15", "ATT", "N-003"],
      ["A-004", "2026-09-22", "CNC", null],
      ["A-005", "2026-09-24", "ATT", "N-004"],
      ["A-006", "2026-10-01", "ATT", "N-005"],
      ["A-007", "2026-10-15", "BOOKED", null],
    ],
  );
  assert.ok((b.appointments[3].reason ?? "").length > 10, "CNC reason recorded");
  // Charges: initial assessment £70, follow-ups £55, all paid except the latest; none on CNC / BOOKED.
  assert.deepEqual(
    b.appointments.map((a) => (a.charge ? [a.charge.amount, a.charge.currency, a.charge.paid] : null)),
    [[70, "GBP", true], [55, "GBP", true], [55, "GBP", true], null, [55, "GBP", true], [55, "GBP", false], null],
  );
  // Notes: all by the treating physiotherapist Sarah Reid; SOAP with clinic shorthand.
  assert.equal(b.notes.length, 5);
  assert.deepEqual(b.notes.map((n) => [n.type, n.date]), [
    ["initial_assessment", "2026-09-01"],
    ["follow_up", "2026-09-08"],
    ["follow_up", "2026-09-15"],
    ["follow_up", "2026-09-24"],
    ["follow_up", "2026-10-01"],
  ]);
  assert.deepEqual(b.clinicians.map((c) => [c.name, c.hcpc]), [["Sarah Reid", "PH-DEMO-01"]]);
  assert.match(b.notes[0].subjective, /\bR hand dominant\b/);
  assert.match(b.notes[0].assessment, /rotator cuff related shoulder pain \(subacromial pain\)/);
  assert.match(b.notes[0].pastMedicalHistory ?? "", /No previous R or L shoulder problems/);
  // Outcome measures at 3 time points, linked to N-001 / N-003 / N-005.
  const series = Object.fromEntries(b.outcomeMeasures.map((s) => [s.instrument, s.points.map((p) => [p.value, p.noteId])]));
  assert.deepEqual(series.NPRS, [[7, "N-001"], [5, "N-003"], [4, "N-005"]]);
  assert.deepEqual(series.QuickDASH, [[52.3, "N-001"], [38.6, "N-003"], [29.5, "N-005"]]);
  assert.deepEqual(series.PSFS, [[2.7, "N-001"], [4.3, "N-003"], [5.3, "N-005"]]);
  assert.equal(b.outcomeMeasures.find((s) => s.instrument === "PSFS")?.higherIsWorse, false);
  // The latest note records the further-treatment request (5 used of 6, 4 more requested) and its reason.
  const latest = `${b.notes[4].subjective}\n${b.notes[4].assessment}\n${b.notes[4].plan}`;
  assert.match(latest, /Session 5 of the 6 pre-authorised/);
  assert.match(latest, /4 further sessions/);
  assert.match(latest, /Clinical reason:/);
  assert.match(latest, /Guideline followed:/);
  // Planted gap: no prognosis recorded by any clinician.
  assert.doesNotMatch(allText(b), /prognos|expected to|expect|anticipat|full recovery|will recover|likely to (?:resolve|recover)|should (?:recover|resolve)/i);
});

test("dev-bundles: getDemoEpisodeData returns a fresh copy of the wire data", () => {
  const a = getDemoEpisodeData("megan-hart");
  a.notes.length = 0;
  assert.equal(getDemoEpisodeData("megan-hart").notes.length, 10);
});

test("fixtures: every wire record passes the module's sim wire schemas", async () => {
  const wire = await import("@/modules/medreport/connectors/tm3-sim/wire");
  const fx = await import("@/sandbox/tm3-sim/fixtures");
  const check = (schema: { safeParse(v: unknown): { success: boolean } }, items: unknown[], label: string) => {
    for (const item of items) assert.equal(schema.safeParse(item).success, true, `${label}: ${JSON.stringify(item).slice(0, 80)}`);
  };
  check(wire.SimPatientSchema, fx.SIM_PATIENTS, "patient");
  check(wire.SimEpisodeSchema, fx.SIM_EPISODES, "episode");
  check(wire.SimNoteSchema, fx.SIM_NOTES, "note");
  check(wire.SimAppointmentSchema, fx.SIM_APPOINTMENTS, "appointment");
  check(wire.SimOutcomeMeasureSchema, fx.SIM_OUTCOME_MEASURES, "outcome measure");
  const noteIds = new Set(fx.SIM_NOTES.map((n) => n.id));
  for (const a of fx.SIM_APPOINTMENTS) if (a.note_id) assert.ok(noteIds.has(a.note_id));
  assert.equal(new Set(fx.SIM_NOTES.map((n) => n.id)).size, fx.SIM_NOTES.length);
  assert.equal(new Set(fx.SIM_APPOINTMENTS.map((a) => a.id)).size, fx.SIM_APPOINTMENTS.length);
});
