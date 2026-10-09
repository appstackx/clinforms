import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, canonicalize, reportFingerprint, sha256Hex, shortFingerprint } from "./fingerprint";
import type { Report } from "./types";

test("canonicalize sorts keys, drops undefined and keeps array order", () => {
  assert.equal(canonicalize({ b: 1, a: [3, undefined, "x"], c: undefined, d: { z: true, y: null } }), '{"a":[3,null,"x"],"b":1,"d":{"y":null,"z":true}}');
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.throws(() => canonicalize({ n: Number.NaN }));
});

test("sha256Hex matches the known digest of 'abc'", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

function minimalReport(): Report {
  const at = "2026-10-06T09:00:00.000Z";
  return {
    id: "rpt_test",
    tenantId: "demo",
    templateId: "solicitor-rta-treating-physio",
    templateVersion: "1.0.0",
    patientLabel: "Test Patient",
    episodeRef: { connectorId: "tm3-sim", patientId: "p1", episodeId: "e1" },
    instructingParty: { type: "solicitor", name: "Example Solicitors (fictional)", reference: "EX/1", contactName: "", address: "" },
    bundleSnapshot: {
      tenantId: "demo",
      source: { connectorId: "tm3-sim", simulated: true, fetchedAt: at, externalPatientId: "p1", externalEpisodeId: "e1" },
      registration: { id: "REG", externalPatientId: "p1", firstName: "Test", lastName: "Patient", fullName: "Test Patient", dob: "1992-01-02", sex: "female", addressSummary: "Milton Keynes" },
      referral: { type: "solicitor", name: "Example Solicitors (fictional)", reference: "EX/1", contactName: "", address: "" },
      clinicians: [],
      notes: [],
      appointments: [],
      outcomeMeasures: [],
      consent: { disclosureConsentRecorded: true },
      episodeStatus: "discharged",
    },
    sections: [{ key: "prognosis", title: "Prognosis", kind: "clinician_opinion", status: "complete", paragraphs: [{ id: "p1", text: "Recorded view.", sourceIds: ["N-001"], origin: "clinician" }] }],
    gaps: [],
    flags: [],
    status: "draft",
    generation: [],
    activity: [],
    createdAt: at,
    updatedAt: at,
  };
}

test("fingerprint ignores receipt, status, updatedAt, activity and flags but tracks content", async () => {
  const report = minimalReport();
  const base = await reportFingerprint(report);
  assert.match(base, /^[0-9a-f]{64}$/);

  const signedLater: Report = {
    ...report,
    status: "signed",
    updatedAt: "2026-10-07T10:00:00.000Z",
    activity: [{ at: "2026-10-07T10:00:00.000Z", actor: "Clinician", action: "signed", detail: "Signed" }],
    flags: [{ id: "f1", code: "DATA_CHECK", severity: "warning", message: "x" }],
    receipt: {
      reportId: report.id,
      tenantId: "demo",
      contentSha256: base,
      signer: { name: "S. Reid", hcpc: "PH-DEMO-01" },
      signedAt: "2026-10-07T10:00:00.000Z",
      statementAccepted: true,
      attestations: [],
      mac: "x",
    },
  };
  assert.equal(await reportFingerprint(signedLater), base);
  assert.ok(!canonicalJson(signedLater).includes("receipt"));

  const edited = structuredClone(report);
  edited.sections[0].paragraphs[0].text = "Recorded view, edited.";
  assert.notEqual(await reportFingerprint(edited), base);
  assert.equal(shortFingerprint("ba7816bf8f01cfea4141"), "BA78 16BF 8F01");
});
