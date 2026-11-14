/**
 * Two public websites on one deployment (src/lib/brand.ts, src/middleware.ts): ClinForms' site stays exactly as it
 * was on clinforms.co.uk (brand, robots, sitemap, no analytics change), and ClinDesk's site (src/app/clindesk-site)
 * has its own pages, robots, sitemap and metadata on clindesk.co.uk only.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as clindeskRobots } from "@/app/clindesk-site/robots.txt/route";
import { GET as clindeskSitemap } from "@/app/clindesk-site/sitemap.xml/route";
import { analyticsAllowedOnHost } from "@/components/consent/consent";
import { BRANDS, PUBLIC_SITE_BRAND, brandForHost } from "@/lib/brand";
import { SITE_COOKIE, SITE_COOKIE_MAX_AGE } from "@/components/pms/shell/site-cookie";
import { BANNED_TERM_PATTERNS } from "@/modules/medreport/core/wording";
import { CONSENT_COOKIE, STATS_COOKIE } from "@/components/consent/consent";
import { DEMO_SENT_KEY } from "@/components/ads/google-ads";
import { GOOGLE_ADS_FIRST_PARTY_COOKIES } from "@/components/marketing/ads-cookies";
import { TO_CONFIRM } from "@/lib/clindesk/content";
import { CLINDESK_PAGES, CLINDESK_SITE_URL, clindeskMetadata } from "@/lib/clindesk/site";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { DEVICE_COOKIE } from "@/server/pms/portal/device-flow";
import { PORTAL_COOKIE } from "@/server/pms/portal/portal-auth";
import { MANAGE_COOKIE } from "@/server/pms/portal/public-page";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";
import { CLINDESK_SITE_PATHS, PUBLIC_SITE_PATHS } from "@/middleware";

const ROOT = path.resolve(__dirname, "../../..");

/** "a, b:where(c, d)" → ["a", "b:where(c, d)"] (commas inside brackets do not split). */
function topLevelSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...out, cur];
}

