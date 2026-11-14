/**
 * The public clinic API's HTTP layer (/api/clinic/v1/**, tracker xt03, docs/clinic-system/api.md). Every route file
 * is a thin wrapper:
 *
 *   const r = clinicApiRoute({ GET: { scope: "appointments:read", handle: listAppointments } });
 *   export const GET = r.GET; …
 *
 * Order of the checks (each answers with the consistent body {"error": {"code", "message"}}):
 *   1. platform switch CLINFORMS_CLINIC_API=on – else 404 for EVERY method and path (the API does not exist);
 *   2. the method – 405 (OPTIONS too: no CORS headers are ever sent, so browsers on other sites are refused);
 *   3. HTTPS – a plain-HTTP request (except to localhost) is refused 403;
 *   4. query string ≤ 2 KiB;
 *   5. Authorization: Bearer <key> only (cookies are never read – no session, no CSRF surface) → 401:
 *      – no header, or not a well-formed key: refused WITHOUT any database write; an in-memory per-instance token
 *        bucket per network (pre-filter) answers 429 when one network sends too many of these;
 *      – a well-formed key is VERIFIED FIRST. A right key is never refused for others' failures. A wrong one counts
 *        against its presented lookup and against its network (rate_limits rows – the only writes before auth);
 *        once either is over its limit, wrong keys get 429 (no further write) – a right key still gets in;
 *   6. the key's clinic has the clinic package AND its API setting on → else 403 API_OFF;
 *   7. per-key rate limit (429); the endpoint's scope (403);
 *   8. POST: JSON only (415), ≤ 8 KiB (413);
 *   9. the call is counted (pms_api_key_days, last_used_at), then the handler runs.
 * Responses are never cached (no-store) and never set a cookie. Handler errors: ApiError → its status; RepoInputError
 * → 422; anything else → 500 (logged by name only, nothing of the cause in the response).
 */
import "server-only";
import type { Kysely } from "kysely";
import { packageIsOn } from "../../../../modules/pms/core/entitlements";
import { pmsNow } from "../../../../modules/pms/core/clock";
import { API_ERRORS, API_LIMITS, bearerToken, clinicApiSwitchOn, parseApiKey, type ApiErrorCode, type ApiScope } from "../../../../modules/pms/integration/api";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { getDataCipher, type DataCipher } from "../../../crypto";
import { getDb, type Database } from "../../../db";
import { logAuthEvent } from "../../../email/log";
import { RepoInputError, type RepoContext } from "../../../repos/context";
import { listEntitlements } from "../../../repos/pms/entitlements";
import { getApiSettings, recordApiUse, verifyApiKey, type VerifiedApiKey } from "../../../repos/pms/integration/api-keys";
import { hitRateLimit, peekRateLimit } from "../../../repos/rate-limits";
import { trialWriteBlock } from "../../../trial/access";
import { ipLimitSubject, signupClientIp } from "../../../signup/client-ip";

type Env = Readonly<Record<string, string | undefined>>;

export interface ClinicApiDeps {
  db: () => Kysely<Database>;
  cipher: () => DataCipher;
  env: Env;
  now: () => Date;
  /** Tests lower the limits. */
  limits?: Partial<Record<LimitName, number>>;
}

type LimitName = "perKeyPerMinute" | "anonPerIpPerMinute" | "failedPerKeyPer10Minutes" | "failedPerIpPer10Minutes";

/* ------------------------------------------------------------------------------------------------
 * In-memory pre-filter for requests without a usable key (per server instance; no database write)
 * ----------------------------------------------------------------------------------------------*/

const anonBuckets = new Map<string, { tokens: number; at: number }>();
const ANON_BUCKETS_MAX = 10_000;

/** Takes one token from the network's bucket (refills perMinute per minute, holds at most perMinute). */
export function takeAnonToken(subject: string, perMinute: number, nowMs: number): boolean {
  if (anonBuckets.size >= ANON_BUCKETS_MAX && !anonBuckets.has(subject)) anonBuckets.clear();
  const b = anonBuckets.get(subject) ?? { tokens: perMinute, at: nowMs };
  b.tokens = Math.min(perMinute, b.tokens + Math.max(0, ((nowMs - b.at) / 60_000) * perMinute));
  b.at = nowMs;
  anonBuckets.set(subject, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function defaultApiDeps(): ClinicApiDeps {
  return { db: getDb, cipher: getDataCipher, env: process.env, now: pmsNow };
}

/** Who is calling: the verified key, its clinic and the repositories' context. */
export interface ApiCaller {
  tenantId: string;
  key: VerifiedApiKey;
  /** The key's sites (null = every site). */
  siteIds: ReadonlySet<string> | null;
  ctx: RepoContext;
  /** Audit rows of API writes: no member – the key is named in the detail. */
  actor: PmsActor;
  deps: ClinicApiDeps;
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? API_ERRORS[code].message);
    this.name = "ApiError";
  }
  get status(): number {
    return API_ERRORS[this.code].status;
  }
}

