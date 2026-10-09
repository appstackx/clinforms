import "server-only";

/**
 * THE single place where the host app wires the ClinForms module to its surroundings:
 * - the connector registry (simulated TM3, file import, real-TM3 placeholder);
 * - the transport for the simulated TM3 API: real HTTP to a TRUSTED base URL (simTrustedBaseUrl():
 *   TM3_SIM_BASE_URL, else this Vercel deployment's own VERCEL_URL, else this server's own loopback
 *   port), falling back to in-process calls (dispatchSimRequest) when HTTP is blocked, e.g. by Vercel
 *   preview protection or a loopback/DNS problem – the trace then shows transport "in-process".
 *   The base URL is NEVER taken from request headers (Host / X-Forwarded-Host are client-controlled
 *   on a self-hosted server, and the call carries the TM3_SIM_TOKEN bearer token);
 * - binding Report API handlers to these dependencies for the thin route files.
 *
 * Only src/app may import both the module and the sandbox.
 *
 * Owner: integration agent. (`route` and `getMedreportDeps` signatures are relied on by every route file.)
 */
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { bindHandler, logEvent, type HandlerFn, type MedreportHandler } from "@/modules/medreport/api/http";
import { getSecret, getTm3SimBaseUrl } from "@/modules/medreport/config.server";
import { createConnectorRegistry, createDefaultConnectors } from "@/modules/medreport/connectors/registry";
import { TRANSPORT_HEADER, type ConnectorFetch } from "@/modules/medreport/connectors/types";
import { dispatchSimRequest } from "@/sandbox/tm3-sim/handlers";

/** After HTTP to the simulated API fails once, use in-process calls for this long (per instance). */
const HTTP_RETRY_AFTER_MS = 5 * 60_000;
/** Give up on an HTTP attempt after this long and fall back (in-process is instant). */
const HTTP_ATTEMPT_TIMEOUT_MS = 6_000;
let httpBlockedUntil = 0;

/** Force a transport (tests, local debugging): MEDREPORT_SIM_TRANSPORT=in-process | http. */
function forcedTransport(): "in-process" | "http" | null {
  const v = process.env.MEDREPORT_SIM_TRANSPORT?.trim().toLowerCase();
  return v === "in-process" || v === "http" ? v : null;
}

async function inProcess(url: string, init?: RequestInit): Promise<Response> {
  const res = await dispatchSimRequest(new Request(url, init));
  const headers = new Headers(res.headers);
  headers.set(TRANSPORT_HEADER, "in-process");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Placeholder base URL when no trusted HTTP target exists: every call goes in-process. */
const IN_PROCESS_BASE = "http://in-process.invalid";

function originOf(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const url = new URL(raw.includes("://") ? raw.trim() : `https://${raw.trim()}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** This Vercel deployment's own origin (platform-set, never from the request). */
function vercelSelfOrigin(): string | null {
  return process.env.VERCEL === "1" ? originOf(process.env.VERCEL_URL) : null;
}

/**
 * Where the simulated TM3 API is called over HTTP – only ever a target this server trusts:
 * TM3_SIM_BASE_URL, else this Vercel deployment (VERCEL_URL), else this server's own port on the
 * loopback interface (process.env.PORT, set by `next start` / `next dev`). Null = in-process only.
 * Never derived from Host / X-Forwarded-Host.
 */
export function simTrustedBaseUrl(): string | null {
  const configured = originOf(getTm3SimBaseUrl() ?? undefined);
  if (configured) return configured;
  const vercel = vercelSelfOrigin();
  if (vercel) return vercel;
  const port = process.env.PORT?.trim();
  if (port && /^\d{2,5}$/.test(port)) return `http://127.0.0.1:${port}`;
  return null;
}

async function overHttp(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  // Vercel deployment protection: the bypass secret goes ONLY to this deployment's own URL.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const self = vercelSelfOrigin();
  if (bypass && self && new URL(url).origin === self) headers.set("x-vercel-protection-bypass", bypass);
  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(HTTP_ATTEMPT_TIMEOUT_MS),
  });
}

/**
 * HTTP first; if blocked (network error, timeout, or a response that is not from the simulated API –
 * e.g. a preview-protection login page or redirect), in-process for the next few minutes.
 * Responses from the simulated API (header x-simulated: true) are returned as they are, errors included.
 */
const simTransport: ConnectorFetch = async (url, init) => {
  const forced = forcedTransport();
  if (forced === "in-process" || url.startsWith(IN_PROCESS_BASE)) return inProcess(url, init);
  if (forced === "http" || Date.now() >= httpBlockedUntil) {
    // A body stream can only be sent once; keep a copy for the fallback.
    const bodyCopy = typeof init?.body === "string" || init?.body == null ? init?.body : undefined;
    try {
      const res = await overHttp(url, init);
      if (res.headers.get("x-simulated") === "true" || forced === "http") return res;
      logEvent("sim_transport_fallback", { reason: "not_simulated_response", status: res.status });
    } catch (err) {
      if (forced === "http") throw err;
      logEvent("sim_transport_fallback", { reason: err instanceof Error ? err.name : "error" });
    }
    httpBlockedUntil = Date.now() + HTTP_RETRY_AFTER_MS;
    return inProcess(url, { ...init, body: bodyCopy });
  }
  return inProcess(url, init);
};

let deps: MedreportDeps | null = null;

export function getMedreportDeps(): MedreportDeps {
  if (deps) return deps;
  deps = {
    connectors: createConnectorRegistry(createDefaultConnectors()),
    createConnectorContext(req, connectorId, tenantId) {
      void req; // the request is deliberately NOT used for the base URL (see simTrustedBaseUrl)
      if (connectorId === "tm3-sim") {
        return {
          tenantId,
          credentials: { kind: "bearer", token: getSecret("TM3_SIM_TOKEN") },
          baseUrl: (simTrustedBaseUrl() ?? IN_PROCESS_BASE).replace(/\/+$/, ""),
          fetch: simTransport,
          trace: [],
        };
      }
      // file-import parses locally; tm3 is not configured. Neither makes outbound calls.
      return { tenantId, credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] };
    },
  };
  return deps;
}

/** Bind a Report API handler for a route file: `export const GET = route(handleHealth);` */
export function route(handler: MedreportHandler): HandlerFn {
  return bindHandler(handler, getMedreportDeps);
}