describe("clinforms.co.uk is unchanged", () => {
  it("robots.txt: the same rules as before ClinDesk", () => {
    assert.deepEqual(robots(), {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/reports", "/pms-sandbox", "/api", "/clinics", "/login", "/two-factor", "/accept-invite", "/reset-password", "/ingest"],
      },
      sitemap: "https://clinforms.co.uk/sitemap.xml",
      host: "https://clinforms.co.uk",
    });
  });
  it("sitemap.xml: the same seven pages, dates and priorities", () => {
    assert.deepEqual(sitemap(), [
      { url: "https://clinforms.co.uk", lastModified: "2026-11-01", changeFrequency: "monthly", priority: 1 },
      { url: "https://clinforms.co.uk/demo", lastModified: "2026-10-10", changeFrequency: "monthly", priority: 0.9 },
      { url: "https://clinforms.co.uk/request-access", lastModified: "2026-11-01", changeFrequency: "yearly", priority: 0.8 },
      { url: "https://clinforms.co.uk/security", lastModified: "2026-11-01", changeFrequency: "monthly", priority: 0.7 },
      // 01/11/2026: company name, number and ICO registration on every page (footer) and the legal pages.
      { url: "https://clinforms.co.uk/privacy", lastModified: "2026-11-08", changeFrequency: "yearly", priority: 0.4 },
      { url: "https://clinforms.co.uk/cookies", lastModified: "2026-11-08", changeFrequency: "yearly", priority: 0.3 },
      // 14/11/2026: the terms' liability limit (£600) and 3-month claim notice.
      { url: "https://clinforms.co.uk/terms", lastModified: "2026-11-14", changeFrequency: "yearly", priority: 0.3 },
    ]);
  });
  it("its hosts keep the ClinForms brand, site and analytics; its public pages list is unchanged", () => {
    for (const host of ["clinforms.co.uk", "www.clinforms.co.uk", "localhost:3180", "clinforms-git-x.vercel.app", null]) {
      assert.equal(brandForHost(host).id, "clinforms");
      assert.equal(analyticsAllowedOnHost(host), true, String(host));
    }
    assert.equal(SITE_URL, "https://clinforms.co.uk");
    assert.equal(PUBLIC_SITE_BRAND.productName, "ClinForms");
    assert.deepEqual([...PUBLIC_SITE_PATHS], ["/", "/demo", "/privacy", "/cookies", "/terms", "/security", "/request-access"]);
    assert.deepEqual(PUBLIC_PAGES.map((p) => p.path), ["/", "/demo", "/request-access", "/security", "/privacy", "/cookies", "/terms"]);
  });
  it("ClinForms' marketing pages are not edited by this site, and ClinDesk's site no longer imports them", () => {
    for (const f of ["src/app/(marketing)/layout.tsx", "src/app/(marketing)/page.tsx", "src/app/(marketing)/privacy/page.tsx", "src/app/(marketing)/terms/page.tsx", "src/app/(marketing)/cookies/page.tsx", "src/app/robots.ts", "src/app/sitemap.ts"]) {
      assert.ok(!/clindesk/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")), f);
    }
    for (const p of ["privacy", "terms", "cookies", "accessibility"]) {
      const f = `src/app/clindesk-site/${p}/page.tsx`;
      assert.ok(!/@\/app\/\(marketing\)/.test(fs.readFileSync(path.join(ROOT, f), "utf8")), `${f} imports a ClinForms page`);
    }
  });
  // The byte-for-byte check against feat/clinic-system was retired on 14/11/2026: that branch is merged into main, and
  // the terms changed on purpose (Khuram: liability limit £600, claims notified within 3 months). Pinned instead:
  it("both brands' terms and the DPA carry the same liability limit (£600) and 3-month claim notice", () => {
    const clinforms = fs.readFileSync(path.join(ROOT, "src/app/(marketing)/terms/page.tsx"), "utf8").replace(/\s+/g, " ");
    const clindesk = fs.readFileSync(path.join(ROOT, "src/app/clindesk-site/terms/page.tsx"), "utf8").replace(/\s+/g, " ");
    const fills = JSON.parse(fs.readFileSync(path.join(ROOT, "content/clindesk-site.json"), "utf8"));
    const dpa = JSON.parse(fs.readFileSync(path.join(ROOT, "content/dpa.json"), "utf8")) as { sections: { id: string; paragraphs: string[] }[] };
    const dpaLiability = dpa.sections.find((s) => s.id === "liability")?.paragraphs.join(" ") ?? "";
    assert.match(clinforms, /limited to £600 in total\. The same limit applies to data protection claims under the DPA\./);
    assert.match(clindesk, /limited to\{" "\} <Fill k="legal\.liabilityCap" \/>\. The same limit applies to data protection claims under the DPA\./);
    assert.equal(JSON.stringify(fills).includes('"legal.liabilityCap":{"value":"£600 in total"'), true);
    assert.match(dpaLiability, /limited to £600 in total/);
    for (const text of [clinforms, clindesk, dpaLiability]) assert.match(text, /within 3 months of the claiming party becoming aware/);
  });
});

