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
 * - binding Report API handlers to these dependencies for the thin route files;
 * - wave 2 – the host capabilities the module may not import itself (docs/production-architecture.md §3):
 *     authenticate   Better Auth session (read from the database, never the cookie cache) → AuthContext
 *                    (src/server/auth/medreport-actor.ts). Only consulted when the request carries a sign-in
 *                    cookie, so the public demo never needs the database or auth settings. A session without
 *                    an active clinic is 403 NO_CLINIC (never the demo); a sign-in that cannot be checked is 503.
 *     clinicProfile  clinic_profile → ClinicProfile
 *     sharedState    rate_limits / launch_token_uses (shared by every instance) when CLINFORMS_DB is set
 *     audit          audit_log (append-only)
 *     verifyPartnerKey  partner_keys (SHA-256, revocable; the key names its clinic)
 *   Each one degrades on its own: without a database the module keeps its per-instance fallbacks and the
 *   public demo keeps working.
 *
 * Only src/app may import both the module and the sandbox.
 *
 * Owner: integration agent (wave 2: API slice). (`route` and `getMedreportDeps` signatures are relied on by
 * every route file.)
 */
import type { AuthContext, MedreportDeps, SharedStateStore } from "@/modules/medreport/api/deps";
import { HttpError, bindHandler, logEvent, type HandlerFn, type MedreportHandler } from "@/modules/medreport/api/http";
import { getSecret, getTm3SimBaseUrl } from "@/modules/medreport/config.server";
import { createConnectorRegistry, createDefaultConnectors } from "@/modules/medreport/connectors/registry";
import { TRANSPORT_HEADER, type ConnectorFetch } from "@/modules/medreport/connectors/types";
import { WORDING } from "@/modules/medreport/core/wording";
import { dispatchSimRequest } from "@/sandbox/tm3-sim/handlers";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { getAuth } from "@/server/auth/auth";
import { loadClinicProfile, resolveMedreportCaller } from "@/server/auth/medreport-actor";
import { getDb, type Database } from "@/server/db";
import type { Kysely } from "kysely";
import { appendAudit } from "@/server/repos/audit";
import { claimLaunchToken } from "@/server/repos/launch-tokens";
import { partnerKeyTenant, verifyPartnerKey } from "@/server/repos/partner-keys";
import { hitRateLimit, peekRateLimit, resetRateLimit } from "@/server/repos/rate-limits";

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

/** Whether the request carries a sign-in cookie (Better Auth's session cookie, ClinForms prefix). */
export function hasSignInCookie(req: Request): boolean {
  const header = req.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => {
    const eq = part.indexOf("=");
    if (eq <= 0) return false;
    const name = part.slice(0, eq).trim();
    return (SESSION_COOKIE_NAMES as readonly string[]).indexOf(name) >= 0 && part.slice(eq + 1).trim() !== "";
  });
}

/**
 * MedreportDeps.authenticate: the signed-in clinic member, or null (no sign-in cookie, no valid session,
 * or auth not configured on this deployment – the public demo needs neither).
 */
export async function authenticateMember(req: Request): Promise<AuthContext | null> {
  if (!hasSignInCookie(req)) return null;
  let auth: ReturnType<typeof getAuth>;
  try {
    auth = getAuth();
  } catch (err) {
    logEvent("auth_unavailable", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
  let caller: Awaited<ReturnType<typeof resolveMedreportCaller>>;
  try {
    caller = await resolveMedreportCaller(auth, getDb(), req.headers);
  } catch (err) {
    logEvent("auth_check_failed", { error: err instanceof Error ? err.name : "error" });
    throw new HttpError(503, "Please try again shortly", {
      code: "SERVICE_UNAVAILABLE",
      detail: "Your sign-in could not be checked just now. Try again in a moment.",
      retryable: true,
    });
  }
  if (caller.kind === "none") return null;
  if (caller.kind === "no_clinic") {
    throw new HttpError(403, WORDING.server.access.noClinicTitle, { code: "NO_CLINIC", detail: WORDING.server.access.noClinicDetail });
  }
  return caller.context;
}

type DbSource = () => Kysely<Database>;

/** rate_limits / launch_token_uses: the state every server instance shares. */
export function dbSharedState(db: DbSource): SharedStateStore {
  return {
    async hit(key, windowMs) {
      const h = await hitRateLimit({ db: db() }, key, windowMs);
      return { count: h.count, resetAt: h.resetAt };
    },
    async peek(key, windowMs) {
      const h = await peekRateLimit({ db: db() }, key, windowMs);
      return { count: h.count, resetAt: h.resetAt };
    },
    async reset(key) {
      await resetRateLimit({ db: db() }, key);
    },
    claimOnce: (id, expiresAt) => claimLaunchToken({ db: db() }, id, expiresAt),
  };
}

/** audit_log (append-only). */
export function dbAudit(db: DbSource): NonNullable<MedreportDeps["audit"]> {
  return async (tenantId, event) => {
    await appendAudit({ db: db() }, tenantId, event);
  };
}

/** partner_keys: the key names its clinic; only an active (unrevoked) key of that clinic verifies. */
export function dbPartnerKeys(db: DbSource): NonNullable<MedreportDeps["verifyPartnerKey"]> {
  return async (key) => {
    const tenantId = partnerKeyTenant(key);
    if (!tenantId) return null;
    const verified = await verifyPartnerKey({ db: db() }, tenantId, key);
    return verified ? { id: verified.id, tenantId: verified.tenantId } : null;
  };
}

const DB_SHARED_STATE = dbSharedState(getDb);

/**
 * The shared store when this deployment names its database explicitly (CLINFORMS_DB – required on Vercel,
 * where instances are many). Unset (a local single process: `next dev`, `npm run demo:red`, tests) → none:
 * the module's per-process counters ARE shared state there, and the public demo never touches the local
 * database file.
 */
function sharedStateForEnv(): SharedStateStore | undefined {
  return process.env.CLINFORMS_DB?.trim() ? DB_SHARED_STATE : undefined;
}

/** The host capabilities of wave 2 (database-backed; see the header). */
export function hostCapabilities(): Pick<MedreportDeps, "authenticate" | "clinicProfile" | "sharedState" | "audit" | "verifyPartnerKey"> {
  return {
    authenticate: authenticateMember,
    clinicProfile: (tenantId) => loadClinicProfile(getDb(), tenantId),
    sharedState: sharedStateForEnv(),
    audit: dbAudit(getDb),
    verifyPartnerKey: dbPartnerKeys(getDb),
  };
}

let deps: MedreportDeps | null = null;

export function getMedreportDeps(): MedreportDeps {
  if (deps) return deps;
  deps = {
    ...hostCapabilities(),
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
