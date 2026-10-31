/**
 * Two public websites on one deployment (src/lib/brand.ts, src/middleware.ts): ClinForms' site stays exactly as it
 * was on clinforms.co.uk (brand, robots, sitemap, no analytics change), and ClinDesk's site (src/app/clindesk-site)
 * has its own pages, robots, sitemap and metadata on clindesk.co.uk only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as clindeskRobots } from "@/app/clindesk-site/robots.txt/route";
import { GET as clindeskSitemap } from "@/app/clindesk-site/sitemap.xml/route";
import { analyticsAllowedOnHost } from "@/components/consent/consent";
import { BRANDS, PUBLIC_SITE_BRAND, brandForHost } from "@/lib/brand";
import { CLINDESK_PAGES, CLINDESK_SITE_URL, clindeskMetadata } from "@/lib/clindesk/site";
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
      { url: "https://clinforms.co.uk", lastModified: "2026-10-09", changeFrequency: "monthly", priority: 1 },
      { url: "https://clinforms.co.uk/demo", lastModified: "2026-10-10", changeFrequency: "monthly", priority: 0.9 },
      { url: "https://clinforms.co.uk/request-access", lastModified: "2026-10-09", changeFrequency: "yearly", priority: 0.8 },
      { url: "https://clinforms.co.uk/security", lastModified: "2026-10-09", changeFrequency: "monthly", priority: 0.7 },
      { url: "https://clinforms.co.uk/privacy", lastModified: "2026-10-10", changeFrequency: "yearly", priority: 0.4 },
      { url: "https://clinforms.co.uk/cookies", lastModified: "2026-10-09", changeFrequency: "yearly", priority: 0.3 },
      { url: "https://clinforms.co.uk/terms", lastModified: "2026-10-09", changeFrequency: "yearly", priority: 0.3 },
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
  it("ClinForms' marketing pages are not edited by this site (they are only imported by the legal frames)", () => {
    for (const f of ["src/app/(marketing)/layout.tsx", "src/app/(marketing)/page.tsx", "src/app/robots.ts", "src/app/sitemap.ts"]) {
      assert.ok(!/clindesk/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")), f);
    }
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
  it("its hosts are the clinic brand: no analytics, ClinDesk's own canonical origin", () => {
    for (const host of ["clindesk.co.uk", "www.clindesk.co.uk", "clinic.localhost:3184"]) {
      assert.equal(brandForHost(host).id, "clinic");
      assert.equal(analyticsAllowedOnHost(host), false, host);
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
