/**
 * Mapper unit tests on small synthetic wire data. (Module files may not import the sandbox, so the
 * full-fixture checks – Megan Hart and Daniel Brooks – live in scripts/medreport/dev-bundles.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EpisodeBundleSchema } from "../../core/schemas";
import { ConnectorError } from "../types";
import { mapSimEpisodeToBundle, type SimEpisodeData } from "./mapper";
import type { SimClinician } from "./wire";

const A: SimClinician = { name: "Demo Physio A", hcpc: "PH-DEMO-91", role: "Physiotherapist" };
const B: SimClinician = { name: "Demo Physio B", hcpc: "PH-DEMO-92", role: null };
const OPTS = { tenantId: "demo", fetchedAt: "2026-10-06T09:00:00.000Z" };

function note(id: string, date: string, time: string | null, author: SimClinician, appointmentId: string | null) {
  return {
    id,
    episode_id: "ep-1",
    note_date: date,
    note_time: time,
    note_type: "follow_up" as const,
    author,
    subjective: `S ${id}`,
    objective: `O ${id}`,
    assessment: `A ${id}`,
    plan: `P ${id}`,
    free_text: null,
    past_medical_history: null,
    social_history: null,
    appointment_id: appointmentId,
    _simulated: true as const,
  };
}

function appt(id: string, date: string, time: string, status: "ATT" | "DNA" | "LCN", noteId: string | null, reason: string | null = null) {
  return {
    id,
    episode_id: "ep-1",
    date,
    start_time: time,
    duration_minutes: 30,
    status,
    status_reason: reason,
    clinician: A,
    note_id: noteId,
    _simulated: true as const,
  };
}

function wire(): SimEpisodeData {
  return {
    patient: {
      id: "pat-1",
      title: null,
      first_name: "Test",
      last_name: "Person",
      date_of_birth: "1990-01-01",
      sex: "not_recorded",
      address: { line1: "1 Test Street (fictional)", line2: null, town: "Milton Keynes", postcode: "MK9 0ZZ" },
      phone: null,
      email: null,
      occupation: null,
      employer_name: null,
      registered_at: "2026-01-01T00:00:00.000Z",
      episode_count: 1,
      _simulated: true,
    },
    episode: {
      id: "ep-1",
      patient_id: "pat-1",
      title: "Test episode",
      status: "open",
      start_date: "2026-02-01",
      end_date: null,
      referral: {
        source_type: "insurer",
        organisation_name: "Test Insurer (fictional)",
        reference: null,
        contact_name: null,
        address: null,
        referral_date: null,
        reason: null,
      },
      incident: { date: null, mechanism: "Unknown", incident_type: "other" },
      consent: { disclosure_consent_recorded: false, recorded_on: null },
      primary_clinician: B,
      _simulated: true,
    },
    // Deliberately out of order (newest first, plus a same-day pair with times).
    notes: [
      note("w-n3", "2026-02-15", "14:00", A, "w-a3"),
      note("w-n1", "2026-02-01", null, B, null),
      note("w-n2", "2026-02-15", "09:00", A, null),
      { ...note("w-other", "2026-02-02", null, A, null), episode_id: "ep-OTHER" },
    ],
    appointments: [
      appt("w-a3", "2026-02-15", "14:00", "ATT", null),
      appt("w-a1", "2026-02-01", "10:00", "ATT", "w-n1"),
      appt("w-a2", "2026-02-08", "10:00", "DNA", null),
      appt("w-a4", "2026-02-22", "10:00", "LCN", null, "  Car broke down  "),
    ],
    outcomeMeasures: [
      {
        id: "w-om",
        episode_id: "ep-1",
        instrument: "PSFS",
        unit: "/10",
        higher_is_worse: false,
        scores: [
          { date: "2026-02-15", value: 6, note_id: "w-n3" },
          { date: "2026-02-01", value: 3, note_id: null },
        ],
        _simulated: true,
      },
    ],
  };
}

test("mapper: notes get N-IDs in date/time order and other episodes are ignored", () => {
  const bundle = mapSimEpisodeToBundle(wire(), OPTS);
  assert.deepEqual(
    bundle.notes.map((n) => [n.id, n.externalId]),
    [
      ["N-001", "w-n1"],
      ["N-002", "w-n2"],
      ["N-003", "w-n3"],
    ],
  );
  assert.equal(bundle.notes[0].time, undefined);
  assert.equal(bundle.notes[1].time, "09:00");
});

test("mapper: appointments sorted, A-IDs assigned, note links rewritten both ways, reasons trimmed", () => {
  const bundle = mapSimEpisodeToBundle(wire(), OPTS);
  assert.deepEqual(
    bundle.appointments.map((a) => [a.id, a.externalId, a.status, a.noteId ?? null, a.reason ?? null]),
    [
      ["A-001", "w-a1", "ATT", "N-001", null],
      ["A-002", "w-a2", "DNA", null, null],
      ["A-003", "w-a3", "ATT", "N-003", null],
      ["A-004", "w-a4", "LCN", null, "Car broke down"],
    ],
  );
});

test("mapper: outcome points sorted and linked (explicit note_id or the single same-day note)", () => {
  const bundle = mapSimEpisodeToBundle(wire(), OPTS);
  assert.equal(bundle.outcomeMeasures[0].id, "OM-PSFS");
  assert.deepEqual(bundle.outcomeMeasures[0].points, [
    { date: "2026-02-01", value: 3, noteId: "N-001" },
    { date: "2026-02-15", value: 6, noteId: "N-003" },
  ]);
});

test("mapper: nulls become absent/empty, clinicians de-duplicated, source and registration set", () => {
  const bundle = mapSimEpisodeToBundle(wire(), OPTS);
  assert.deepEqual(bundle.referral, {
    type: "insurer",
    name: "Test Insurer (fictional)",
    reference: "",
    contactName: "",
    address: "",
  });
  assert.deepEqual(bundle.incident, { mechanism: "Unknown", type: "other" });
  assert.deepEqual(bundle.consent, { disclosureConsentRecorded: false });
  assert.deepEqual(bundle.clinicians, [
    { name: "Demo Physio B", hcpc: "PH-DEMO-92" },
    { name: "Demo Physio A", hcpc: "PH-DEMO-91", role: "Physiotherapist" },
  ]);
  assert.deepEqual(bundle.source, {
    connectorId: "tm3-sim",
    simulated: true,
    fetchedAt: OPTS.fetchedAt,
    externalPatientId: "pat-1",
    externalEpisodeId: "ep-1",
    label: "Simulated TM3 sandbox",
  });
  assert.equal(bundle.registration.id, "REG");
  assert.equal(bundle.registration.fullName, "Test Person");
  assert.equal(bundle.registration.addressSummary, "1 Test Street (fictional), Milton Keynes, MK9 0ZZ");
  assert.equal(bundle.registration.contact, undefined);
  assert.equal(EpisodeBundleSchema.safeParse(bundle).success, true);
});

test("mapper: insurer identifiers and appointment charges are copied when present (trimmed), absent otherwise", () => {
  const input = wire();
  input.episode.referral.insurer_name = "  Test Insurer (fictional) ";
  input.episode.referral.membership_number = "DEMO-POL-9999";
  input.episode.referral.authorisation_number = "   ";
  input.appointments[0].charge = { amount: 55, currency: "GBP", paid: false };
  input.appointments[1] = { ...input.appointments[1], charge: { amount: 70, currency: "GBP", paid: true } };
  input.appointments[2] = { ...input.appointments[2], charge: null };
  const bundle = mapSimEpisodeToBundle(input, OPTS);
  assert.equal(bundle.referral.insurerName, "Test Insurer (fictional)");
  assert.equal(bundle.referral.membershipNumber, "DEMO-POL-9999");
  assert.equal("authorisationNumber" in bundle.referral, false, "blank → absent");
  assert.deepEqual(
    bundle.appointments.map((a) => [a.externalId, a.charge ?? null]),
    [
      ["w-a1", { amount: 70, currency: "GBP", paid: true }],
      ["w-a2", null],
      ["w-a3", { amount: 55, currency: "GBP", paid: false }],
      ["w-a4", null],
    ],
  );
  assert.equal("charge" in bundle.appointments[1], false, "null → absent");
  assert.equal(EpisodeBundleSchema.safeParse(bundle).success, true);
  // Without them (every earlier fixture), nothing new appears in the bundle.
  const plain = mapSimEpisodeToBundle(wire(), OPTS);
  for (const key of ["insurerName", "membershipNumber", "authorisationNumber"]) assert.equal(key in plain.referral, false, key);
  for (const a of plain.appointments) assert.equal("charge" in a, false);
});

test("wire: a charge must be a non-negative GBP amount with a paid flag", async () => {
  const { SimAppointmentSchema } = await import("./wire");
  const base = { ...wire().appointments[0] };
  assert.equal(SimAppointmentSchema.safeParse(base).success, true, "charge is optional");
  assert.equal(SimAppointmentSchema.safeParse({ ...base, charge: { amount: 55, currency: "GBP", paid: true } }).success, true);
  assert.equal(SimAppointmentSchema.safeParse({ ...base, charge: { amount: -1, currency: "GBP", paid: true } }).success, false);
  assert.equal(SimAppointmentSchema.safeParse({ ...base, charge: { amount: 55, currency: "EUR", paid: true } }).success, false);
  assert.equal(SimAppointmentSchema.safeParse({ ...base, charge: { amount: 55, currency: "GBP" } }).success, false);
});

test("mapper: deterministic (same input → identical bundle) and does not mutate its input", () => {
  const input = wire();
  const before = JSON.stringify(input);
  const a = mapSimEpisodeToBundle(input, OPTS);
  const b = mapSimEpisodeToBundle(wire(), OPTS);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
});

test("mapper: rejects a patient/episode mismatch and self/GP referrals with ConnectorError", () => {
  const mismatch = wire();
  mismatch.episode.patient_id = "pat-2";
  assert.throws(() => mapSimEpisodeToBundle(mismatch, OPTS), (e: unknown) => e instanceof ConnectorError && e.code === "INVALID_DATA");
  const self = wire();
  self.episode.referral.source_type = "self";
  assert.throws(() => mapSimEpisodeToBundle(self, OPTS), (e: unknown) => e instanceof ConnectorError && e.code === "UNSUPPORTED");
});
