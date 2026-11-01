/** ClinForms company details (src/lib/site.ts): the registration line shows the company number, never an address. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPANY, companyRegistrationLine } from "@/lib/site";

describe("COMPANY (clinforms.co.uk)", () => {
  it("AppstackX Ltd, company number 16287309, registered in England and Wales (Khuram 01/11/2026)", () => {
    assert.equal(COMPANY.registeredNumber, "16287309");
    assert.equal(COMPANY.registeredIn, "England and Wales");
    assert.equal(companyRegistrationLine(), "Registered in England and Wales, company number 16287309.");
  });
  it("no registered office on the website (Khuram 01/11/2026)", () => {
    assert.equal(COMPANY.registeredAddress, undefined);
    assert.ok(!/registered office/i.test(companyRegistrationLine() ?? ""));
  });
});
