/** Clinic-system route handlers: the same-origin rule for writes (src/server/pms/http.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clinicRoute, sameOrigin } from "./http";

describe("clinic-system route handlers", () => {
  it("same origin only for writes", () => {
    const at = (origin?: string) => new Request("https://clinforms.co.uk/app/clinic/x", { method: "POST", headers: origin ? { origin } : {} });
    assert.equal(sameOrigin(at("https://clinforms.co.uk")), true);
    assert.equal(sameOrigin(at("https://evil.example.com")), false);
    assert.equal(sameOrigin(at()), false, "no Origin header = refused");
    assert.equal(sameOrigin(at("null")), false);
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
