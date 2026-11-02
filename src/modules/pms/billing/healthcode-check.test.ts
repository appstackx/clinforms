/** The "ready / needs review" check for Healthcode bills (HC11). Pure; fictional data only. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkHealthcodeBatch, checkHealthcodeInvoice, type HealthcodeInvoiceFacts } from "./healthcode-check";

function ready(over: Partial<HealthcodeInvoiceFacts> = {}): HealthcodeInvoiceFacts {
  return {
    invoiceId: "inv_1",
    number: "INV00042",
    status: "issued",
    voided: false,
    billTo: "payer",
    patientId: "pat_1",
    caseId: "case_1",
    siteId: "site_1",
    patient: { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19", postcode: "MK9 9ZZ" },
    membershipNumber: "NW-000123",
    authorisation: { code: "NW-AUTH-0001", status: "active", validFrom: "2026-10-01", expiresOn: "2026-12-31", sessionsAuthorised: 6, sessionsUsed: 2 },
    diagnosisCode: "M54.5",
    payer: { id: "ref_ins", name: "Northwell Health (fictional)", insurerCode: "nwh", providerNumber: "PRV-DEMO-1", diagnosisRequired: true },
    siteCode: "SITE-DEMO-1",
    payeeProviderNumber: "PAYEE-DEMO-1",
    lines: [
      { id: "l1", lineNo: 1, kind: "service", serviceId: "svc_ia", serviceName: "Initial assessment", serviceOn: "2026-10-20", practitionerId: "prac_1", practitionerName: "Sarah Reid", practitionerNumber: "NW-PRAC-1", iscCode: "ISC-DEMO-IA" },
      { id: "l2", lineNo: 2, kind: "service", serviceId: "svc_fu", serviceName: "Follow-up", serviceOn: "2026-10-27", practitionerId: "prac_1", practitionerName: "Sarah Reid", practitionerNumber: "NW-PRAC-1", iscCode: "ISC-DEMO-FU" },
      { id: "l3", lineNo: 3, kind: "excess_deduction", serviceId: null, serviceName: null, serviceOn: null, practitionerId: null, practitionerName: null, practitionerNumber: null, iscCode: null },
    ],
    ...over,
  };
}

const codes = (f: HealthcodeInvoiceFacts) => checkHealthcodeInvoice(f).issues.map((i) => i.code);

describe("HC11 Healthcode bill check", () => {
  it("a complete insurer invoice is ready; excess lines are not checked line by line", () => {
    const c = checkHealthcodeInvoice(ready());
    assert.deepEqual([c.ready, c.issues], [true, []]);
  });

  it("each missing fact is one plain reason with a link to fix it", () => {
    const f = ready({
      membershipNumber: null,
      patient: { firstName: "Daniel", lastName: "", dateOfBirth: null, postcode: " " },
      payer: { id: "ref_ins", name: "Northwell Health (fictional)", insurerCode: null, providerNumber: "", diagnosisRequired: true },
      siteCode: null,
      payeeProviderNumber: null,
      diagnosisCode: null,
    });
    const c = checkHealthcodeInvoice(f);
    assert.equal(c.ready, false);
    assert.deepEqual(c.issues.map((i) => i.code), ["insurer_code", "provider_number", "payee_number", "site_code", "patient_name", "patient_dob", "patient_postcode", "membership", "diagnosis_missing"]);
    for (const i of c.issues) {
      assert.ok(i.fix && i.fix.href.startsWith("/app/clinic/"), i.code);
      assert.match(i.message, /^[A-Z]/);
      assert.ok(!/null|undefined|NaN/.test(i.message), i.message);
    }
    assert.equal(c.issues.find((i) => i.code === "membership")?.fix?.href, "/app/clinic/patients/pat_1/cases/case_1");
    assert.equal(c.issues.find((i) => i.code === "insurer_code")?.fix?.href, "/app/clinic/setup/referrers?referrer=ref_ins");
    assert.equal(c.issues.find((i) => i.code === "site_code")?.fix?.href, "/app/clinic/setup/billing");
    assert.match(c.issues.find((i) => i.code === "diagnosis_missing")?.message ?? "", /needs one on every bill/);
  });

  it("diagnosis: needed only when the insurer asks; when given it must be ICD-10", () => {
    const notNeeded = ready({ diagnosisCode: null, payer: { ...ready().payer!, diagnosisRequired: false } });
    assert.equal(checkHealthcodeInvoice(notNeeded).ready, true);
    assert.deepEqual(codes(ready({ diagnosisCode: "WAD II" })), ["diagnosis_format"]);
    assert.deepEqual(codes(ready({ diagnosisCode: "WAD II", payer: { ...ready().payer!, diagnosisRequired: false } })), ["diagnosis_format"]);
  });

  it("authorisation: missing, cancelled, not in date for the treatments, over its sessions", () => {
    assert.deepEqual(codes(ready({ authorisation: null })), ["authorisation_missing"]);
    const a = ready().authorisation!;
    assert.deepEqual(codes(ready({ authorisation: { ...a, status: "cancelled" } })), ["authorisation_cancelled"]);
    assert.deepEqual(codes(ready({ authorisation: { ...a, validFrom: "2026-10-21" } })), ["authorisation_dates"]);
    const late = checkHealthcodeInvoice(ready({ authorisation: { ...a, expiresOn: "2026-10-25" } }));
    assert.deepEqual(late.issues.map((i) => i.code), ["authorisation_dates"]);
    assert.match(late.issues[0].message, /ended on 25\/10\/2026, before the last treatment \(27\/10\/2026\)/);
    assert.deepEqual(codes(ready({ authorisation: { ...a, sessionsAuthorised: 2, sessionsUsed: 2 } })), [], "used exactly = still fine");
    assert.deepEqual(codes(ready({ authorisation: { ...a, sessionsAuthorised: 2, sessionsUsed: 3 } })), ["authorisation_sessions"]);
    assert.deepEqual(codes(ready({ authorisation: { ...a, sessionsAuthorised: null, validFrom: null, expiresOn: null } })), []);
  });

  it("treatment lines: date, practitioner and their insurer number, the insurer's code; no treatments at all", () => {
    const base = ready().lines;
    const lines = [
      { ...base[0], serviceOn: null },
      { ...base[1], practitionerNumber: null, iscCode: null },
      { ...base[1], id: "l4", lineNo: 4, practitionerId: null, practitionerName: null, practitionerNumber: null, serviceId: null, serviceName: null },
    ];
    const c = checkHealthcodeInvoice(ready({ lines }));
    assert.deepEqual(c.issues.map((i) => i.code), ["service_date", "practitioner_number", "isc_code", "practitioner_missing"]);
    assert.equal(c.issues.find((i) => i.code === "practitioner_number")?.fix?.href, "/app/clinic/setup/practitioners?practitioner=prac_1");
    assert.equal(c.issues.find((i) => i.code === "isc_code")?.fix?.href, "/app/clinic/setup/insurer-codes?insurer=ref_ins");
    assert.match(c.issues.find((i) => i.code === "isc_code")?.message ?? "", /treatment code for Follow-up/);
    // The same missing practitioner number on two lines is one reason.
    const twice = checkHealthcodeInvoice(ready({ lines: base.map((l) => ({ ...l, practitionerNumber: null })) }));
    assert.equal(twice.issues.filter((i) => i.code === "practitioner_number").length, 1);
    assert.deepEqual(codes(ready({ lines: [base[2]] })), ["no_treatments"]);
  });

  it("not issued, voided or not an insurer bill", () => {
    assert.deepEqual(codes(ready({ status: "draft", number: null })), ["not_issued"]);
    assert.deepEqual(codes(ready({ voided: true })), ["not_issued"]);
    assert.deepEqual(codes(ready({ payer: null })), ["not_insurer"]);
  });

  it("a batch: ready and needs review apart; one Site ID per file", () => {
    const one = checkHealthcodeBatch([ready(), ready({ invoiceId: "inv_2" }), ready({ invoiceId: "inv_3", membershipNumber: null })]);
    assert.deepEqual([one.ready.map((c) => c.invoiceId), one.needsReview.map((c) => c.invoiceId), one.siteCodes, one.notes], [["inv_1", "inv_2"], ["inv_3"], ["SITE-DEMO-1"], []]);
    const two = checkHealthcodeBatch([ready(), ready({ invoiceId: "inv_2", siteId: "site_2", siteCode: "SITE-DEMO-2" })]);
    assert.deepEqual(two.groups, [
      { siteCode: "SITE-DEMO-1", invoiceIds: ["inv_1"] },
      { siteCode: "SITE-DEMO-2", invoiceIds: ["inv_2"] },
    ]);
    assert.match(two.notes[0], /2 Healthcode Site IDs \(SITE-DEMO-1, SITE-DEMO-2\)\. Each file holds one Site ID, so they go in 2 files\./);
    assert.deepEqual(checkHealthcodeBatch([]), { ready: [], needsReview: [], siteCodes: [], groups: [], notes: [] });
  });
});
