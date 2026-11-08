/**
 * Cookieless usage statistics (08/11/2026, PECR Sched. A1): on by default on the public website pages of both brands,
 * never in the app; memory persistence until cookie consent; one-click opt-out that stops sending and clears storage;
 * the advertising tag stays consent-only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATS_COOKIE,
  adsAllowed,
  analyticsMode,
  statsAllowed,
  statsCookieString,
  statsOptedOutInCookieString,
  type ConsentChoice,
} from "../consent/consent";
import {
  STATS_EVENTS,
  crossSiteTarget,
  ctaTarget,
  filterOutgoingEvent,
  hasGclid,
  isAnalyticsEvent,
  isStatsPagePath,
  sanitizeProps,
} from "./events";
import { clearAnalyticsStorage, persistenceFor, posthogInitConfig, stopAnalytics, track } from "./posthog";

const CF = "https://clinforms.co.uk";
const CD = "https://clindesk.co.uk";
const yes: ConsentChoice = { version: 2, analytics: true, ads: true, date: "2026-11-08" };
const no: ConsentChoice = { ...yes, analytics: false, ads: false };

test("statistics start without consent on public pages of both sites, never in the app, demo, sign-in, patient pages or APIs", () => {
  for (const [path, host] of [
    ["/", "clinforms.co.uk"],
    ["/demo", "clinforms.co.uk"],
    ["/request-access", "clinforms.co.uk"],
    ["/", "clindesk.co.uk"],
    ["/features", "clindesk.co.uk"],
    ["/pricing", "www.clindesk.co.uk"],
    ["/demo", "clindesk.co.uk"],
    ["/demo/thanks", "clindesk.co.uk"],
  ] as const) {
    assert.equal(isStatsPagePath(path, host), true, `${host}${path}`);
    for (const choice of [null, no]) {
      assert.equal(analyticsMode({ choice, signals: {}, statsOptedOut: false, statsPage: isStatsPagePath(path, host) }), "stats", `${host}${path}`);
    }
  }
  for (const path of ["/app", "/app/clinic", "/login", "/two-factor", "/accept-invite", "/reset-password", "/clinics/riverside/book", "/reports", "/reports/new", "/pms-sandbox", "/api/access-requests", "/ingest/e"]) {
    for (const host of ["clinforms.co.uk", "clindesk.co.uk"]) {
      assert.equal(isStatsPagePath(path, host), false, `${host}${path}`);
      assert.equal(analyticsMode({ choice: null, signals: {}, statsOptedOut: false, statsPage: isStatsPagePath(path, host) }), "off", `${host}${path}`);
    }
  }
  // ClinDesk-only pages are not ClinForms pages and the other way round.
  assert.equal(isStatsPagePath("/features", "clinforms.co.uk"), false);
  assert.equal(isStatsPagePath("/request-access", "clindesk.co.uk"), false);
});

test("cookie consent switches to device storage; opt-out and browser signals switch everything off", () => {
  assert.equal(analyticsMode({ choice: yes, signals: {}, statsOptedOut: false, statsPage: true }), "full");
  assert.equal(analyticsMode({ choice: yes, signals: {}, statsOptedOut: false, statsPage: false }), "full", "consented app events as before");
  assert.equal(analyticsMode({ choice: yes, signals: {}, statsOptedOut: true, statsPage: true }), "off", "opt-out wins");
  assert.equal(analyticsMode({ choice: null, signals: { globalPrivacyControl: true }, statsOptedOut: false, statsPage: true }), "off");
  assert.equal(analyticsMode({ choice: null, signals: { doNotTrack: "1" }, statsOptedOut: false, statsPage: true }), "off");
  assert.equal(statsAllowed(false, {}), true);
  assert.equal(statsAllowed(true, {}), false);
});

test("memory persistence before consent, localStorage after; the privacy settings are kept", () => {
  assert.equal(persistenceFor("stats"), "memory");
  assert.equal(persistenceFor("full"), "localStorage");
  for (const mode of ["stats", "full"] as const) {
    const c = posthogInitConfig(mode, "/ingest");
    assert.equal(c.persistence, mode === "stats" ? "memory" : "localStorage");
    assert.equal(c.api_host, "/ingest");
    assert.equal(c.autocapture, false);
    assert.equal(c.disable_session_recording, true);
    assert.equal(c.capture_heatmaps, false);
    assert.equal(c.disable_surveys, true);
    assert.equal(c.person_profiles, "identified_only");
    assert.equal(c.request_batching, false);
    assert.equal(c.capture_pageview, false);
  }
});

test("the opt-out cookie: strictly necessary, one value, 12 months; removing it turns statistics back on", () => {
  const off = statsCookieString(false, { secure: true });
  assert.match(off, new RegExp(`^${STATS_COOKIE}=off; Max-Age=31536000; Path=/; SameSite=Lax; Secure$`));
  assert.match(statsCookieString(true, { secure: false }), new RegExp(`^${STATS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax$`));
  assert.equal(statsOptedOutInCookieString(`a=1; ${STATS_COOKIE}=off`), true);
  assert.equal(statsOptedOutInCookieString(`${STATS_COOKIE}=`), false);
  assert.equal(statsOptedOutInCookieString(""), false);
});

test("the advertising tag still never loads without consent – usage statistics change nothing for it", () => {
  assert.equal(adsAllowed(null, {}), false);
  assert.equal(adsAllowed(no, {}), false);
  assert.equal(adsAllowed({ ...no, analytics: true }, {}), false);
  assert.equal(adsAllowed(yes, {}), true);
});

test("cookieless mode sends only the website events; app events need cookie consent", () => {
  for (const e of STATS_EVENTS) if (e !== "$pageview") assert.ok(isAnalyticsEvent(e), e);
  const ev = (event: string, $pathname = "/") => ({ event, properties: { $pathname, $current_url: `${CF}${$pathname}` } });
  assert.ok(filterOutgoingEvent(ev("$pageview"), CF, { statsOnly: true }));
  assert.ok(filterOutgoingEvent(ev("cta_clicked"), CF, { statsOnly: true }));
  assert.ok(filterOutgoingEvent(ev("form_submitted"), CF, { statsOnly: true }));
  for (const appEvent of ["login_succeeded", "report_approved", "form_uploaded", "draft_completed", "two_factor_enabled"]) {
    assert.equal(filterOutgoingEvent(ev(appEvent), CF, { statsOnly: true }), null, appEvent);
    assert.ok(filterOutgoingEvent(ev(appEvent), CF), `${appEvent} with consent`);
  }
  assert.equal(filterOutgoingEvent(ev("$autocapture"), CF, { statsOnly: true }), null);
  // ClinDesk's own pages count on its host.
  assert.ok(filterOutgoingEvent({ event: "$pageview", properties: { $pathname: "/features", $current_url: `${CD}/features` } }, CD, { statsOnly: true }));
});

test("page views keep the path, the five UTM tags, has_gclid and the referrer's domain – never the click id", () => {
  const out = filterOutgoingEvent(
    {
      event: "$pageview",
      properties: {
        $pathname: "/pricing",
        $current_url: `${CD}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_content=hero&utm_term=physio+software&gclid=Cj0KCQabc`,
        $referrer: "https://www.google.com/search?q=clinic+software",
        $referring_domain: "www.google.com",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "launch",
        utm_content: "hero",
        utm_term: "physio software",
        gclid: "Cj0KCQabc",
        has_gclid: true,
        email: "a@b.com",
      },
      $set_once: { $initial_gclid: "Cj0KCQabc", $initial_utm_source: "google" },
    },
    CD,
    { statsOnly: true },
  );
  assert.ok(out);
  const p = out.properties as Record<string, unknown>;
  assert.equal(p.$current_url, `${CD}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_content=hero&utm_term=physio+software`);
  assert.equal(p.$referrer, "https://www.google.com/");
  assert.equal(p.$referring_domain, "www.google.com");
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) assert.ok(typeof p[k] === "string", k);
  assert.equal(p.has_gclid, true);
  assert.ok(!("gclid" in p));
  assert.ok(!("email" in p));
  assert.ok(!JSON.stringify(out).includes("Cj0KCQabc"), "the click id never leaves");
  assert.equal(out.$set_once?.$initial_utm_source, "google");
  assert.equal(hasGclid("?gclid=x&utm_source=a"), true);
  assert.equal(hasGclid("?utm_source=a"), false);
});

test("the events allow-list: website events take only enumerated values", () => {
  assert.deepEqual(sanitizeProps({ cta_target: "book_demo", form: "demo_request", to_site: "clinforms", area: "marketing" }), {
    cta_target: "book_demo",
    form: "demo_request",
    to_site: "clinforms",
    area: "marketing",
  });
  assert.deepEqual(sanitizeProps({ cta_target: "javascript:alert(1)", form: "Megan Hart", to_site: "evil.com", name: "x", has_gclid: "yes" }), {});
  for (const e of ["cta_clicked", "form_started", "form_submitted", "cross_site_clicked"]) assert.ok(isAnalyticsEvent(e), e);
});

test("calls to action and links between the two sites are recognised by address", () => {
  assert.equal(ctaTarget("/demo", CD), "book_demo");
  assert.equal(ctaTarget("https://clindesk.co.uk/demo", CD), "book_demo");
  assert.equal(ctaTarget("/request-access", CF), "request_access");
  assert.equal(ctaTarget("/demo", CF), null, "ClinForms' /demo is the video, not a booking");
  assert.equal(ctaTarget("/pricing", CD), null);
  assert.equal(ctaTarget("#", CD, "book_visit"), "book_visit");
  assert.equal(crossSiteTarget("https://clinforms.co.uk/", "clindesk.co.uk"), "clinforms");
  assert.equal(crossSiteTarget("https://www.clindesk.co.uk/features", "clinforms.co.uk"), "clindesk");
  assert.equal(crossSiteTarget("https://clindesk.co.uk/", "clindesk.co.uk"), null, "same site");
  assert.equal(crossSiteTarget("https://example.com/", "clindesk.co.uk"), null);
  assert.equal(crossSiteTarget("mailto:hello@clindesk.co.uk", "clinforms.co.uk"), null);
});

/* ------------------------------------------------------------------------- opt-out in a (fake) browser */

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

