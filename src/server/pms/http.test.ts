/** Clinic-system route handlers: the origin rule for writes (src/server/pms/http.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clinicRoute, sameOrigin } from "./http";

const PROD = { VERCEL: "1", VERCEL_ENV: "production", BETTER_AUTH_URL: "https://clinforms.co.uk", CLINFORMS_AUTH_ORIGINS: "https://clindesk.co.uk" };

describe("clinic-system route handlers", () => {
  it("writes only from the app's own origins: both brand hosts in production, nothing else", () => {
    const at = (url: string, origin?: string) => new Request(url, { method: "POST", headers: origin ? { origin } : {} });
    assert.equal(sameOrigin(at("https://clinforms.co.uk/app/clinic/x", "https://clinforms.co.uk"), PROD), true);
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x", "https://clindesk.co.uk"), PROD), true, "the clinic brand's host");
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x", "https://evil.example.com"), PROD), false);
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x", "https://clindesk.co.uk.evil.example.com"), PROD), false);
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x"), PROD), false, "no Origin header = refused");
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x", "null"), PROD), false);
    // Without CLINFORMS_AUTH_ORIGINS the clinic brand's host is not one of the app's origins (sign-in refuses it too).
    const { CLINFORMS_AUTH_ORIGINS: _omit, ...withoutBrand } = PROD;
    assert.equal(sameOrigin(at("https://clindesk.co.uk/app/clinic/x", "https://clindesk.co.uk"), withoutBrand), false);
    assert.equal(sameOrigin(at("https://clinforms.co.uk/app/clinic/x", "https://clinforms.co.uk"), withoutBrand), true);
  });

  it("the bug: on `next start` the request URL names localhost:<port> whatever the host – clinic.localhost is still accepted", () => {
    const local = { BETTER_AUTH_URL: "http://localhost:3180", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3180" };
    const req = (origin: string) => new Request("http://localhost:3180/app/clinic/diary/api/patients", { method: "POST", headers: { origin, host: "clinic.localhost:3180" } });
    assert.equal(sameOrigin(req("http://clinic.localhost:3180"), local), true);
    assert.equal(sameOrigin(req("http://localhost:3180"), local), true);
    assert.equal(sameOrigin(req("http://evil.localhost:3180"), local), false);
  });

  it("a cross-origin write is refused before anything else runs", async () => {
    let ran = false;
    const handler = clinicRoute({ permission: "patients.edit" }, async () => {
      ran = true;
      return new Response("ok");
    });
    const res = await handler(new Request("https://clinforms.co.uk/app/clinic/x", { method: "POST", headers: { origin: "https://evil.example.com" } }), { params: {} });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: { code: "CROSS_ORIGIN", message: "This request must come from the clinic's own pages." } });
    assert.equal(ran, false);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});
