/**
 * A clinic's own Studio (server storage) never mints or sends a public-demo session: the member's sign-in cookie
 * identifies the caller, and approvals must not depend on the public demo being switched on (wave 2 integration).
 * The public demo (browser storage) keeps getting a demo session before a call that needs a caller.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api } from "./api-client";
import { sessionTokenFor } from "./components/shared/session";
import { setSession, setStoreMode } from "./store";
import type { SessionToken } from "../core/types";

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

interface Call {
  path: string;
  authorization: string | null;
}

const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch };
const realFetch = g.fetch;
let calls: Call[] = [];

function session(tenantId: string, kind: "demo" | "launch"): SessionToken {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    token: `tok-${tenantId}-${kind}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    claims: {
      sid: `sid-${tenantId}`,
      tenantId,
      kind,
      iat: exp - 3600,
      exp,
      ...(kind === "launch" ? { connectorId: "file-import", patientId: "p1", episodeId: "e1" } : {}),
    },
  };
}

beforeEach(() => {
  calls = [];
  g.window = { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage() };
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, authorization: headers.get("authorization") });
    if (path.endsWith("/sessions/demo")) {
      return new Response(JSON.stringify({ session: session("demo", "demo") }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ type: "about:blank", title: "stub", status: 418, code: "STUB" }), {
      status: 418,
      headers: { "content-type": "application/problem+json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  setStoreMode("browser");
  g.fetch = realFetch;
  delete g.window;
});

describe("sessions in a clinic's Studio vs the public demo", () => {
  it("server storage: no demo session is minted for approvals, and none is sent with API calls", async () => {
    setStoreMode("server");
    assert.equal(await sessionTokenFor({ tenantId: "clinic-a" }), null);
    await api.validate({ report: {} } as never).catch(() => undefined);
    assert.equal(calls.filter((c) => c.path.endsWith("/sessions/demo")).length, 0);
    const validate = calls.find((c) => c.path.endsWith("/validate"));
    assert.ok(validate);
    assert.equal(validate.authorization, null);
  });

  it("server storage: a demo session left in the tab is not sent; the clinic's own launch session is", async () => {
    setStoreMode("server");
    setSession(session("demo", "demo"));
    await api.validate({ report: {} } as never).catch(() => undefined);
    assert.equal(calls.at(-1)?.authorization, null);
    setSession(session("clinic-a", "launch"));
    await api.validate({ report: {} } as never).catch(() => undefined);
    assert.equal(calls.at(-1)?.authorization, "Bearer tok-clinic-a-launch");
    assert.equal(await sessionTokenFor({ tenantId: "clinic-a", connectorId: "file-import", patientId: "p1", episodeId: "e1" }), "tok-clinic-a-launch");
  });

  it("browser storage (the public demo): a demo session is minted once and sent", async () => {
    setStoreMode("browser");
    await api.validate({ report: {} } as never).catch(() => undefined);
    assert.equal(calls.filter((c) => c.path.endsWith("/sessions/demo")).length, 1);
    assert.equal(calls.find((c) => c.path.endsWith("/validate"))?.authorization, "Bearer tok-demo-demo");
    assert.equal(await sessionTokenFor({ tenantId: "demo" }), "tok-demo-demo");
  });
});
