/** Consent cookie format and the rules that decide whether analytics may run. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_VERSION,
  analyticsAllowed,
  consentCookieString,
  optOutSignalled,
  parseConsent,
  readConsentFromCookieString,
  serializeConsent,
  todayIso,
} from "./consent";
import { showsConsentBanner } from "../../lib/site";

test("a choice round-trips through the cookie value", () => {
  for (const analytics of [true, false]) {
    const choice = { version: CONSENT_VERSION, analytics, date: "2026-10-09" };
    const value = serializeConsent(choice);
    assert.match(value, /^v1\.a[01]\.20261009$/);
    assert.deepEqual(parseConsent(value), choice);
  }
});

test("malformed, foreign or older-version values are treated as no choice", () => {
  for (const value of [undefined, null, "", "yes", "v1.a2.20261009", "v1.a1.2026109", "v0.a1.20261009", "v2.a1.20261009", "v1.a1.20261399", "%E0%A4%A"]) {
    assert.equal(parseConsent(value as string | null | undefined), null, String(value));
  }
});

test("the consent cookie is read from a Cookie header among other cookies", () => {
  const header = `other=1; ${CONSENT_COOKIE}=v1.a0.20261001; clinforms.session_token=abc`;
  assert.deepEqual(readConsentFromCookieString(header), { version: 1, analytics: false, date: "2026-10-01" });
  assert.equal(readConsentFromCookieString("other=1"), null);
  assert.equal(readConsentFromCookieString(""), null);
});

test("the cookie is first-party, Lax, 6 months, and Secure on https", () => {
  const choice = { version: CONSENT_VERSION, analytics: true, date: "2026-10-09" };
  const secure = consentCookieString(choice, { secure: true });
  assert.equal(secure, `${CONSENT_COOKIE}=v1.a1.20261009; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`);
  assert.ok(!consentCookieString(choice, { secure: false }).includes("Secure"));
  assert.ok(!secure.toLowerCase().includes("domain="), "host-only cookie");
  assert.ok(CONSENT_MAX_AGE_SECONDS >= 180 * 86400 && CONSENT_MAX_AGE_SECONDS <= 183 * 86400);
});

test("Do Not Track and Global Privacy Control count as a refusal", () => {
  assert.equal(optOutSignalled({}), false);
  assert.equal(optOutSignalled({ doNotTrack: "0" }), false);
  assert.equal(optOutSignalled({ doNotTrack: "1" }), true);
  assert.equal(optOutSignalled({ doNotTrack: "yes" }), true);
  assert.equal(optOutSignalled({ windowDoNotTrack: "1" }), true);
  assert.equal(optOutSignalled({ globalPrivacyControl: true }), true);
});

test("analytics runs only with an explicit yes and no opt-out signal", () => {
  const yes = { version: 1, analytics: true, date: "2026-10-09" };
  const no = { ...yes, analytics: false };
  assert.equal(analyticsAllowed(null, {}), false);
  assert.equal(analyticsAllowed(no, {}), false);
  assert.equal(analyticsAllowed(yes, {}), true);
  assert.equal(analyticsAllowed(yes, { globalPrivacyControl: true }), false);
  assert.equal(analyticsAllowed(yes, { doNotTrack: "1" }), false);
});

test("todayIso is a UTC date", () => {
  assert.equal(todayIso(new Date("2026-10-09T23:30:00Z")), "2026-10-09");
});

test("the banner may ask only on public pages, never in the app, the demo, the APIs or the sign-in pages", () => {
  for (const p of ["/", "/privacy", "/cookies", "/terms", "/security", "/request-access", "/does-not-exist"]) {
    assert.equal(showsConsentBanner(p), true, p);
  }
  for (const p of [
    "/app",
    "/app/settings/members",
    "/reports",
    "/reports/rep_1",
    "/pms-sandbox/patients/sim-pat-001",
    "/api/access-requests",
    "/login",
    "/two-factor",
    "/accept-invite",
    "/reset-password",
  ]) {
    assert.equal(showsConsentBanner(p), false, p);
  }
  assert.equal(showsConsentBanner("/loginx"), true, "prefix match is per path segment");
});
