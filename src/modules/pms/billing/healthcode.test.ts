/**
 * Healthcode groundwork (pure): code formats, defaults, the bill check. Run by `npm run test:db` / `test:pms`.
 * Fictional insurers and patients only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEALTHCODE_BILL_STATUSES,
  HEALTHCODE_BILL_STATUS_HINTS,
  HEALTHCODE_BILL_STATUS_LABELS,
  HEALTHCODE_FILE_OFF_NOTE,
  HEALTHCODE_FILE_SUBMISSION_ENABLED,
  NO_HEALTHCODE_SETTINGS,
  PayerHealthcodeInputSchema,
  TreatmentCodeSchema,
  billStatusLabel,
  diagnosisRequired,
  diagnosisRequiredByDefault,
  healthcodeForSite,
  isHealthcodeBillStatus,
  isHealthcodePayerKind,
} from "./healthcode";

describe("HC06 payer Healthcode details", () => {
  it("accepts an insurer identifier and a provider number, blanks become null, refuses odd characters", () => {
    const ok = PayerHealthcodeInputSchema.parse({ insurerCode: " bup ", providerNumber: "PRV-DEMO/01", diagnosisRequired: null });
    assert.deepEqual(ok, { insurerCode: "bup", providerNumber: "PRV-DEMO/01", diagnosisRequired: null });
    assert.deepEqual(PayerHealthcodeInputSchema.parse({ insurerCode: "", providerNumber: "  " }), { insurerCode: null, providerNumber: null });
    assert.equal(PayerHealthcodeInputSchema.safeParse({ insurerCode: "b" }).success, false);
    assert.equal(PayerHealthcodeInputSchema.safeParse({ insurerCode: "bup!" }).success, false);
    assert.equal(PayerHealthcodeInputSchema.safeParse({ providerNumber: "has space" }).success, false);
    assert.equal(PayerHealthcodeInputSchema.safeParse({ providerNumber: "x".repeat(31) }).success, false);
  });

  it("a diagnosis code is needed by default for Bupa, AXA Health and Vitality; the clinic's choice wins", () => {
    for (const name of ["Bupa", "AXA Health", "Vitality Health", "bupa global"]) assert.equal(diagnosisRequiredByDefault(name), true, name);
    for (const name of ["Aviva", "WPA", "Cigna Healthcare", "Northwell Health (fictional)", "Bupaland (fictional)"]) assert.equal(diagnosisRequiredByDefault(name), false, name);
    assert.equal(diagnosisRequired("Aviva", true), true);
    assert.equal(diagnosisRequired("Bupa", false), false);
    assert.equal(diagnosisRequired("Bupa", null), true);
    assert.equal(isHealthcodePayerKind("insurer"), true);
    assert.equal(isHealthcodePayerKind("solicitor"), false);
  });
});

describe("HC07–HC13 Healthcode settings, codes, file switch and bill status", () => {
  it("a site uses its own Site ID / payee number, else the clinic's", () => {
    const s = { ...NO_HEALTHCODE_SETTINGS, clinic: { siteCode: "SITE-1", payeeProviderNumber: "PAY-1" }, sites: { s2: { siteCode: "SITE-2", payeeProviderNumber: null } } };
    assert.deepEqual(healthcodeForSite(s, "s2"), { siteCode: "SITE-2", payeeProviderNumber: "PAY-1" });
    assert.deepEqual(healthcodeForSite(s, "s3"), { siteCode: "SITE-1", payeeProviderNumber: "PAY-1" });
    assert.deepEqual(healthcodeForSite(NO_HEALTHCODE_SETTINGS, null), { siteCode: null, payeeProviderNumber: null });
  });

  it("treatment codes: letters, digits, . and -; blank = none", () => {
    assert.equal(TreatmentCodeSchema.parse(" ISC-1.2 "), "ISC-1.2");
    assert.equal(TreatmentCodeSchema.parse(""), null);
    assert.equal(TreatmentCodeSchema.safeParse("a b").success, false);
  });

  it("the Healthcode file stays off, with the agreed note", () => {
    assert.equal(HEALTHCODE_FILE_SUBMISSION_ENABLED, false);
    assert.equal(HEALTHCODE_FILE_OFF_NOTE, "Available once Healthcode file submission is switched on");
  });

  it("bill statuses: the five, each with a label and a hint; none = not sent yet", () => {
    assert.deepEqual([...HEALTHCODE_BILL_STATUSES], ["exported", "validated", "failed", "collected", "paid"]);
    for (const s of HEALTHCODE_BILL_STATUSES) assert.ok(HEALTHCODE_BILL_STATUS_LABELS[s] && HEALTHCODE_BILL_STATUS_HINTS[s], s);
    assert.equal(billStatusLabel(null), "Not sent yet");
    assert.equal(billStatusLabel("paid"), "Paid");
    assert.equal(isHealthcodeBillStatus("lost"), false);
  });
});
