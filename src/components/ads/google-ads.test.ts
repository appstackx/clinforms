/**
 * Advertising measurement (google-ads.ts): where the Google tag may run (route/layout inventory), what it is set up
 * with, when the "Demo request" conversion is sent, and the CSP that lets it load on the public pages only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { CONSENT_COOKIE } from "@/components/consent/consent";
import { CLINDESK_SITE_PATHS, PUBLIC_SITE_PATHS } from "@/middleware";
import {
  CLINDESK_TAG_PATHS,
  CLINFORMS_TAG_PATHS,
  DEMO_CONVERSION,
  DEMO_SENT_KEY,
  DEMO_SENT_MAX_AGE_MS,
  GOOGLE_ADS_TAG_ID,
  GTAG_SCRIPT_SRC,
  LINKER_DOMAINS,
  adsTagAllowed,
  adsTagStarted,
  consentSignals,
  cookieDomainCandidates,
  demoSentNoteValid,
  forgetDemoSent,
  grantAds,
  gtagSetupCommands,
  isGoogleAdsCookie,
  noteDemoSent,
  reportDemoConversion,
  reportDemoConversionFromNote,
  revokeAds,
} from "./google-ads";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("the tag and the conversion: exact values", () => {
  it("tag id, conversion send_to / value / currency, cross-domain linker, script URL", () => {
    assert.equal(GOOGLE_ADS_TAG_ID, "AW-18548610866");
    assert.deepEqual({ ...DEMO_CONVERSION }, { send_to: "AW-18548610866/p4GXCKPR1K8dELKu1YxF", value: 1.0, currency: "GBP" });
    assert.deepEqual([...LINKER_DOMAINS], ["clindesk.co.uk", "clinforms.co.uk"]);
    assert.equal(GTAG_SCRIPT_SRC, "https://www.googletagmanager.com/gtag/js?id=AW-18548610866");
  });

  it("set-up order: Consent Mode v2 defaults DENIED first, then the update, then js and config (no enhanced conversions)", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const denied = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
    const granted = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" };
    assert.deepEqual(consentSignals(false), denied);
    assert.deepEqual(consentSignals(true), granted);
    assert.deepEqual(gtagSetupCommands(true, now), [
      ["consent", "default", { ...denied, wait_for_update: 500 }],
      ["consent", "update", granted],
      ["js", now],
      ["config", "AW-18548610866", { linker: { domains: ["clindesk.co.uk", "clinforms.co.uk"] }, allow_enhanced_conversions: false }],
    ]);
    assert.deepEqual(gtagSetupCommands(false, now)[0], ["consent", "default", { ...denied, wait_for_update: 500 }]);
    assert.ok(!gtagSetupCommands(false, now).some((c) => c[1] === "update"));
  });
});

describe("where the tag may run", () => {
  it("the tag's page lists are the middleware's public page lists (ClinDesk's without robots.txt / sitemap.xml)", () => {
    assert.deepEqual([...CLINFORMS_TAG_PATHS], [...PUBLIC_SITE_PATHS]);
    assert.deepEqual([...CLINDESK_TAG_PATHS], CLINDESK_SITE_PATHS.filter((p) => p !== "/robots.txt" && p !== "/sitemap.xml"));
  });

  it("public website pages of each brand: yes", () => {
    for (const host of ["clinforms.co.uk", "www.clinforms.co.uk", "localhost:3000", "clinforms-git-x.vercel.app"]) {
      for (const p of ["/", "/demo", "/request-access", "/privacy", "/cookies", "/terms", "/security"]) assert.equal(adsTagAllowed(host, p), true, `${host}${p}`);
    }
    for (const host of ["clindesk.co.uk", "clinic.localhost:3180"]) {
      for (const p of ["/", "/features", "/reports", "/pricing", "/demo", "/demo/thanks", "/tour", "/cookies", "/privacy", "/accessibility"]) {
        assert.equal(adsTagAllowed(host, p), true, `${host}${p}`);
      }
    }
  });

  it("never the app, the public demo, the sign-in pages, a clinic's patient pages, the APIs or unknown paths", () => {
    const never = [
      "/app",
      "/app/clinic",
      "/app/clinic/patients/p1",
      "/app/studio",
      "/app/settings/members",
      "/app/platform",
      "/reports/rep_1",
      "/reports/new",
      "/pms-sandbox",
      "/pms-sandbox/patients/sim-pat-001",
      "/login",
      "/two-factor",
      "/accept-invite",
      "/reset-password",
      "/clinics/c1/booking",
      "/clinics/c1/portal",
      "/api/access-requests",
      "/ingest/e/",
      "/does-not-exist",
      "/demo/",
      "/demox",
    ];
    for (const host of ["clinforms.co.uk", "clindesk.co.uk", "localhost:3000", "clinic.localhost:3180"]) {
      for (const p of never) assert.equal(adsTagAllowed(host, p), false, `${host}${p}`);
    }
    // /reports is the public demo Studio on ClinForms' hosts, ClinDesk's "Referrer reports" page on its own.
    assert.equal(adsTagAllowed("clinforms.co.uk", "/reports"), false);
    assert.equal(adsTagAllowed("clindesk.co.uk", "/reports"), true);
    // ClinDesk-only pages are not ClinForms pages and vice versa.
    assert.equal(adsTagAllowed("clinforms.co.uk", "/demo/thanks"), false);
    assert.equal(adsTagAllowed("clindesk.co.uk", "/request-access"), false);
  });
});

/* ------------------------------------------------------------------------------- route / layout inventory */

