/**
 * TESTS ONLY: drives the tenant-storage handlers (/api/reports/v1/store/**) in process.
 *
 * - storeDeps(store, actors): MedreportDeps whose `authenticate` reads the test cookie "member=<key>" and returns
 *   actors[key] (null when absent) – the stand-in for the host's Better Auth lookup.
 * - storeFetch(deps, {member}): a fetch() that routes /api/reports/v1/store/** (and /render, /forms/fill-preview)
 *   to the real handlers through bindHandler, as the route files do; same-origin like the browser (Origin header,
 *   cookie). Used by the Studio store tests to run the real client against the real handlers.
 */
import type { AuthContext, MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleFormsFillPreview } from "../../src/modules/medreport/api/handlers/forms-fill-preview";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleStoreFileChunk, handleStoreFileComplete, handleStoreFileGet, handleStoreFileInit } from "../../src/modules/medreport/api/handlers/store-files";
import { handleStoreFormDelete, handleStoreFormGet, handleStoreFormPut } from "../../src/modules/medreport/api/handlers/store-forms";
import { handleStoreReportDelete, handleStoreReportGet, handleStoreReportPut } from "../../src/modules/medreport/api/handlers/store-reports";
import { handleStoreSettingsGet, handleStoreSettingsPut } from "../../src/modules/medreport/api/handlers/store-settings";
import { handleStoreSnapshot } from "../../src/modules/medreport/api/handlers/store-snapshot";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import { STORE_API_ENDPOINTS } from "../../src/modules/medreport/api/store-contract";
import type { TenantStore } from "../../src/modules/medreport/api/store-port";

export const ORIGIN = "http://localhost";

export function member(tenantId: string, opts: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `user-${tenantId}`,
    authSessionId: `sess-${tenantId}`,
    tenantId,
    role: "clinician",
    twoFactorVerified: true,
    ...opts,
  };
}

export function storeDeps(store: TenantStore, actors: Record<string, AuthContext>): MedreportDeps {
  return {
    connectors: { list: () => [], get: () => undefined } as unknown as MedreportDeps["connectors"],
    createConnectorContext: () => {
      throw new Error("not used");
    },
    tenantStore: store,
    async authenticate(req) {
      const match = /(?:^|;\s*)member=([^;]+)/.exec(req.headers.get("cookie") ?? "");
      return match ? (actors[match[1]] ?? null) : null;
    },
  };
}

const HANDLERS: Record<string, MedreportHandler> = {
  handleStoreSnapshot,
  handleStoreReportGet,
  handleStoreReportPut,
  handleStoreReportDelete,
  handleStoreFormGet,
  handleStoreFormPut,
  handleStoreFormDelete,
  handleStoreFileInit,
  handleStoreFileGet,
  handleStoreFileChunk,
  handleStoreFileComplete,
  handleStoreSettingsGet,
  handleStoreSettingsPut,
};

const EXTRA = [
  { method: "POST", path: "/api/reports/v1/render", handler: handleRender },
  { method: "POST", path: "/api/reports/v1/forms/fill-preview", handler: handleFormsFillPreview },
];

function match(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split("/");
  const b = pathname.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const m = /^\[(.+)\]$/.exec(a[i]);
    if (m) params[m[1]] = b[i];
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export interface FetchLog {
  method: string;
  path: string;
  status: number;
  ifMatch: string | null;
  keepalive: boolean;
}

/** fetch() for the Studio's server store, served by the real handlers. */
export function storeFetch(deps: MedreportDeps, opts: { member?: string | null; log?: FetchLog[]; origin?: string } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (opts.member) headers.set("cookie", `member=${opts.member}`);
    if (method !== "GET" && method !== "HEAD") headers.set("origin", opts.origin ?? ORIGIN);
    const request = new Request(url.href, { method, headers, body: init?.body ?? undefined });
    let res: Response | null = null;
    for (const ep of STORE_API_ENDPOINTS) {
      if (ep.method !== method) continue;
      const params = match(ep.path, url.pathname);
      if (params) {
        res = await bindHandler(HANDLERS[ep.fn], () => deps)(request, { params });
        break;
      }
    }
    if (!res) {
      const extra = EXTRA.find((e) => e.method === method && e.path === url.pathname);
      res = extra ? await bindHandler(extra.handler, () => deps)(request, { params: {} }) : new Response("not found", { status: 404 });
    }
    opts.log?.push({ method, path: url.pathname, status: res.status, ifMatch: headers.get("if-match"), keepalive: Boolean(init?.keepalive) });
    return res;
  }) as typeof fetch;
}
