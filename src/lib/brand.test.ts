/** Brands by hostname (src/lib/brand.ts): one config, ClinForms unchanged on its own hosts. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCT } from "@/modules/medreport/config.public";
import { BANNED_TERM_PATTERNS } from "@/modules/medreport/core/wording";
import { PRODUCT_NAME } from "./account-copy";
import { BRANDS, CLINFORMS_NAME, CLINIC_SYSTEM_NAME, PACKAGE_LABELS, PUBLIC_SITE_BRAND, brandForHost, hostName } from "./brand";

describe("brands", () => {
  it("ClinForms keeps its name everywhere (module, account copy, public site)", () => {
    assert.equal(CLINFORMS_NAME, PRODUCT.name);
    assert.equal(PRODUCT_NAME, PRODUCT.name);
    assert.equal(PUBLIC_SITE_BRAND.productName, PRODUCT.name);
    assert.equal(PUBLIC_SITE_BRAND.publicSite, true);
  });
  it("the clinic system's placeholder name is one constant", () => {
    assert.equal(CLINIC_SYSTEM_NAME, "Clinic system");
    assert.equal(BRANDS.clinic.productName, CLINIC_SYSTEM_NAME);
    assert.equal(PACKAGE_LABELS.clinic, CLINIC_SYSTEM_NAME);
    for (const name of [CLINIC_SYSTEM_NAME, ...Object.values(PACKAGE_LABELS), ...Object.values(BRANDS).map((b) => b.productName)]) {
      assert.ok(!/\bTM3\b|care ?connect|\bPractice\b|killer/i.test(name), name);
      assert.equal(BANNED_TERM_PATTERNS.find((re) => re.test(name)), undefined, name);
    }
  });
  it("chosen by host name; unknown hosts (previews, localhost) are ClinForms", () => {
    assert.equal(brandForHost("clinforms.co.uk").id, "clinforms");
    assert.equal(brandForHost("WWW.ClinForms.co.uk:443").id, "clinforms");
    assert.equal(brandForHost("localhost:3180").id, "clinforms");
    assert.equal(brandForHost("clinforms-abc-team.vercel.app").id, "clinforms");
    assert.equal(brandForHost(null).id, "clinforms");
    assert.equal(brandForHost("clinic.localhost:3180").id, "clinic");
    assert.equal(hostName("[::1]:3000"), "[::1]");
    assert.equal(BRANDS.clinic.publicSite, false);
    assert.equal(BRANDS.clinic.appHome, "/app/clinic");
  });
  it("host lists are lower case, without ports, and never shared between brands", () => {
    const seen = new Set<string>();
    for (const b of Object.values(BRANDS)) {
      for (const h of [...b.hosts, ...b.devHosts]) {
        assert.equal(h, hostName(h), h);
        assert.ok(!seen.has(h), `${h} in two brands`);
        seen.add(h);
      }
    }
  });
});
