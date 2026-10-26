/** Merge fields for letters (src/modules/pms/integration/merge-fields.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMergeToText, buildMergeValues, longUkDate, mergeNameKey, mergeReportProblems, MERGE_FIELDS, resolveMergeName, type MergeData, type MergeReport } from "./merge-fields";

const DATA: MergeData = {
  today: "2026-10-24",
  clinic: { name: "Riverside Physiotherapy (fictional)", address: { lines: ["2 Station Parade (fictional)", "Bletchley"], postcode: "MK2 9ZZ" }, phone: "01632 960101", email: "hello@riverside-demo.example.com" },
  site: { name: "Bletchley (fictional)", address: { lines: ["2 Station Parade (fictional)"], postcode: "MK2 9ZZ" }, phone: "01632 960101" },
  patient: {
    patientNumber: 1,
    title: "Mrs",
    firstName: "Megan",
    lastName: "Hart",
    dateOfBirth: "1991-03-14",
    address: { lines: ["4 Willow Bank", "Bletchley", "Milton Keynes"], postcode: "MK3 9ZZ" },
    phoneMobile: "07700 900123",
    phoneHome: null,
    email: "megan.hart@example.com",
    occupation: "Office administrator",
    employer: null,
    gpName: null,
    gpPractice: "Bletchley Medical Centre (fictional)",
  },
  case: { title: "Neck pain after a road traffic accident", openedOn: "2026-03-18", closedOn: null, status: "open", claimReference: "HP/RTA/2291", membershipNumber: null, injuryOn: "2026-03-02", referralReceivedOn: "2026-03-10" },
  authorisation: { code: "NW-55321", sessionsAuthorised: 6, sessionsUsed: 4, expiresOn: "2026-12-31" },
  payer: { name: "Harrow & Pike Solicitors (fictional)", contactName: "Amelia Grant", address: { lines: ["3 Silbury Arcade (fictional)", "Milton Keynes"], postcode: "MK9 0ZZ" }, email: null, phone: "01632 960221" },
  referrer: { name: "Bletchley Medical Centre (fictional)" },
  practitioner: { name: "Sarah Reid", registrationNumber: "PH-DEMO-01", profession: "physiotherapist" },
  appointments: { firstDate: "2026-03-18", lastAttendedDate: "2026-07-07", next: { date: "2026-10-28", time: "09:30", site: "Bletchley (fictional)" }, attended: 10, didNotAttend: 1 },
  invoices: { latest: { number: "INV-1042", issuedOn: "2026-07-07", totalPence: 65000 }, balancePence: 13000 },
};

describe("merge field names", () => {
  it("every field key is unique and resolves to itself", () => {
    const keys = MERGE_FIELDS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const k of keys) assert.equal(resolveMergeName(k), k, k);
  });
  it("common template names match regardless of case, spaces, underscores and CamelCase", () => {
    assert.equal(mergeNameKey("PatientName"), "patient name");
    assert.equal(mergeNameKey("PatientDOB"), "patient dob");
    for (const [name, key] of [
      ["Patient_Name", "patient.fullName"],
      ["PATIENT NAME", "patient.fullName"],
      ["Forename", "patient.firstName"],
      ["DOB", "patient.dateOfBirth"],
      ["DateOfAccident", "case.injuryOn"],
      ["Your Ref", "case.claimReference"],
      ["HCPC", "practitioner.registrationNumber"],
      ["Insurer", "payer.name"],
      ["Today", "today.date"],
      ["Sessions Attended", "appointments.attended"],
      ["Address1", "patient.address1"],
    ] as const) {
      assert.equal(resolveMergeName(name), key, name);
    }
    assert.equal(resolveMergeName("Flux Capacitor"), null, "an unknown name is not guessed");
    assert.equal(resolveMergeName("Flux Capacitor", { "flux capacitor": "patient.email" }), "patient.email", "staff's own choice");
    assert.equal(resolveMergeName("Flux Capacitor", { "flux capacitor": "not.a.field" }), null);
  });
});

describe("merge values", () => {
  it("UK formats; addresses on one line; sessions remaining; the clinic and today", () => {
    const v = buildMergeValues(DATA);
    assert.equal(v["patient.fullName"], "Megan Hart");
    assert.equal(v["patient.salutation"], "Dear Mrs Hart");
    assert.equal(v["patient.dateOfBirth"], "14/03/1991");
    assert.equal(v["patient.age"], "35");
    assert.equal(v["patient.address"], "4 Willow Bank, Bletchley, Milton Keynes, MK3 9ZZ");
    assert.equal(v["patient.address3"], "Milton Keynes");
    assert.equal(v["case.injuryOn"], "02/03/2026");
    assert.equal(v["case.sessionsRemaining"], "2");
    assert.equal(v["payer.address"], "3 Silbury Arcade (fictional), Milton Keynes, MK9 0ZZ");
    assert.equal(v["practitioner.profession"], "Physiotherapist");
    assert.equal(v["appointments.nextDate"], "28/10/2026");
    assert.equal(v["invoices.latestTotal"], "£650.00");
    assert.equal(v["invoices.balance"], "£130.00");
    assert.equal(v["today.date"], "24/10/2026");
    assert.equal(v["today.long"], "24 October 2026");
    assert.equal(longUkDate("2026-01-05"), "5 January 2026");
  });
  it("a letter about the patient only: case, payer and appointment fields are empty", () => {
    const v = buildMergeValues({ ...DATA, case: null, payer: null, authorisation: null, appointments: null, invoices: null, practitioner: null, referrer: null });
    assert.equal(v["case.claimReference"], "");
    assert.equal(v["payer.name"], "");
    assert.equal(v["patient.lastName"], "Hart");
  });
});

describe("filling text", () => {
  it("fills «Name» and <<Name>>, keeps unknown names as they are and reports empty ones", () => {
    const report: MergeReport = { fields: [] };
    const out = applyMergeToText("Dear «Title» «Surname», re: <<Claim No>> (DOB «DOB»). «Mystery» «Employer»", buildMergeValues(DATA), report);
    assert.equal(out, "Dear Mrs Hart, re: HP/RTA/2291 (DOB 14/03/1991). «Mystery» ");
    assert.deepEqual(mergeReportProblems(report), { unknown: ["Mystery"], empty: ["Employer"] });
    assert.equal(report.fields.find((f) => f.name === "Surname")?.key, "patient.lastName");
  });
  it("text without merge fields is unchanged", () => {
    const report: MergeReport = { fields: [] };
    assert.equal(applyMergeToText("Plain text with << spaces >> and « » only", buildMergeValues(DATA), report), "Plain text with << spaces >> and « » only");
    assert.deepEqual(report.fields, []);
  });
});
