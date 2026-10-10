/**
 * The default `api` client and `passcodeVerifier` (api-client.ts) on a simulated page: a passcode stored in the
 * tab is never sent until the server accepts it on this page load; a refused one is removed from sessionStorage;
 * and a verified one that a live call is refused for (rotated while the tab was open) is dropped at once – badge
 * back to demo, notice, never sent again. (Own file: the module singletons are per process.) Fictional values only.
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
  /** The server's passcode (changed below: rotated while the tab is open). */
  let serverPasscode = RIGHT;
  const refused = () =>
    new Response(JSON.stringify({ type: "x", title: "Passcode not recognised", status: 401, code: "PASSCODE_INVALID" }), {
      status: 401,
      headers: { "content-type": "application/problem+json" },
    });
  g.fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://studio.test").pathname;
    const passcode = new Headers(init.headers).get("x-medreport-passcode");
    sent.push({ path, passcode });
    if (path.endsWith("/passcode/check")) return passcode === serverPasscode ? new Response(null, { status: 204 }) : refused();
    if (path.endsWith("/drafts") && passcode && passcode !== serverPasscode) return refused();
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

    // A wrong passcode typed in the dialog now: refused, and the verified one stays (and is still sent).
    assert.deepEqual(await passcodeVerifier.submit("another-wrong-guess"), { kind: "invalid" });
    assert.equal(passcodeVerifier.verifiedPasscode(), RIGHT);
    assert.equal(session.getItem("medreport.passcode"), RIGHT);

    // The server's passcode is rotated while the tab is open. The next live call is refused (401) – the client
    // drops the passcode at once: the badge is back to demo ("none"), the notice says why, nothing more is sent.
    serverPasscode = "test-only-passcode-rotated";
    const states: string[] = [];
    const unsubscribe = passcodeVerifier.subscribe(() => states.push(passcodeVerifier.getState().status));
    const err = await api.drafts({} as never).then(
      () => assert.fail("refused"),
      (e: unknown) => e as { status?: number; code?: string },
    );
    assert.equal(err.status, 401);
    assert.equal(err.code, "PASSCODE_INVALID");
    assert.deepEqual(sent.at(-1), { path: "/api/reports/v1/drafts", passcode: RIGHT });
    assert.equal(passcodeVerifier.verifiedPasscode(), null);
    assert.deepEqual(passcodeVerifier.getState(), { status: "none", notice: "rejected" });
    assert.deepEqual(states, ["none"]);
    assert.equal(session.getItem("medreport.passcode"), null);
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null, "never sent again");
    assert.equal(await passcodeVerifier.reconfirm(), false, "nothing left to confirm");
    unsubscribe();

    // The new passcode, entered in the dialog, is checked and used.
    assert.deepEqual(await passcodeVerifier.submit("test-only-passcode-rotated"), { kind: "verified" });
    assert.deepEqual(passcodeVerifier.getState(), { status: "verified", notice: null });
    assert.equal(await passcodeVerifier.reconfirm(), true);

    // Rotated again: the re-confirmation before a run of live calls catches it with ONE check (one wrong guess).
    serverPasscode = "test-only-passcode-rotated-again";
    const before = sent.length;
    assert.equal(await passcodeVerifier.reconfirm(), false);
    assert.deepEqual(sent.slice(before), [{ path: "/api/reports/v1/passcode/check", passcode: "test-only-passcode-rotated" }]);
    assert.deepEqual(passcodeVerifier.getState(), { status: "none", notice: "rejected" });

    // Something writes a different passcode into the tab without the check: not sent.
    session.setItem("medreport.passcode", "written-without-a-check");
    await api.formSamples();
    assert.equal(sent.at(-1)?.passcode, null);
  } finally {
    delete g.window;
    g.fetch = realFetch;
  }
});