test("turning statistics off stops sending at once and clears the analytics storage (ours only)", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const cookies = new Map<string, string>([["ph_abc_posthog", "1"], ["clinforms_consent", "v2.a1.m0.20261108"]]);
  const doc = {
    get cookie() {
      return Array.from(cookies, ([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(v: string) {
      const [pair, ...attrs] = v.split(";").map((s) => s.trim());
      const [k, val] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      if (attrs.some((a) => a === "Max-Age=0")) cookies.delete(k);
      else cookies.set(k, val);
    },
  };
  const saved = { window: g.window, document: g.document };
  g.window = { localStorage: local, sessionStorage: session, location: { origin: CF, search: "" } };
  g.document = doc;
  try {
    local.setItem("ph_phc_key_posthog", "{}");
    local.setItem("__ph_opt_in_out_phc_key", "1");
    local.setItem("medreport.demo", "keep");
    session.setItem("ph_phc_key_window_id", "x");
    stopAnalytics();
    assert.equal(local.getItem("ph_phc_key_posthog"), null);
    assert.equal(local.getItem("__ph_opt_in_out_phc_key"), null);
    assert.equal(session.getItem("ph_phc_key_window_id"), null);
    assert.equal(local.getItem("medreport.demo"), "keep", "other storage untouched");
    assert.ok(!cookies.has("ph_abc_posthog"));
    assert.ok(cookies.has("clinforms_consent"));
    // Nothing is sent after the stop (no library is loaded, and track is a no-op).
    assert.doesNotThrow(() => track("cta_clicked", { cta_target: "book_demo" }));
    clearAnalyticsStorage();
  } finally {
    g.window = saved.window;
    g.document = saved.document;
  }
});
