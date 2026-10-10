/**
 * The default `api` client and `passcodeVerifier` (api-client.ts) on a simulated page: a passcode stored in the
 * tab is never sent until the server accepts it on this page load; a refused one is removed from sessionStorage.
 * (Own file: the module singletons are per process.) Fictional values only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const RIGHT = "test-only-passcode-right";

test("the default client sends only a passcode the server accepted on this page load", async () => {
  const session = new MemoryStorage();
  const now = Math.floor(Date.now() / 1000);
  session.setItem(
    "medreport.session",
    JSON.stringify({
      token: "v1.session-for-tests.sig",
      expiresAt: new Date((now + 3600) * 1000).toISOString(),
      claims: { tenantId: "demo", sid: "ses_test", kind: "demo", iat: now, exp: now + 3600 },
    }),
  );
  session.setItem("medreport.passcode", "the-old-rotated-passcode");
  const g = globalThis as Record<string, unknown>;
  g.window = {
    localStorage: new MemoryStorage(),
    sessionStorage: session,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const sent: { path: string; passcode: string | null }[] = [];
  const realFetch = g.fetch;
  g.fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://studio.test").pathname;
    const passcode = new Headers(init.headers).get("x-medreport-passcode");
    sent.push({ path, passcode });
    if (path.endsWith("/passcode/check")) {
      if (passcode === RIGHT) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ type: "x", title: "Passcode not recognised", status: 401, code: "PASSCODE_INVALID" }), {
        status: 401,
        headers: { "content-type": "application/problem+json" },
      });
    }
    if (path.endsWith("/forms/samples")) return new Response(JSON.stringify({ samples: [] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    const { api, passcodeVerifier } = await import("./api-client");

    // Stored but not yet checked on this page load: not sent.
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null);
    assert.equal(passcodeVerifier.getState().status, "checking");

    // The page-load re-check: refused (rotated) → removed from the tab, notice raised, still not sent.
    assert.deepEqual(await passcodeVerifier.recheckStored(), { status: "none", notice: "rejected" });
    assert.equal(session.getItem("medreport.passcode"), null);
    assert.deepEqual(sent.at(-1), { path: "/api/reports/v1/passcode/check", passcode: "the-old-rotated-passcode" });
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null);

    // A wrong passcode typed in the dialog: refused, never stored, never sent.
    assert.deepEqual(await passcodeVerifier.submit("a-wrong-guess"), { kind: "invalid" });
    assert.equal(session.getItem("medreport.passcode"), null);
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null);

    // The right one: stored after 204, and from then on sent.
    assert.deepEqual(await passcodeVerifier.submit(RIGHT), { kind: "verified" });
    assert.equal(session.getItem("medreport.passcode"), RIGHT);
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, RIGHT);

    // Something writes a different passcode into the tab without the check: not sent.
    session.setItem("medreport.passcode", "written-without-a-check");
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null);
  } finally {
    delete g.window;
    g.fetch = realFetch;
  }
});