describe("clindesk.co.uk", () => {
  it("every page of the site has a route, and the middleware serves exactly those paths plus robots and sitemap", () => {
    const pagePaths = CLINDESK_PAGES.map((p) => p.path);
    assert.deepEqual([...CLINDESK_SITE_PATHS].sort(), [...pagePaths, "/robots.txt", "/sitemap.xml"].sort());
    for (const p of pagePaths) {
      const file = path.join(ROOT, "src/app/clindesk-site", p === "/" ? "" : p, "page.tsx");
      assert.ok(fs.existsSync(file), file);
    }
  });
  it("its hosts are the clinic brand: usage statistics on (08/11/2026), ClinDesk's own canonical origin", () => {
    for (const host of ["clindesk.co.uk", "www.clindesk.co.uk", "clinic.localhost:3184"]) {
      assert.equal(brandForHost(host).id, "clinic");
      assert.equal(analyticsAllowedOnHost(host), true, host);
    }
    assert.equal(CLINDESK_SITE_URL, "https://clindesk.co.uk");
    assert.equal(BRANDS.clinic.publicSite, "clindesk");
  });
  it("robots.txt: crawlable site; app, APIs, sign-in, the demo studio below /reports and the thank-you page are not", async () => {
    const body = await clindeskRobots().text();
    assert.match(body, /^User-Agent: \*\nAllow: \/\n/);
    for (const p of ["/app", "/api", "/pms-sandbox", "/clinics", "/login", "/two-factor", "/accept-invite", "/reset-password", "/ingest", "/reports/", "/demo/thanks"]) {
      assert.ok(body.includes(`Disallow: ${p}\n`), p);
    }
    assert.ok(!/Disallow: \/reports\n/.test(body), "the Reports page itself is crawlable");
    assert.match(body, /Sitemap: https:\/\/clindesk\.co\.uk\/sitemap\.xml/);
    assert.ok(!/clinforms/i.test(body));
  });
  it("sitemap.xml: the indexed ClinDesk pages only, on clindesk.co.uk", async () => {
    const res = clindeskSitemap();
    assert.match(res.headers.get("content-type") ?? "", /application\/xml/);
    const body = await res.text();
    const locs = Array.from(body.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    assert.deepEqual(
      locs,
      CLINDESK_PAGES.filter((p) => p.indexed).map((p) => (p.path === "/" ? "https://clindesk.co.uk" : `https://clindesk.co.uk${p.path}`)),
    );
    assert.ok(!locs.includes("https://clindesk.co.uk/demo/thanks"));
    assert.ok(!/clinforms/i.test(body));
  });
  it("page metadata: absolute title, canonical, cards and the ClinDesk icon", () => {
    const m = clindeskMetadata({ path: "/pricing", title: "Pricing – ClinDesk", description: "Prices." });
    assert.equal(String(m.metadataBase), "https://clindesk.co.uk/");
    assert.deepEqual(m.title, { absolute: "Pricing – ClinDesk" });
    assert.deepEqual(m.alternates, { canonical: "/pricing" });
    assert.deepEqual(m.robots, { index: true, follow: true });
    assert.equal((m.openGraph as { siteName?: string }).siteName, "ClinDesk");
    assert.equal((m.twitter as { card?: string }).card, "summary_large_image");
    assert.ok(fs.existsSync(path.join(ROOT, "public/clindesk/favicon.svg")));
    assert.ok(fs.existsSync(path.join(ROOT, "public/clindesk/og.png")));
    assert.ok(fs.existsSync(path.join(ROOT, "public/clindesk/apple-touch-icon.png")));
    assert.deepEqual(clindeskMetadata({ path: "/demo/thanks", title: "t", description: "d", index: false }).robots, { index: false, follow: true });
  });
  it("www.clindesk.co.uk redirects to the apex in next.config.mjs (permanent, every path)", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
    assert.match(cfg, /source: "\/:path\*",\s*has: \[\{ type: "host", value: "www\\\\\.clindesk\\\\\.co\\\\\.uk" \}\],\s*destination: "https:\/\/clindesk\.co\.uk\/:path\*",\s*permanent: true/);
  });
  it("X-Robots-Tag: /reports is noindex on ClinForms' hosts only; everything below /reports on every host", async () => {
    const cfg = (await import(path.join(ROOT, "next.config.mjs"))).default as { headers: () => Promise<Array<{ source: string; missing?: unknown; has?: unknown; headers: Array<{ key: string; value: string }> }>> };
    const rules = (await cfg.headers()).filter((r) => r.headers.some((h) => h.key === "X-Robots-Tag"));
    const exact = rules.filter((r) => r.source === "/reports");
    assert.equal(exact.length, 1);
    assert.deepEqual(exact[0].missing, [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }]);
    assert.ok(rules.some((r) => r.source === "/reports/:path+" && !r.missing && !r.has));
    assert.ok(!rules.some((r) => r.source === "/reports/:path*"), "/reports/:path* would also match /reports itself");
  });
  it("the site's CSS is scoped: every rule sits under .cd-site (or the page's html), keyframes are prefixed", () => {
    const dir = path.join(ROOT, "src/components/clindesk/styles");
    for (const f of fs.readdirSync(dir)) {
      const css = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of Array.from(css.matchAll(/(?:^|[{}])\s*([^{}@]+)\{/g))) {
        const selectors = m[1].trim();
        if (/^(from|to|\d+%)/.test(selectors)) continue;
        for (const s of topLevelSelectors(selectors)) assert.match(s.trim(), /^(\.cd-site|html:has\(\.cd-site\))/, `${f}: ${s.trim()}`);
      }
      for (const m of Array.from(css.matchAll(/@keyframes\s+([\w-]+)/g))) assert.match(m[1], /^cd-/, `${f}: ${m[1]}`);
    }
  });
});