export interface ApiReply {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ApiEndpoint<P> {
  /** null = no key needed (the OpenAPI document). */
  scope: ApiScope | null;
  handle: (req: ApiRequest<P>) => Promise<ApiReply>;
}

export interface ApiRequest<P> {
  caller: ApiCaller;
  url: URL;
  params: P;
  headers: Headers;
  /** POST: the parsed JSON body. */
  body: unknown;
}

export interface PublicApiEndpoint {
  scope: null;
  handle: (req: { url: URL; deps: ClinicApiDeps }) => Promise<ApiReply>;
}

/**
 * Headers of every API answer. Referrer-Policy, X-Content-Type-Options and the other security headers come ONCE
 * from next.config.mjs (securityHeaders on "/:path*") – setting them here too sent each header twice.
 */
export const API_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const BASE_HEADERS = API_RESPONSE_HEADERS;

export function apiJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function apiErrorResponse(code: ApiErrorCode, message?: string, headers: Record<string, string> = {}): Response {
  return apiJson(API_ERRORS[code].status, { error: { code, message: message ?? API_ERRORS[code].message } }, headers);
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i;

/** HTTPS, judged by the request URL and the proxy's x-forwarded-proto; plain HTTP only to a local host. */
export function isSecureRequest(req: Request): boolean {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = forwarded || url.protocol.replace(":", "");
  if (proto === "https") return true;
  return LOCAL_HOST.test(host) && LOCAL_HOST.test(url.host);
}

async function readJsonBody(req: Request): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > API_LIMITS.maxBodyBytes) throw new ApiError("PAYLOAD_TOO_LARGE");
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > API_LIMITS.maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("INVALID_REQUEST", "The body is not valid JSON.");
  }
}

function retryAfter(resetAt: string, now: Date): Record<string, string> {
  return { "retry-after": String(Math.max(1, Math.ceil((Date.parse(resetAt) - now.getTime()) / 1000))) };
}

async function clinicApiOn(ctx: RepoContext, tenantId: string, now: Date): Promise<boolean> {
  try {
    const rows = await listEntitlements(ctx, tenantId);
    if (!packageIsOn("clinic", rows.find((e) => e.package === "clinic") ?? null, now)) return false;
    return (await getApiSettings(ctx, tenantId)).enabled;
  } catch (err) {
    logAuthEvent("pms.api.settings_unreadable", { error: err instanceof Error ? err.name : "error" });
    return false;
  }
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];
type RouteHandler<P> = (req: Request, ctx: { params: P }) => Promise<Response>;

/** One handler per HTTP method for a route file (anything not given answers 405 – or 404 while switched off). */
export function clinicApiRoute<P = Record<string, string>>(
  endpoints: Partial<Record<"GET" | "POST", ApiEndpoint<P>>>,
  depsOf: () => ClinicApiDeps = defaultApiDeps,
): Record<Method, RouteHandler<P>> {
  const out = {} as Record<Method, RouteHandler<P>>;
  for (const method of METHODS) {
    const endpoint = method === "GET" || method === "POST" ? endpoints[method] : undefined;
    out[method] = (req, routeCtx) => serve(req, routeCtx?.params ?? ({} as P), endpoint ?? null, Object.keys(endpoints), depsOf());
  }
  return out;
}

/**
 * A route without a key (the OpenAPI document): switch, method, HTTPS and the in-memory per-network pre-filter only –
 * no database read or write; the answer may be cached for an hour (it holds no clinic data).
 */
export function publicApiRoute(endpoint: PublicApiEndpoint, depsOf: () => ClinicApiDeps = defaultApiDeps): Record<Method, (req: Request) => Promise<Response>> {
  const out = {} as Record<Method, (req: Request) => Promise<Response>>;
  for (const method of METHODS) {
    out[method] = async (req) => {
      const deps = depsOf();
      if (!clinicApiSwitchOn(deps.env)) return apiErrorResponse("NOT_FOUND");
      if (method !== "GET") return apiErrorResponse("METHOD_NOT_ALLOWED", undefined, { allow: "GET" });
      if (!isSecureRequest(req)) return apiErrorResponse("HTTPS_REQUIRED");
      try {
        const ip = ipLimitSubject(signupClientIp(req.headers, deps.env));
        if (!takeAnonToken(`public:${ip}`, deps.limits?.anonPerIpPerMinute ?? API_LIMITS.anonPerIpPerMinute, deps.now().getTime())) {
          return apiErrorResponse("RATE_LIMITED", undefined, { "retry-after": "60" });
        }
        const reply = await endpoint.handle({ url: new URL(req.url), deps });
        return apiJson(reply.status ?? 200, reply.body, { "cache-control": "public, max-age=3600", ...reply.headers });
      } catch (err) {
        logAuthEvent("pms.api.failed", { error: err instanceof Error ? err.name : "error" });
        return apiErrorResponse("SERVER_ERROR");
      }
    };
  }
  return out;
}

