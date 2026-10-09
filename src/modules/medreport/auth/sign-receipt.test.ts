import { test } from "node:test";
import assert from "node:assert/strict";
import { createReceipt, verifyReceipt } from "./sign-receipt";
import { createReport } from "../core/report-factory";
import { SOLICITOR_RTA_TEMPLATE } from "../templates/registry";
import type { EpisodeBundle } from "../core/types";

const secret = "receipt-test-secret";
const bundle: EpisodeBundle = {
  tenantId: "demo",
  source: { connectorId: "tm3-sim", simulated: true, fetchedAt: "2026-10-06T09:00:00.000Z", externalPatientId: "p1", externalEpisodeId: "e1" },
  registration: { id: "REG", externalPatientId: "p1", firstName: "Test", lastName: "Patient", fullName: "Test Patient", dob: "1992-01-02", sex: "female", addressSummary: "" },
  referral: { type: "solicitor", name: "Example Solicitors (fictional)", reference: "EX/1", contactName: "", address: "" },
  clinicians: [],
  notes: [],
  appointments: [],
  outcomeMeasures: [],
  consent: { disclosureConsentRecorded: true },
  episodeStatus: "discharged",
};

test("receipt verifies, survives status/activity changes, and rejects edits and forged MACs", async () => {
  const report = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: [] });
  const receipt = await createReceipt({
    report,
    signer: { name: "S. Reid", hcpc: "PH-DEMO-01" },
    statementAccepted: true,
    attestations: [...SOLICITOR_RTA_TEMPLATE.attestations],
    now: new Date("2026-10-06T12:00:00Z"),
    secret,
  });
  const signed = { ...report, status: "signed" as const, receipt, updatedAt: "2026-10-06T12:00:01.000Z" };
  assert.deepEqual(await verifyReceipt(receipt, signed, { secret }), { ok: true, contentSha256: receipt.contentSha256 });

  const edited = structuredClone(signed);
  edited.sections[0].paragraphs[0].text += " Changed.";
  assert.deepEqual(await verifyReceipt(receipt, edited, { secret }), { ok: false, reason: "HASH_MISMATCH" });
  assert.deepEqual(await verifyReceipt({ ...receipt, signer: { name: "Someone else", hcpc: "X" } }, signed, { secret }), { ok: false, reason: "BAD_MAC" });
  assert.deepEqual(await verifyReceipt(receipt, signed, { secret: "wrong" }), { ok: false, reason: "BAD_MAC" });
});
