/** The public request forms' origin check (src/server/site/request.ts isSameOrigin): the app's own origins only. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSameOrigin } from "./request";

const PROD = { VERCEL: "1", VERCEL_ENV: "production", BETTER_AUTH_URL: "https://clinforms.co.uk", CLINFORMS_AUTH_ORIGINS: "https://clindesk.co.uk" };
const h = (origin?: string, host = "clindesk.co.uk") => new Headers({ host, ...(origin ? { origin } : {}) });

describe("public request forms: origin check", () => {
  it("ClinForms' request-access and ClinDesk's book-a-demo: each brand's own origin passes", () => {
    assert.equal(isSameOrigin(h("https://clinforms.co.uk", "clinforms.co.uk"), PROD), true);
    assert.equal(isSameOrigin(h("https://clindesk.co.uk"), PROD), true);
  });
  it("a foreign origin is refused, even when it names the Host it was sent to (Host is client-controlled)", () => {
    assert.equal(isSameOrigin(h("https://evil.example"), PROD), false);
    assert.equal(isSameOrigin(h("https://evil.example", "evil.example"), PROD), false);
    assert.equal(isSameOrigin(h("null"), PROD), false);
    assert.equal(isSameOrigin(h("http://clindesk.co.uk"), PROD), false);
  });
  it("no Origin at all passes (an older browser's same-origin POST; a server-side call) – as before", () => {
    assert.equal(isSameOrigin(h(), PROD), true);
  });
  it("locally: localhost and clinic.localhost on the configured port", () => {
    const local = { BETTER_AUTH_URL: "http://localhost:3180", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3180" };
    assert.equal(isSameOrigin(h("http://clinic.localhost:3180", "clinic.localhost:3180"), local), true);
    assert.equal(isSameOrigin(h("http://localhost:3180", "localhost:3180"), local), true);
    assert.equal(isSameOrigin(h("http://evil.localhost:3180", "evil.localhost:3180"), local), false);
  });
});
