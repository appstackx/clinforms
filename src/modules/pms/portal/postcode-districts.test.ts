import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { milesBetween } from "./distance";
import { districtCentre, loadDistrictCentres, postcodeDistrict } from "./postcode-districts";

describe("postcode districts (bundled ONS centres)", () => {
  it("reads the district of a full or partial postcode", () => {
    assert.equal(postcodeDistrict("mk9 2zz"), "MK9");
    assert.equal(postcodeDistrict("SW1A1AA"), "SW1A");
    assert.equal(postcodeDistrict(" eh1 "), "EH1");
    assert.equal(postcodeDistrict("Milton Keynes"), null);
  });

  it("places any GB district; Northern Ireland and unknown districts are not placed", async () => {
    const c = await loadDistrictCentres();
    assert.ok(c);
    assert.ok(Object.keys(c).length > 2800);
    const mk3 = districtCentre(c, "MK3");
    const sw1a = districtCentre(c, "SW1A");
    assert.ok(mk3 && sw1a);
    const miles = milesBetween(mk3, sw1a);
    assert.ok(miles > 40 && miles < 50, `MK3 → SW1A ${miles}`);
    assert.equal(districtCentre(c, "BT1"), null);
    assert.equal(districtCentre(c, "ZZ99"), null);
  });
});