/**
 * ClinDesk's legal pages (src/app/clindesk-site/{privacy,terms,cookies,accessibility}), rendered as the static build
 * renders them (not a draft: unfilled values show "[to confirm]"). Only the page's own <main> is checked – the shared
 * header and footer are tested with the site.
 */
describe("clindesk.co.uk legal pages", () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  // The accessibility page imports its stylesheet (Next bundles it); under node:test a .css file is nothing.
  (require as unknown as { extensions: Record<string, () => void> }).extensions[".css"] = () => undefined;

  async function mainOf(page: "privacy" | "terms" | "cookies" | "accessibility" | "security"): Promise<{ html: string; text: string }> {
    const Page = (await import(`@/app/clindesk-site/${page}/page`)).default as () => React.ReactElement;
    const html = renderToStaticMarkup(createElement(Page));
    const main = html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
    assert.ok(main.length > 500, `${page}: <main> found`);
    const text = main.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    return { html: main, text };
  }

  for (const page of ["privacy", "terms", "cookies", "accessibility"] as const) {
    it(`/${page}: names ClinDesk and Appstack X Ltd; never ClinForms; neutral wording`, async () => {
      const { text } = await mainOf(page);
      assert.match(text, /ClinDesk/);
      assert.match(text, /Appstack X Ltd/);
      assert.ok(!/ClinForms/.test(text), `${page}: names ClinForms: …${text.slice(Math.max(0, text.indexOf("ClinForms") - 80), text.indexOf("ClinForms") + 40)}…`);
      for (const re of BANNED_TERM_PATTERNS) assert.ok(!re.test(text), `${page}: ${re}`);
      // PostHog is named on /privacy and /cookies only (owner's decision 08/11/2026: the usage-statistics provider).
      const vendors = [/vercel/i, /cloudflare/i, /turnstile/i, /mailersend/i, /mailpit/i, /supabase/i, /stripe/i, /anthropic/i, /healthcode/i];
      if (page !== "privacy" && page !== "cookies") vendors.push(/posthog/i);
      for (const vendor of vendors) {
        assert.ok(!vendor.test(text), `${page}: names a vendor (${vendor})`);
      }
      if (page === "terms") assert.match(text, /Last updated: 14 November 2026/);
      if (page === "privacy" || page === "cookies") assert.match(text, /Last updated: 8 November 2026/);
    });
  }

  it("/privacy and /terms: company number 16287309, registered in England and Wales; no registered office shown (Khuram 01/11/2026)", async () => {
    for (const page of ["privacy", "terms"] as const) {
      const { text, html } = await mainOf(page);
      assert.match(text, /Appstack X Ltd ?(\(.we., .us.\) ?)?, a company registered in England and Wales, company number 16287309 ?\./, page);
      assert.ok(!/registered office/i.test(text), `${page}: no registered office`);
      assert.ok(!html.includes('data-to-confirm="company.number"'), `${page}: company number filled`);
    }
  });

  it("footers of both sites: Appstack X Ltd, company number 16287309, the registered office last and small", async () => {
    const { SiteFooter } = await import("@/components/clindesk/site-footer");
    const html = renderToStaticMarkup(createElement(SiteFooter));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.match(text, /© 2026 Appstack X Ltd · Made in the UK · Company no\. 16287309 ·/);
    assert.match(text, /fictional sample data\. Registered office: 18 Westergate Avenue, Milton Keynes, MK10 7LQ ClinDesk$/, "last line (before the decorative giant name)");
    assert.match(html, /<p class="f-office">Registered office: /);
    const css = fs.readFileSync(path.join(ROOT, "src/components/clindesk/styles/site.css"), "utf8");
    assert.match(css, /\.cd-site \.f-office \{[^}]*font-size: 12px;[^}]*color: var\(--muted-on-dark\);/);
    const { SiteFooter: ClinFormsFooter } = await import("@/components/marketing/site-footer");
    const cf = renderToStaticMarkup(createElement(ClinFormsFooter)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.match(cf, /ClinForms is a product of Appstack X Ltd\. © \d{4} Appstack X Ltd\. Registered in England and Wales, company number 16287309\. Registered office: 18 Westergate Avenue, Milton Keynes, MK10 7LQ$/);
  });

  it("/security: the filled hosting, encryption, backup, retention and document lines read as sentences; no certification claimed", async () => {
    const { text, html } = await mainOf("security");
    for (const k of ["hosting.summary", "security.icoRegistration", "security.certifications", "security.region", "security.hostingDetails", "security.encryptionInTransit", "security.encryptionAtRest", "security.backupFrequency", "security.backupRetention", "security.retentionGuidance", "security.deletionProcess", "security.auditRetention", "security.overviewDocument", "security.subProcessorsDocument", "security.issueResponseTime"]) {
      assert.ok(!html.includes(`data-to-confirm="${k}"`), k);
    }
    assert.ok(!text.includes(TO_CONFIRM));
    for (const re of [
      /UK \(London\) Registered with the ICO, number ZC135044 No certifications yet – Cyber Essentials planned/,
      /Your data is stored in the UK \(London\)\. Hosted in UK data centres in London\./,
      /In transit: TLS 1\.2 or later\. At rest: AES-256, with patient files and notes also encrypted per clinic\./,
      /Daily, kept for 7 days, stored in the UK \(London\)\./,
      /in line with HCPC and CSP record-keeping guidance \(adult records at least 8 years after the last treatment\)\. When a clinic leaves, it receives a full export of its data, and the data is then deleted\./,
      /Kept for 8 years\./,
      /Security overview \(PDF\)/,
      /Sub-processors list \(PDF\)/,
      /we'll respond within one working day\./,
    ]) assert.match(text, re, String(re));
    assert.ok(!/certified|ISO 27001|Cyber Essentials (?!planned)/i.test(text), "no certification claimed");
    for (const vendor of [/vercel/i, /cloudflare/i, /supabase/i, /amazon|aws/i, /postgres/i]) assert.ok(!vendor.test(text), String(vendor));
  });

  it("/privacy: controller and processor roles, the data categories and the sub-processor list taken from the code", async () => {
    const { text, html } = await mainOf("privacy");
    assert.match(text, /Controller for the personal data of website visitors, people who book a demo, and the users of clinic accounts/);
    assert.match(text, /Processor for the information a clinic keeps/);
    assert.match(text, /Article 28 of the UK GDPR/);
    assert.match(text, /please contact your clinic/);
    for (const category of ["Patients:", "Appointments:", "Clinical records", "Cases and referrals:", "Billing:", "Patient portal:", "Messages:", "Staff and set-up:", "Audit trail:", "Imports:", "Referrer reports"]) {
      assert.ok(text.includes(category), category);
    }
    assert.match(text, /never the full card number/);
    const subs: Array<[string, RegExp]> = [
      ["Application hosting", /Application hosting – runs the website and the application \(London region\)/],
      ["Database and file storage", /Database and file storage – stores clinic data/],
      ["Email delivery", /Email delivery – sends invitations, password resets and security notices/],
      ["Patient messaging", /Patient messaging \(only where switched on\)/],
      ["Card payments", /Card payments \(only where the clinic switches them on\)/],
      ["Human check", /Human check \(only where switched on\)/],
      ["Drafting service", /Drafting service \(only for clinics with the Reports add-on\)/],
      ["Media delivery", /Media delivery – keeps our tour video in the EU and delivers it when a visitor presses play on the tour page/],
    ];
    // The tour video (/tour): what reaches the media host, and when.
    assert.match(text, /Tour video plays \(only if you play or download our 3-minute tour ?\)/);
    assert.match(text, /Opening the page loads nothing from that provider: the poster image comes from this website/);
    assert.match(text, /It carries no cookies, the video sets none/);
    for (const [name, re] of subs) assert.match(text, re, name);
    // No ClinForms demo video (the tour video is ClinDesk's own, above); the database region is a fill-in, not the old
    // "EU". Usage statistics (08/11/2026): on unless turned off, PostHog EU named, one-click opt-out.
    for (const absent of [/Product analytics/, /demo video/i, /\(EU\)/, /stored in the EU/]) assert.ok(!absent.test(text), String(absent));
    assert.match(text, /Usage statistics \(on unless you turn them off\)/);
    assert.match(text, /Processed for us only by PostHog, in its EU region/);
    assert.match(text, /UK exemption for statistics that improve our own website/);
    assert.match(text, /turn usage statistics off at any time, with one click/);
    // Advertising measurement (since 31/10/2026): consent only, public pages only, Google named as the provider.
    assert.match(text, /Advertising measurement \(only if you allow advertising cookies, and only on this website's public pages\)/);
    assert.match(text, /Google acts as a separate controller/);
    assert.match(text, /withdraw consent at any time, where we rely on consent \(for analytics and advertising cookies, use .Cookie settings/);
    assert.ok(!/This website uses no analytics/.test(text), "no longer true (08/11/2026)");
    assert.ok(!/we do not use it for advertising/.test(text), "no longer true");
    // Filled 01/11/2026 (Khuram): ICO number, region, sub-processor list title, retention.
    for (const k of ["legal.accountRetention", "legal.demoRequestRetention", "legal.providerLocations", "security.icoRegistration", "security.region", "security.subProcessorsDocument", "security.backupRetention", "security.auditRetention", "security.retentionGuidance"]) {
      assert.ok(!html.includes(`data-to-confirm="${k}"`), k);
    }
    assert.match(text, /Registered with the ICO, number ZC135044\./);
    assert.match(text, /clinic data is stored in the UK \(London\)\./);
    assert.match(text, /available on request as our Sub-processors list \(PDF\) from /);
    assert.match(text, /in line with HCPC and CSP record-keeping guidance \(adult records at least 8 years after the last treatment\)\. Clinical records are never deleted automatically\. Backups are kept for 7 days\./);
    assert.ok(!text.includes(TO_CONFIRM), "every fill-in filled (01/11/2026)");
  });

  it("/terms: the clinic system as the service, the Reports add-on optional, lawyer points filled", async () => {
    const { text, html } = await mainOf("terms");
    assert.match(text, /the clinic management system, with its diary, patient records, billing, patient portal and messages/);
    assert.match(text, /the Reports add-on if the order includes it/);
    assert.match(text, /governed by the law of England and Wales/);
    assert.ok(!/public demo/.test(text), "ClinDesk has no public demo");
    assert.match(text, /No VAT is charged\./, "not VAT registered (01/11/2026)");
    // Filled 01/11/2026 (Khuram): data export, support channels and hours now read from the content file.
    for (const k of ["legal.termsEffectiveFrom", "legal.medicalDeviceStatus", "legal.liabilityCap", "legal.paymentProviderTerms"]) {
      assert.ok(!html.includes(`data-to-confirm="${k}"`), k);
    }
    assert.match(text, /These terms apply from 1 November 2026/);
    assert.ok(!text.includes(TO_CONFIRM));
  });

  it("/cookies: exactly the cookies the code sets on ClinDesk – consent and statistics opt-out cookies, analytics storage with consent, advertising cookies", async () => {
    const { text, html } = await mainOf("cookies");
    for (const name of [PORTAL_COOKIE, MANAGE_COOKIE, DEVICE_COOKIE, SITE_COOKIE]) assert.ok(html.includes(`<code>${name}</code>`), name);
    for (const n of SESSION_COOKIE_NAMES) assert.ok(html.includes(`<code>${n.replace(/^__Secure-/, "").split(".")[0]}.*</code>`), n);
    assert.equal(SITE_COOKIE_MAX_AGE, 365 * 24 * 3600, "pms_site lasts 12 months, as the page says");
    assert.match(text, /pms_site Type Cookie Purpose Remembers which of the clinic's sites a signed-in user last chose to look at Duration 12 months/);
    for (const absent of ["medreport", "tm3sim", "no cookie banner", "We do not use analytics"]) assert.ok(!text.includes(absent), absent);
    for (const name of [CONSENT_COOKIE, STATS_COOKIE, "ph_*", DEMO_SENT_KEY, ...GOOGLE_ADS_FIRST_PARTY_COOKIES]) assert.ok(html.includes(`<code>${name}</code>`), name);
    assert.match(text, /Usage statistics \(on unless you turn them off\)/);
    assert.match(text, /No cookies are set and nothing is stored on your device/);
    assert.match(text, /Analytics cookies \(optional\)/);
    assert.match(text, /Advertising \(optional\)/);
    assert.match(text, /Nothing is loaded from Google until you accept/);
    assert.ok(!html.includes('data-to-confirm="legal.humanCheckStorage"'));
  });
});

describe("clindesk.co.uk wording", () => {
  it('never says "powered by" ClinForms (Khuram, 01/11/2026)', () => {
    const roots = [path.join(process.cwd(), "src/app/clindesk-site"), path.join(process.cwd(), "src/lib/clindesk-site")];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);
    const hits = files.filter((f) => /powered by/i.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});