/** Unknown paths under /api/clinic/v1 (the catch-all route): 404 whether the switch is on or off. */
export function notFoundRoute(): Record<Method, () => Promise<Response>> {
  const out = {} as Record<Method, () => Promise<Response>>;
  for (const method of METHODS) out[method] = async () => apiErrorResponse("NOT_FOUND");
  return out;
}

/** The whole pipeline for one request (exported for the integration tests). */
export async function serve<P>(req: Request, params: P, endpoint: ApiEndpoint<P> | null, allowed: readonly string[], deps: ClinicApiDeps): Promise<Response> {
  if (!clinicApiSwitchOn(deps.env)) return apiErrorResponse("NOT_FOUND");
  if (!endpoint) return apiErrorResponse("METHOD_NOT_ALLOWED", undefined, { allow: allowed.join(", ") });
  if (!isSecureRequest(req)) return apiErrorResponse("HTTPS_REQUIRED");
  const url = new URL(req.url);
  if (url.search.length > API_LIMITS.maxQueryChars) return apiErrorResponse("INVALID_REQUEST", "The query string is too long.");
  const now = deps.now();
  const limits: Record<LimitName, number> = { ...API_LIMITS, ...deps.limits };
  const ip = ipLimitSubject(signupClientIp(req.headers, deps.env));
  const unauthenticated = () => apiErrorResponse("UNAUTHENTICATED", undefined, { "www-authenticate": 'Bearer realm="clinic-api"' });

  // No header, or not a well-formed key: cheap rejection, no database read or write. The in-memory bucket stops one
  // network flooding these (per instance – a pre-filter, not a guarantee).
  const token = bearerToken(req.headers.get("authorization"));
  const parsed = token ? parseApiKey(token) : null;
  if (!token || !parsed) {
    if (!takeAnonToken(`anon:${ip}`, limits.anonPerIpPerMinute, now.getTime())) return apiErrorResponse("RATE_LIMITED", undefined, { "retry-after": "60" });
    return unauthenticated();
  }

  const ctx: RepoContext = { db: deps.db(), cipher: deps.cipher(), now: () => now };
  try {
    // Verify FIRST: a right key always gets past the failure limits (only its own per-key limit can stop it).
    const key = await verifyApiKey(ctx, token);
    if (!key) {
      const byKey = `capi:fail:key:${parsed.tenantId}:${parsed.lookup}`;
      const byIp = `capi:fail:ip:${ip}`;
      const [k, n] = await Promise.all([peekRateLimit(ctx, byKey, 600_000), peekRateLimit(ctx, byIp, 600_000)]);
      if (k.count >= limits.failedPerKeyPer10Minutes) return apiErrorResponse("RATE_LIMITED", undefined, retryAfter(k.resetAt, now));
      if (n.count >= limits.failedPerIpPer10Minutes) return apiErrorResponse("RATE_LIMITED", undefined, retryAfter(n.resetAt, now));
      await hitRateLimit(ctx, byKey, 600_000);
      await hitRateLimit(ctx, byIp, 600_000);
      return unauthenticated();
    }
    if (!(await clinicApiOn(ctx, key.tenantId, now))) return apiErrorResponse("API_OFF");
    // 13/11/2026: a self-serve free trial that ended (or its clinic system not in the paid plan) – reads only.
    if (req.method !== "GET") {
      const block = await trialWriteBlock(ctx.db, key.tenantId, "clinic", now);
      if (block) return apiErrorResponse("READ_ONLY", block.message);
    }
    const perKey = await hitRateLimit(ctx, `capi:key:${key.tenantId}:${key.id}`, 60_000);
    if (perKey.count > limits.perKeyPerMinute) return apiErrorResponse("RATE_LIMITED", undefined, retryAfter(perKey.resetAt, now));
    if (endpoint.scope && !key.scopes.includes(endpoint.scope)) return apiErrorResponse("INSUFFICIENT_SCOPE", `This API key does not have the "${endpoint.scope}" scope.`);
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;

    const actor: PmsActor = { userId: null, sessionId: null };
    await recordApiUse(ctx, key.tenantId, key.id, { actor });
    const caller: ApiCaller = { tenantId: key.tenantId, key, siteIds: key.siteIds, ctx, actor, deps };
    const reply = await endpoint.handle({ caller, url, params, headers: req.headers, body });
    return apiJson(reply.status ?? 200, reply.body, reply.headers);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err.code, err.message, err.headers);
    if (err instanceof RepoInputError) return apiErrorResponse("INVALID_REQUEST", err.message);
    logAuthEvent("pms.api.failed", { error: err instanceof Error ? err.name : "error" });
    return apiErrorResponse("SERVER_ERROR");
  }
}

export type { RepoContext };
