/**
 * 01/11/2026 – Khuram's R2/R3 on Plan and billing: a running ClinForms plan can move to ClinDesk (the matching
 * Reports add-on preselected), and billing notice links go to the host of the brand the email speaks for.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingLinkTarget } from "./notify";
import { addonForTier, offeredProduct } from "./views";

describe("offeredProduct", () => {
  it("no running plan: the page's choice", () => {
    assert.equal(offeredProduct(null, "clinforms"), "clinforms");
    assert.equal(offeredProduct(null, "clindesk"), "clindesk");
  });
  it("a running plan keeps its product, except a ClinForms plan asked to move to ClinDesk", () => {
    assert.equal(offeredProduct({ product: "clinforms", tier: "starter" }, "clindesk"), "clinforms");
    assert.equal(offeredProduct({ product: "clinforms", tier: "starter" }, "clindesk", true), "clindesk");
    assert.equal(offeredProduct({ product: "clindesk", band: "solo", interval: "month", reports: null }, "clinforms", true), "clindesk");
  });
  it("the Reports add-on with the same allowance as each ClinForms tier", () => {
    assert.equal(addonForTier("starter"), "25");
    assert.equal(addonForTier("practice"), "100");
    assert.equal(addonForTier("group"), "250");
    assert.equal(addonForTier("group_plus"), "500");
  });
});

describe("billing notice links (notify.ts)", () => {
  const prod = { BETTER_AUTH_URL: "https://clinforms.co.uk", CLINFORMS_AUTH_ORIGINS: "https://clindesk.co.uk" };
  it("a ClinForms clinic's email links to ClinForms' host, a ClinDesk clinic's to ClinDesk's", () => {
    assert.deepEqual(billingLinkTarget(prod, "clinforms"), { origin: "https://clinforms.co.uk", brand: "clinforms" });
    assert.deepEqual(billingLinkTarget(prod, "clinic"), { origin: "https://clindesk.co.uk", brand: "clinic" });
  });
  it("a deployment without the clinic brand's host speaks for ClinForms on its own origin; APP_ORIGIN still overrides", () => {
    assert.deepEqual(billingLinkTarget({ BETTER_AUTH_URL: "https://clinforms.co.uk" }, "clinic"), { origin: "https://clinforms.co.uk", brand: "clinforms" });
    assert.deepEqual(billingLinkTarget({ ...prod, APP_ORIGIN: "http://localhost:3000" }, "clinforms"), { origin: "http://localhost:3000", brand: "clinforms" });
  });
});
