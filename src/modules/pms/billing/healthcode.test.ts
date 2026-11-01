/**
 * Healthcode groundwork (pure): code formats, defaults, the bill check. Run by `npm run test:db` / `test:pms`.
 * Fictional insurers and patients only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PayerHealthcodeInputSchema, diagnosisRequired, diagnosisRequiredByDefault, isHealthcodePayerKind } from "./healthcode";

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
