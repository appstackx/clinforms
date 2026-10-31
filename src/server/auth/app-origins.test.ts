/**
 * The app's own origins for the origin/CSRF checks outside Better Auth (src/server/auth/config.ts allowedAppOrigins /
 * isAllowedAppOrigin – used by the clinic system's route handlers and the public request forms): exactly the
 * origins sign-in trusts – BETTER_AUTH_URL + CLINFORMS_AUTH_ORIGINS, a preview's own hostnames – never one derived
 * from the request.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedAppOrigins, isAllowedAppOrigin, trustedOriginsOf, baseUrlSetting } from "./config";

const CLINFORMS = "https://clinforms.co.uk";
const CLINDESK = "https://clindesk.co.uk";
const PROD = { VERCEL: "1", VERCEL_ENV: "production", BETTER_AUTH_URL: CLINFORMS };

describe("app origins (origin checks outside sign-in)", () => {
  it("production with CLINFORMS_AUTH_ORIGINS: both brands' origins, the same list sign-in trusts", () => {
    const env = { ...PROD, CLINFORMS_AUTH_ORIGINS: CLINDESK };
    assert.deepEqual(allowedAppOrigins(env), [CLINFORMS, CLINDESK]);
    assert.deepEqual(allowedAppOrigins(env), trustedOriginsOf(baseUrlSetting(env)));
    assert.equal(isAllowedAppOrigin(CLINFORMS, env), true);
    assert.equal(isAllowedAppOrigin(CLINDESK, env), true);
    assert.equal(isAllowedAppOrigin("https://CLINDESK.co.uk", env), true, "case of the host does not matter");
    assert.equal(isAllowedAppOrigin("https://clindesk.co.uk:443", env), true, "the default port is the same origin");
  });

  it("foreign, look-alike, other-scheme, other-port, missing, null and malformed origins are refused", () => {
    const env = { ...PROD, CLINFORMS_AUTH_ORIGINS: CLINDESK };
    for (const bad of [
      "https://evil.example",
      "https://clindesk.co.uk.evil.example",
      "https://evilclindesk.co.uk",
      "http://clindesk.co.uk",
      "https://clindesk.co.uk:8443",
      "https://www.clindesk.co.uk",
      "null",
      "",
      "   ",
      "clindesk.co.uk",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      assert.equal(isAllowedAppOrigin(bad, env), false, bad);
    }
    assert.equal(isAllowedAppOrigin(null, env), false);
    assert.equal(isAllowedAppOrigin(undefined, env), false);
  });

  it("production without CLINFORMS_AUTH_ORIGINS: ClinForms only (the clinic brand's host is refused, as sign-in is)", () => {
    assert.deepEqual(allowedAppOrigins(PROD), [CLINFORMS]);
    assert.equal(isAllowedAppOrigin(CLINDESK, PROD), false);
  });

  it("previews: this deployment's own hostnames only (CLINFORMS_AUTH_ORIGINS ignored, as for sign-in)", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "clinforms-abc.vercel.app", VERCEL_BRANCH_URL: "clinforms-git-x.vercel.app", CLINFORMS_AUTH_ORIGINS: CLINDESK };
    assert.equal(isAllowedAppOrigin("https://clinforms-abc.vercel.app", env), true);
    assert.equal(isAllowedAppOrigin("https://clinforms-git-x.vercel.app", env), true);
    assert.equal(isAllowedAppOrigin("https://clinforms-other.vercel.app", env), false);
    assert.equal(isAllowedAppOrigin(CLINDESK, env), false);
    assert.equal(isAllowedAppOrigin(CLINFORMS, env), false);
  });

  it("locally (next start on :3180): localhost and clinic.localhost on that port – the request URL plays no part", () => {
    const env = { BETTER_AUTH_URL: "http://localhost:3180", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3180" };
    assert.equal(isAllowedAppOrigin("http://localhost:3180", env), true);
    assert.equal(isAllowedAppOrigin("http://clinic.localhost:3180", env), true);
    assert.equal(isAllowedAppOrigin("http://clinic.localhost:3181", env), false);
    assert.equal(isAllowedAppOrigin("http://127.0.0.1:3180", env), false);
    // No BETTER_AUTH_URL: localhost:$PORT, as sign-in.
    assert.deepEqual(allowedAppOrigins({ PORT: "3199" }), ["http://localhost:3199"]);
  });

  it("a configuration error (a non-brand host in CLINFORMS_AUTH_ORIGINS, production without BETTER_AUTH_URL) allows nothing", () => {
    assert.deepEqual(allowedAppOrigins({ ...PROD, CLINFORMS_AUTH_ORIGINS: "https://evil.example" }), []);
    assert.equal(isAllowedAppOrigin(CLINFORMS, { ...PROD, CLINFORMS_AUTH_ORIGINS: "https://evil.example" }), false);
    assert.deepEqual(allowedAppOrigins({ VERCEL: "1", VERCEL_ENV: "production" }), []);
  });
});
