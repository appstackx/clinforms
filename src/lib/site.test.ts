/** Company details (src/lib/site.ts COMPANY, Khuram 01/11/2026): exact registered name, number, ICO and office. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPANY_NAME } from "@/lib/account-copy";
import { CLINDESK_CONTENT } from "@/lib/clindesk/content";
import { COMPANY, companyRegistrationLine, registeredOfficeLine } from "@/lib/site";

describe("COMPANY", () => {
  it("Appstack X Ltd (the exact Companies House name), number 16287309, England and Wales; brand and domain unchanged", () => {
    assert.equal(COMPANY.legalName, "Appstack X Ltd");
    assert.equal(COMPANY_NAME, "Appstack X Ltd", "emails use the same name");
    assert.equal(COMPANY.brand, "AppStackX");
    assert.equal(COMPANY.website, "https://appstackx.co.uk");
    assert.equal(COMPANY.registeredNumber, "16287309");
    assert.equal(COMPANY.registeredIn, "England and Wales");
    assert.equal(COMPANY.icoRegistration, "ZC135044");
    assert.equal(companyRegistrationLine(), "Registered in England and Wales, company number 16287309.");
  });
  it("the registered office is a footer line only, never part of the registration line on the legal pages", () => {
    assert.equal(registeredOfficeLine(), "Registered office: 18 Westergate Avenue, Milton Keynes, MK10 7LQ");
    assert.ok(!/registered office/i.test(companyRegistrationLine() ?? ""));
    assert.equal(registeredOfficeLine({ ...COMPANY, registeredAddress: undefined }), null);
  });
  it("ClinDesk's content file carries the same company number and registered office", () => {
    assert.equal(CLINDESK_CONTENT.values["company.number"].value, COMPANY.registeredNumber);
    assert.equal(CLINDESK_CONTENT.values["company.registeredOffice"].value, COMPANY.registeredAddress);
  });
});
