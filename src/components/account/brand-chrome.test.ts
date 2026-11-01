/**
 * Brand leaks on the clinic brand's host (Khuram's report, 01/11/2026): the tab icon, the mark in the app's header and
 * sign-in card, and the contact address follow the HOST's brand (src/lib/brand.ts) – ClinForms' hosts unchanged.
 * Rendered with react-dom/server; the page sources are checked for the wiring (they need a request to render).
 */
import * as React from "react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BRANDS, CLINIC_SYSTEM_NAME, brandContactEmail, brandForHost, brandIcons } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";
import { trialBanner } from "@/lib/trial-copy";
import { AuthShell, BrandMark } from "./shell";
import { TrialBannerBar } from "./trial-banner";

(globalThis as unknown as { React: typeof React }).React = React;

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("brand chrome per host", () => {
  it("contact email per brand: ClinForms' is COMPANY.contactEmail, the clinic brand's its own inbox", () => {
    assert.equal(BRANDS.clinforms.contactEmail, COMPANY.contactEmail);
    assert.equal(BRANDS.clinforms.contactEmail, "hello@clinforms.co.uk");
    assert.equal(BRANDS.clinic.contactEmail, "hello@clindesk.co.uk");
    assert.equal(CONTACT_EMAIL, BRANDS.clinic.contactEmail, "the clinic brand's website uses the same address");
    assert.equal(brandForHost("clindesk.co.uk").contactEmail, "hello@clindesk.co.uk");
    assert.equal(brandForHost("clinic.localhost:3180").contactEmail, "hello@clindesk.co.uk");
    assert.equal(brandForHost("clinforms.co.uk").contactEmail, "hello@clinforms.co.uk");
    assert.equal(brandContactEmail("clinic"), "hello@clindesk.co.uk");
    assert.equal(brandContactEmail(null), COMPANY.contactEmail);
  });

  it("tab icons: none of its own for ClinForms (the root's icon.svg), the clinic brand's mark on its hosts", () => {
    assert.equal(brandIcons(BRANDS.clinforms), undefined);
    const icons = brandIcons(brandForHost("clindesk.co.uk"));
    assert.deepEqual(icons, {
      icon: [{ url: "/clindesk/favicon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/clindesk/apple-touch-icon.png", sizes: "180x180" }],
    });
    assert.deepEqual(clindeskMetadata({ path: "/", title: "t", description: "d" }).icons, icons, "same icons as the website");
    for (const f of ["/clindesk/favicon.svg", "/clindesk/apple-touch-icon.png"]) assert.ok(fs.existsSync(path.join(ROOT, "public", f)), f);
    assert.ok(fs.existsSync(path.join(ROOT, "src/app/icon.svg")), "ClinForms' icon stays");
  });

  it("the sign-in, signed-in and 404 layouts name the host brand's icons", () => {
    for (const f of ["src/app/(auth)/layout.tsx", "src/app/app/layout.tsx", "src/app/not-found.tsx"]) {
      const src = read(f);
      assert.match(src, /brandIcons\(brand\)/, f);
      assert.match(src, /\.\.\.\(icons \? \{ icons \} : \{\}\)/, f);
    }
    // Pages below /app that set metadata of their own never name another icon (they inherit /app's).
    for (const f of ["src/app/app/clinic/layout.tsx", "src/app/app/studio/layout.tsx"]) assert.doesNotMatch(read(f), /icons:/, f);
  });

  it("the mark: ClinForms' document mark by default, the clinic system's crossed tapes for the clinic brand", () => {
    const forms = renderToStaticMarkup(createElement(BrandMark, { name: "ClinForms" }));
    assert.match(forms, /data-brand="clinforms"/);
    assert.match(forms, /#0D9488/, "ClinForms' teal document");
    assert.doesNotMatch(forms, /data-mark="clinic"/);
    const desk = renderToStaticMarkup(createElement(BrandMark, { name: CLINIC_SYSTEM_NAME, brand: "clinic" }));
    assert.match(desk, /data-brand="clinic"/);
    assert.match(desk, /data-mark="clinic"/);
    assert.match(desk, /#0B6B65/);
    assert.match(desk, /#C4432B/);
    assert.doesNotMatch(desk, /#0D9488/, "no ClinForms mark next to the clinic system's name");
    assert.ok(desk.includes(CLINIC_SYSTEM_NAME));
  });

  it("the sign-in card shows the host brand's mark and name", () => {
    const desk = renderToStaticMarkup(AuthShell({ title: "Sign in", brand: BRANDS.clinic, children: "x" }));
    assert.match(desk, /data-mark="clinic"/);
    assert.ok(desk.includes(`aria-label="${CLINIC_SYSTEM_NAME} home"`));
    const forms = renderToStaticMarkup(AuthShell({ title: "Sign in", brand: BRANDS.clinforms, children: "x" }));
    assert.doesNotMatch(forms, /data-mark="clinic"/);
    assert.match(forms, /#0D9488/);
    // Every sign-in page passes the host's brand (not only its name).
    for (const f of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/reset-password/page.tsx", "src/app/(auth)/accept-invite/page.tsx", "src/app/(auth)/two-factor/page.tsx", "src/app/app/select-clinic/page.tsx"]) {
      const src = read(f);
      assert.doesNotMatch(src, /<AuthShell productName=/, f);
      assert.match(src, /<AuthShell brand=\{/, f);
    }
    assert.match(read("src/app/app/(clinic)/layout.tsx"), /<BrandMark compact name=\{brand\.productName\} brand=\{brand\.id\} \/>/);
    assert.match(read("src/app/app/clinic/layout.tsx"), /mark=\{brand\.id === "clinic" \? <ClinicSystemMark/);
  });

  it("the trial banner names the contact it is given (the host brand's)", () => {
    const ended = { state: "trial_ended", endedAt: "2026-10-01T00:00:00.000Z" } as never;
    assert.ok(trialBanner(ended, BRANDS.clinic.contactEmail));
    const desk = renderToStaticMarkup(createElement(TrialBannerBar, { access: ended, contactEmail: BRANDS.clinic.contactEmail }));
    assert.ok(desk.includes("mailto:hello@clindesk.co.uk"));
    assert.doesNotMatch(desk, /hello@clinforms\.co\.uk/);
    const forms = renderToStaticMarkup(createElement(TrialBannerBar, { access: ended }));
    assert.ok(forms.includes("mailto:hello@clinforms.co.uk"), "default: ClinForms'");
  });

  it("no app or sign-in screen shows ClinForms' contact directly (they use the host brand's)", () => {
    const screens = [
      "src/app/app/(clinic)/settings/plan/page.tsx",
      "src/app/app/(clinic)/settings/billing/page.tsx",
      "src/app/app/(clinic)/settings/security/page.tsx",
      "src/app/(auth)/reset-password/page.tsx",
      "src/app/(auth)/reset-password/forms.tsx",
    ];
    for (const f of screens) {
      const src = read(f);
      assert.doesNotMatch(src, /COMPANY\.contactEmail/, f);
      assert.doesNotMatch(src, /hello@clinforms/, f);
    }
    assert.match(read("src/app/app/(clinic)/settings/plan/page.tsx"), /Questions about your package: \{currentBrand\(\)\.contactEmail\}/);
    assert.match(read("src/app/app/studio/layout.tsx"), /supportEmail=\{contactEmail\}/);
    assert.match(read("src/app/api/_medreport-glue.ts"), /withContactEmail\(await loadClinicProfile\(getDb\(\), tenantId\), currentBrand\(\)\.contactEmail\)/);
  });
});