interface Route {
  file: string;
  /** Route groups and folders from src/app, e.g. ["(marketing)", "cookies"]. */
  segments: string[];
}

function pageFiles(dir: string, segments: string[] = []): Route[] {
  const out: Route[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full, [...segments, entry.name]));
    else if (/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) out.push({ file: path.relative(ROOT, full), segments });
  }
  return out;
}

/** The layout.tsx files that wrap a route (src/app/layout.tsx first). */
function layoutChain(route: Route): string[] {
  const chain: string[] = [];
  for (let i = 0; i <= route.segments.length; i++) {
    const rel = path.join("src/app", ...route.segments.slice(0, i), "layout.tsx");
    if (fs.existsSync(path.join(ROOT, rel))) chain.push(rel);
  }
  return chain;
}

const MOUNTS_TAG = /from "@\/components\/ads\/google-ads-tag"/;
const TAG_LAYOUTS = ["src/app/(marketing)/layout.tsx", "src/app/clindesk-site/layout.tsx"];

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(rel));
    else if (/\.(tsx?|mjs|cjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("route and layout inventory: the tag is mounted on the public website pages only", () => {
  const routes = pageFiles(path.join(ROOT, "src/app"));
  const sources = allSourceFiles("src");

  it("only the two public website layouts mount the tag", () => {
    const mounting = sources.filter((f) => MOUNTS_TAG.test(read(f)));
    assert.deepEqual(mounting.sort(), [...TAG_LAYOUTS].sort());
    assert.ok(!MOUNTS_TAG.test(read("src/app/layout.tsx")), "never the root layout (it wraps the app)");
  });

  it("every route under those layouts is a public website page; every other route has no tag layout", () => {
    assert.ok(routes.length > 50, `routes found: ${routes.length}`);
    const clinforms = new Set<string>(CLINFORMS_TAG_PATHS);
    const clindesk = new Set<string>([...CLINDESK_TAG_PATHS, "/robots.txt", "/sitemap.xml"]);
    let tagged = 0;
    for (const route of routes) {
      const chain = layoutChain(route);
      const withTag = chain.filter((l) => TAG_LAYOUTS.includes(l));
      const urlPath = "/" + route.segments.filter((s) => !/^\(.*\)$/.test(s)).join("/");
      if (route.segments[0] === "(marketing)") {
        assert.deepEqual(withTag, ["src/app/(marketing)/layout.tsx"], route.file);
        assert.ok(clinforms.has(urlPath), `${route.file} → ${urlPath} is not a ClinForms public page`);
        tagged++;
      } else if (route.segments[0] === "clindesk-site") {
        assert.deepEqual(withTag, ["src/app/clindesk-site/layout.tsx"], route.file);
        const sitePath = urlPath.replace(/^\/clindesk-site/, "") || "/";
        assert.ok(clindesk.has(sitePath), `${route.file} → ${sitePath} is not a ClinDesk public page`);
        tagged++;
      } else {
        assert.deepEqual(withTag, [], `${route.file} must not sit under a tag layout`);
        assert.ok(!MOUNTS_TAG.test(read(route.file)), route.file);
      }
    }
    assert.ok(tagged >= 20, `public pages found: ${tagged}`);
  });

  it("the app, demo, sandbox, sign-in, accept-invite and patient pages exist and are outside the tag layouts", () => {
    const outside = routes.filter((r) => layoutChain(r).every((l) => !TAG_LAYOUTS.includes(l))).map((r) => r.file);
    for (const expected of [
      /^src\/app\/app\//,
      /^src\/app\/reports\/page\.tsx$/,
      /^src\/app\/pms-sandbox\/page\.tsx$/,
      /^src\/app\/\(auth\)\/login\/page\.tsx$/,
      /^src\/app\/\(auth\)\/accept-invite\/page\.tsx$/,
      /^src\/app\/\(public-clinic\)\/clinics\//,
      /^src\/app\/api\//,
    ]) {
      assert.ok(outside.some((f) => expected.test(f)), String(expected));
    }
  });

  it("the guard that reloads a page left with the tag is mounted in the root layout", () => {
    assert.match(read("src/app/layout.tsx"), /<AdsRouteGuard \/>/);
    assert.match(read("src/components/ads/ads-route-guard.tsx"), /adsTagStarted\(\) && !adsTagAllowed\(window\.location\.host, window\.location\.pathname\)\) window\.location\.reload\(\)/);
  });

  it("only the two demo forms and ClinDesk's thank-you page touch the conversion", () => {
    const users = sources.filter((f) => /\b(reportDemoConversion|reportDemoConversionFromNote|noteDemoSent)\b/.test(read(f)) && !f.startsWith("src/components/ads/"));
    assert.deepEqual(users.sort(), [
      "src/app/(marketing)/request-access/request-access-form.tsx",
      "src/components/clindesk/demo-conversion.tsx",
      "src/components/clindesk/demo-form.tsx",
    ]);
    assert.match(read("src/app/clindesk-site/demo/thanks/page.tsx"), /<DemoConversion \/>/);
    assert.ok(!/DemoConversion/.test(read("src/app/clindesk-site/demo/page.tsx")), "not on the form page itself");
  });

  it("ClinForms' form sends the conversion only in the server-accepted branch, never for the honeypot", () => {
    const src = read("src/app/(marketing)/request-access/request-access-form.tsx");
    const ok = src.indexOf("if (res.ok && payload.ok) {");
    const invalid = src.indexOf("if (res.status === 422");
    const at = src.indexOf("reportDemoConversion()");
    assert.ok(ok > 0 && invalid > ok && at > ok && at < invalid, "inside the 2xx + ok branch");
    assert.equal(src.split("reportDemoConversion()").length, 2, "one call");
    assert.match(src, /const human = body\.website === "";[\s\S]*if \(human\) reportDemoConversion\(\);/);
  });

  it("ClinDesk's form notes a submission only with an empty honeypot, and forgets it when the server answers with errors", () => {
    const src = read("src/components/clindesk/demo-form.tsx");
    assert.match(src, /const honeypot = new FormData\(event\.currentTarget\)\.get\("website"\);\s*if \(!honeypot\) noteDemoSent\(\);\s*else forgetDemoSent\(\);/);
    assert.match(src, /if \(state\.status !== "idle"\) \{\s*forgetDemoSent\(\);/);
    assert.match(src, /action=\{action\} onSubmit=\{onSubmit\}/);
    // The server action only redirects to the thank-you page after it stored the request (or for the honeypot, which
    // the form never notes).
    const action = read("src/app/clindesk-site/demo/actions.ts");
    assert.match(action, /if \(done\) redirect\("\/demo\/thanks"\);/);
  });
});

/* ------------------------------------------------------------------------------------ browser behaviour */

class CookieJar {
  private jar = new Map<string, string>();
  get cookie(): string {
    return Array.from(this.jar, ([k, v]) => `${k}=${v}`).join("; ");
  }
  set cookie(value: string) {
    const [pair, ...attrs] = value.split(";").map((s) => s.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    if (attrs.some((a) => /^max-age=0$/i.test(a))) this.jar.delete(name);
    else this.jar.set(name, pair.slice(eq + 1));
  }
}

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

interface FakeWindow {
  location: { host: string; hostname: string; pathname: string; protocol: string };
  document: CookieJar;
  sessionStorage: MemoryStorage;
  dataLayer?: unknown[];
  gtag?: unknown;
  __clinformsAdsTag?: unknown;
  dispatchEvent: () => boolean;
}

describe("in the browser: consent, set-up, conversion once, withdrawal", () => {
  let win: FakeWindow;
  const g = globalThis as unknown as Record<string, unknown>;

  function at(host: string, pathname: string) {
    win.location = { host, hostname: host.split(":")[0], pathname, protocol: "https:" };
  }
  function consent(ads: boolean) {
    win.document.cookie = `${CONSENT_COOKIE}=v2.a0.m${ads ? 1 : 0}.20261031; Path=/`;
  }
  /** The dataLayer as plain arrays (gtag pushes `arguments` objects). */
  function commands(): unknown[][] {
    return (win.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
  }
  const conversions = () => commands().filter((c) => c[0] === "event" && c[1] === "conversion");

  beforeEach(() => {
    win = { location: { host: "", hostname: "", pathname: "/", protocol: "https:" }, document: new CookieJar(), sessionStorage: new MemoryStorage(), dispatchEvent: () => true };
    g.window = win;
    g.document = win.document;
    at("clindesk.co.uk", "/demo");
  });
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it("without consent nothing is queued and no conversion is sent", () => {
    assert.equal(reportDemoConversion(), false);
    consent(false);
    assert.equal(reportDemoConversion(), false);
    assert.equal(win.dataLayer, undefined);
    assert.equal(adsTagStarted(), false);
  });

  it("with consent: defaults denied first, then granted; the conversion carries exactly send_to / value / currency", () => {
    consent(true);
    assert.equal(reportDemoConversion(), true);
    const c = commands();
    assert.deepEqual(c[0].slice(0, 2), ["consent", "default"]);
    assert.equal((c[0][2] as Record<string, string>).ad_user_data, "denied");
    assert.deepEqual(c[1], ["consent", "update", consentSignals(true)]);
    assert.equal(c[2][0], "js");
    assert.deepEqual(c[3].slice(0, 2), ["config", GOOGLE_ADS_TAG_ID]);
    assert.deepEqual(conversions(), [["event", "conversion", { send_to: "AW-18548610866/p4GXCKPR1K8dELKu1YxF", value: 1, currency: "GBP" }]]);
    // A second grant (the tag component's effect) does not set the tag up again.
    grantAds();
    assert.equal(commands().filter((x) => x[0] === "config").length, 1);
  });

  it("off the public pages nothing is sent, even with consent", () => {
    consent(true);
    for (const [host, p] of [
      ["clindesk.co.uk", "/app/clinic"],
      ["clinforms.co.uk", "/reports"],
      ["clinforms.co.uk", "/accept-invite"],
      ["clindesk.co.uk", "/clinics/c1/portal"],
    ]) {
      at(host, p);
      assert.equal(reportDemoConversion(), false, `${host}${p}`);
    }
    assert.equal(win.dataLayer, undefined);
  });

  it("a Do Not Track / Global Privacy Control signal counts as a refusal", () => {
    consent(true);
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { globalPrivacyControl: true }, configurable: true });
    try {
      assert.equal(reportDemoConversion(), false);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  });

  it("ClinDesk: the thank-you page counts a noted submission exactly once", () => {
    consent(true);
    noteDemoSent();
    assert.match(win.sessionStorage.getItem(DEMO_SENT_KEY) ?? "", /^\d{13}$/);
    at("clindesk.co.uk", "/demo/thanks");
    assert.equal(reportDemoConversionFromNote(), true);
    assert.equal(reportDemoConversionFromNote(), false, "reload / second effect run");
    assert.equal(conversions().length, 1);
    assert.equal(win.sessionStorage.getItem(DEMO_SENT_KEY), null);
  });

  it("ClinDesk: opening the thank-you page without a submission, after an error, or with a stale note sends nothing", () => {
    consent(true);
    at("clindesk.co.uk", "/demo/thanks");
    assert.equal(reportDemoConversionFromNote(), false, "direct visit");
    at("clindesk.co.uk", "/demo");
    noteDemoSent();
    forgetDemoSent(); // the server answered with errors
    at("clindesk.co.uk", "/demo/thanks");
    assert.equal(reportDemoConversionFromNote(), false, "after an error");
    win.sessionStorage.setItem(DEMO_SENT_KEY, String(Date.now() - DEMO_SENT_MAX_AGE_MS - 1000));
    assert.equal(reportDemoConversionFromNote(), false, "stale note");
    assert.equal(conversions().length, 0);
  });

  it("ClinDesk: without consent the form leaves no note at all", () => {
    consent(false);
    noteDemoSent();
    assert.equal(win.sessionStorage.getItem(DEMO_SENT_KEY), null);
  });

  it("withdrawing consent sets the signals back to denied and removes the tag's cookies", () => {
    consent(true);
    grantAds();
    win.document.cookie = "_gcl_au=1.1.123.456; Path=/";
    win.document.cookie = "_gcl_aw=GCL.1.abc; Path=/";
    win.document.cookie = "pms_site=s1; Path=/";
    consent(false);
    revokeAds();
    assert.deepEqual(commands().at(-1), ["consent", "update", consentSignals(false)]);
    assert.ok(!/_gcl_/.test(win.document.cookie), win.document.cookie);
    assert.match(win.document.cookie, /pms_site=s1/);
    assert.match(win.document.cookie, new RegExp(`${CONSENT_COOKIE}=v2\\.a0\\.m0`));
  });

  it("note validity, cookie names and cookie domains", () => {
    const now = 1_793_000_000_000;
    assert.equal(demoSentNoteValid(String(now - 1000), now), true);
    assert.equal(demoSentNoteValid(String(now - DEMO_SENT_MAX_AGE_MS - 1), now), false);
    assert.equal(demoSentNoteValid("abc", now), false);
    assert.equal(demoSentNoteValid(null, now), false);
    assert.ok(isGoogleAdsCookie("_gcl_au") && isGoogleAdsCookie("_gac_UA-1") && !isGoogleAdsCookie("clinforms_consent"));
    assert.deepEqual(cookieDomainCandidates("www.clindesk.co.uk"), ["www.clindesk.co.uk", "clindesk.co.uk", "co.uk"]);
  });
});

/* -------------------------------------------------------------------------------------------- CSP */

describe("next.config: the Google tag's sources on the public pages only", () => {
  type Rule = { source: string; has?: unknown; missing?: unknown; headers: Array<{ key: string; value: string }> };
  const GOOGLE = /google|doubleclick/;
  async function load() {
    const mod = await import(pathToFileURL(path.join(ROOT, "next.config.mjs")).href);
    const rules: Rule[] = await mod.default.headers();
    return { mod, rules };
  }
  const cspOf = (r: Rule) => r.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value;
  const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

  it("the site-wide policy (every app route) names no Google source", async () => {
    const { rules } = await load();
    const all = rules.find((r) => r.source === "/:path*");
    const csp = cspOf(all!)!;
    assert.ok(csp && !GOOGLE.test(csp), csp);
    assert.deepEqual(directives(csp)["frame-src"], ["'none'"]);
  });

  it("each brand's public pages get the tag's sources, on that brand's hosts only", async () => {
    const { mod, rules } = await load();
    const hosts = [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }];
    assert.equal(mod.CLINDESK_HOSTS, hosts[0].value);
    assert.deepEqual(mod.CLINFORMS_PUBLIC_PATHS, [...CLINFORMS_TAG_PATHS]);
    assert.deepEqual(mod.CLINDESK_PUBLIC_PATHS, [...CLINDESK_TAG_PATHS]);
    const widened = rules.filter((r) => r.source !== "/:path*" && cspOf(r));
    for (const r of widened) {
      const csp = directives(cspOf(r)!);
      assert.ok(csp["script-src"].includes("https://www.googletagmanager.com"), r.source);
      assert.ok(csp["script-src"].includes("https://www.google.com"), r.source);
      for (const s of ["https://www.google.com", "https://www.googleadservices.com", "https://*.doubleclick.net", "https://www.google-analytics.com"]) {
        assert.ok(csp["connect-src"].includes(s), `${r.source} connect-src ${s}`);
      }
      for (const s of ["https://www.google.com", "https://www.googleadservices.com", "https://*.doubleclick.net", "https://www.google.co.uk"]) {
        assert.ok(csp["img-src"].includes(s), `${r.source} img-src ${s}`);
      }
    }
    const clinforms = widened.filter((r) => JSON.stringify(r.missing) === JSON.stringify(hosts) && !r.has).map((r) => r.source);
    const clindesk = widened.filter((r) => JSON.stringify(r.has) === JSON.stringify(hosts) && !r.missing).map((r) => r.source);
    assert.deepEqual(clinforms, [...CLINFORMS_TAG_PATHS]);
    assert.deepEqual(clindesk, [...CLINDESK_TAG_PATHS]);
    assert.equal(widened.length, clinforms.length + clindesk.length, "no other widened rule");
    for (const r of widened) assert.ok(!/^\/(app|api|login|two-factor|accept-invite|reset-password|pms-sandbox|clinics|ingest)(\/|$)|:path/.test(r.source), r.source);
  });
});

/* ------------------------------------------------------------------------------ banners and disclosures */

describe("banners and legal pages tell the truth about advertising cookies", () => {
  it("both banners: Accept and Reject side by side in the same style; ClinForms' banner yields to ClinDesk's on its hosts", () => {
    const clinforms = read("src/components/consent/consent-banner.tsx");
    assert.match(clinforms, /className=\{primaryButton\} onClick=\{\(\) => save\(\{ analytics: true, ads: true \}\)\}>\s*Accept\s*<\/button>\s*<button type="button" className=\{primaryButton\} onClick=\{\(\) => save\(\{ analytics: false, ads: false \}\)\}>\s*Reject\s*</);
    assert.match(clinforms, /brandForHost\(window\.location\.host\)\.publicSite === "clindesk"/);
    assert.ok(!/No advertising cookies/.test(clinforms));
    const clindesk = read("src/components/clindesk/cookie-consent.tsx");
    assert.match(clindesk, /className="btn btn-pine cd-consent-btn" onClick=\{\(\) => save\(\{ analytics: true, ads: true \}\)\}>\s*Accept\s*<\/button>\s*<button type="button" className="btn btn-pine cd-consent-btn" onClick=\{\(\) => save\(\{ analytics: false, ads: false \}\)\}>\s*Reject\s*</);
    assert.match(read("src/app/clindesk-site/layout.tsx"), /<ClindeskCookieConsent \/>\s*\{children\}/, "first in the tab order");
    assert.match(read("src/components/clindesk/site-footer.tsx"), /<CookieSettingsButton className="f-cookie-btn" \/>/);
    assert.match(read("src/components/marketing/site-footer.tsx"), /<CookieSettingsButton/);
  });

  it("no page still says there is no advertising, no third-party cookie or no banner", () => {
    const untrue = [/do not use advertising cookies/i, /no advertising/i, /third-party cookies\./i, /no cookie banner/i, /we do not use it for advertising/i];
    for (const f of [
      "src/app/(marketing)/cookies/page.tsx",
      "src/app/(marketing)/privacy/page.tsx",
      "src/app/clindesk-site/cookies/page.tsx",
      "src/app/clindesk-site/privacy/page.tsx",
      "src/components/consent/consent-banner.tsx",
    ]) {
      const prose = read(f).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      for (const re of untrue) assert.ok(!re.test(prose), `${f}: ${re}`);
    }
  });

  it("both cookie policies list Google's advertising cookies (name, provider, purpose, duration); both privacy policies the measurement", () => {
    const shared = read("src/components/marketing/ads-cookies.tsx");
    for (const s of ["_gcl_au", "_gcl_aw", "_gcl_gs", "IDE", "test_cookie", "NID", "90 days", "Google (first-party cookie on this website)", "Google (third-party cookies)"]) {
      assert.ok(shared.includes(s), s);
    }
    assert.match(shared, /columns=\{\["Name", "Provider", "Purpose", "Duration"\]\}/);
    assert.match(read("src/app/(marketing)/cookies/page.tsx"), /<AdsCookiesSection\s+conversion="request access"/);
    assert.match(read("src/app/clindesk-site/cookies/page.tsx"), /<AdsCookiesSection\s+conversion="book a demo"/);
    for (const f of ["src/app/(marketing)/privacy/page.tsx", "src/app/clindesk-site/privacy/page.tsx"]) {
      const src = read(f);
      assert.match(src, /<strong>Advertising measurement<\/strong> \(only if you allow advertising cookies/, f);
      assert.match(src, /Google acts as a separate controller/, f);
      assert.match(src, /Google may process the measurement data in the United States/, f);
    }
  });
});
