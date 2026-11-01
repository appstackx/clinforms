/**
 * 01/11/2026 – Khuram's R1/R2/R3 (brand journeys): the offer of the clinic system to ClinForms clinics, the brand
 * metadata of the app pages, role wording without Reports, and no "ClinForms" in the copy a ClinDesk-only clinic sees.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CLINIC_ROLE_DESCRIPTIONS, ROLE_DESCRIPTIONS, roleDescriptions } from "./account-copy";
import { ACTIVITY_ACTORS, ACTIVITY_LABELS } from "./activity-copy";
import { BRANDS, BRAND_TAGLINES, CLINFORMS_NAME, CLINIC_SYSTEM_NAME, REPORTS_ADDON_NAME, brandMetadata } from "./brand";
import { CLINDESK_OFFER, CLINDESK_OFFER_BUY_HREF, showClinDeskOffer } from "./clindesk-offer";
import { PLAN_COPY } from "./packages";
import { PRODUCT } from "../modules/medreport/config.public";

describe("R2: the clinic-system offer to a ClinForms clinic", () => {
  it("owners and admins of a ClinForms clinic without the clinic system see it; nobody else", () => {
    for (const role of ["owner", "admin"]) assert.equal(showClinDeskOffer({ clinicSystem: false, clinicBrand: "clinforms", role }), true, role);
    for (const role of ["clinician", "staff", "other"]) assert.equal(showClinDeskOffer({ clinicSystem: false, clinicBrand: "clinforms", role }), false, role);
    assert.equal(showClinDeskOffer({ clinicSystem: true, clinicBrand: "clinic", role: "owner" }), false, "has it already");
    assert.equal(showClinDeskOffer({ clinicSystem: false, clinicBrand: "clinic", role: "owner" }), false, "a ClinDesk clinic before payment");
  });
  it("names the full clinic system, leads to its plans on Plan and billing and to its features page", () => {
    assert.match(CLINDESK_OFFER.title, new RegExp(CLINIC_SYSTEM_NAME));
    assert.match(CLINDESK_OFFER.pitch, /diary/);
    assert.match(CLINDESK_OFFER.pitch, /patient portal/);
    assert.match(CLINDESK_OFFER.pitch, /text reminders/);
    assert.equal(CLINDESK_OFFER_BUY_HREF, "/app/settings/billing?product=clindesk");
    assert.equal(CLINDESK_OFFER.infoHref, `${BRANDS.clinic.siteUrl}/features`);
    const text = Object.values(CLINDESK_OFFER).flat().join(" ");
    assert.doesNotMatch(text, /\b(AI|Claude|Anthropic|Stripe|Twilio|TM3)\b/);
  });
});

describe("R3: brand metadata", () => {
  it("each brand's pages carry its own application name, share-card name and base URL", () => {
    for (const brand of Object.values(BRANDS)) {
      const m = brandMetadata(brand);
      assert.equal(m.applicationName, brand.productName);
      assert.equal(m.openGraph.siteName, brand.productName);
      assert.equal(m.twitter.title, brand.productName);
      assert.equal(m.metadataBase.origin, brand.siteUrl);
    }
    assert.equal(BRAND_TAGLINES.clinforms, PRODUCT.tagline);
    assert.doesNotMatch(BRAND_TAGLINES.clinic, new RegExp(CLINFORMS_NAME));
  });
});

describe("R1: copy a ClinDesk-only clinic sees", () => {
  it("the Reports add-on is named without ClinForms", () => {
    assert.equal(REPORTS_ADDON_NAME, "Reports");
  });
  it("role descriptions without Reports talk about the clinic, not forms", () => {
    assert.equal(roleDescriptions(true), ROLE_DESCRIPTIONS);
    assert.equal(roleDescriptions(false), CLINIC_ROLE_DESCRIPTIONS);
    for (const text of Object.values(CLINIC_ROLE_DESCRIPTIONS)) assert.doesNotMatch(text, /\bforms?\b|API keys/i);
  });
  it("activity labels and actors, and the plan copy, never name ClinForms", () => {
    for (const [code, label] of Object.entries(ACTIVITY_LABELS)) assert.doesNotMatch(label, /ClinForms/, code);
    for (const label of Object.values(ACTIVITY_ACTORS)) assert.doesNotMatch(String(label), /ClinForms/);
    assert.doesNotMatch(PLAN_COPY.noPackage, /ClinForms/);
  });

  /** Screens a ClinDesk-only clinic can open: code (not comments) must not type "ClinForms" (use a constant by brand). */
  const SCREENS = [
    "src/app/app/clinic",
    "src/components/pms",
    "src/server/pms/access-screens.ts",
    "src/server/pms/integration/referrer-forms.ts",
    "src/server/pms/portal/human-check.ts",
    "src/app/app/(clinic)/page.tsx",
    "src/app/app/(clinic)/layout.tsx",
    "src/app/app/(clinic)/settings/api-keys",
    "src/app/app/(clinic)/settings/clinic",
    "src/app/app/(clinic)/settings/members",
    "src/app/app/(clinic)/settings/security",
    "src/app/app/(clinic)/settings/activity",
    "src/app/app/(clinic)/settings/billing",
    "src/app/app/studio/layout.tsx",
    "src/app/app/studio/page.tsx",
  ];
  const files = (p: string): string[] => {
    const full = path.resolve(p);
    if (!fs.existsSync(full)) return [];
    if (fs.statSync(full).isFile()) return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
    return fs.readdirSync(full).flatMap((e) => files(path.join(p, e)));
  };
  it("no hard-coded \"ClinForms\" in those screens' code", () => {
    const hits: string[] = [];
    for (const file of SCREENS.flatMap(files)) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
          const code = line.replace(/\/\/.*$/, "").replace(/\{?\/\*.*?\*\/\}?/g, "");
          if (/ClinForms/.test(code)) hits.push(`${file}:${i + 1}`);
        });
    }
    assert.deepEqual(hits, []);
  });
});
