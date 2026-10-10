import "server-only";

/**
 * Shared plumbing of the tenant-storage handlers (store-*.ts, `/api/reports/v1/store/**`):
 *
 * requireTenantActor(req, deps, {write}) – the signed-in clinic member behind the request, resolved by the SAME
 * seam as every other Report API endpoint (auth/actor.ts requireActor → MedreportDeps.authenticate):
 *   501 NOT_IMPLEMENTED       the host gave no storage or sign-in (the public demo)
 *   401 UNAUTHORIZED          no member signed in – including a public-demo session: the store is for clinics only
 *   403 TWO_FACTOR_REQUIRED   the member has no two-step verification
 *   403 NO_CLINIC             the sign-in has no active clinic (from the host's authenticate)
 *   503 SERVICE_UNAVAILABLE   the sign-in could not be checked (from the host's authenticate)
 *   403 ORIGIN_NOT_ALLOWED    a state-changing request from another site (bindHandler), or – stricter here than
 *                             elsewhere – a write that carries no Origin at all (only browsers write to the store)
 *   415 UNSUPPORTED_MEDIA_TYPE a write whose body is not JSON (or, for chunks, raw bytes)
 *   403 TENANT_MISMATCH       (fix wave 2) the request names, in x-clinforms-tenant, another clinic than the
 *                             sign-in's: the Studio page was opened for another clinic (e.g. the active clinic was
 *                             switched in another tab) – never stored under the sign-in's clinic instead
 *   403 SIGN_IN_CHANGED       (fix wave 2) x-clinforms-member names another member than the one signed in (a
 *                             change queued under one sign-in is never replayed under another)
 *   429 RATE_LIMITED          (fix wave 2) a write over STORE_WRITES_PER_MEMBER / _PER_CLINIC_PER_MINUTE, or new data
 *                             over STORE_NEW_KB_PER_CLINIC_PER_DAY (takeNewData: new records and uploaded chunks)
 * The clinic is always the actor's tenantId; nothing in the request can choose it.
 *
 * Owner: store slice (wave 2); unified with the API slice's actor at integration.
 */
import type { MedreportDeps } from "../deps";
import { HttpError, checkRequestOrigin, json, logEvent, type ResponseOptions } from "../http";
import { CONTENT_TYPES } from "../contract";
import {
  STORE_MEMBER_HEADER,
  STORE_NEW_KB_PER_CLINIC_PER_DAY,
  STORE_TENANT_HEADER,
  STORE_WRITES_PER_CLINIC_PER_MINUTE,
  STORE_WRITES_PER_MEMBER_PER_MINUTE,
  revTag,
} from "../store-contract";
import type { StoreAuditEntry, TenantStore } from "../store-port";
import { requireActor, type Actor } from "../../auth/actor";
import { countHit } from "../../auth/shared-limits";
import { WORDING } from "../../core/wording";

export interface TenantActor {
  /** A clinic member (via "user" or "user+launch"); never the public demo. */
  actor: Actor;
  tenantId: string;
  store: TenantStore;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The Origin of a state-changing store request must be this app (CSRF). Browsers always send it on such requests;
 * unlike the rest of the Report API (where the clinic system calls POST /launch server to server), the store has
 * no server-to-server callers, so a missing Origin is refused too.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const refused = checkRequestOrigin(req);
  if (!origin || refused) {
    throw new HttpError(403, WORDING.server.access.originTitle, { code: "ORIGIN_NOT_ALLOWED", detail: WORDING.server.access.originDetail });
  }
}

/** Writes with a body must be JSON (or, where allowed, raw bytes). */
export function assertContentType(req: Request, allowed: readonly string[] = [CONTENT_TYPES.json]): string {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!allowed.includes(type)) {
    throw new HttpError(415, WORDING.server.access.jsonTitle, {
      code: "UNSUPPORTED_MEDIA_TYPE",
      detail: `Send the body as ${allowed.join(" or ")}.`,
    });
  }
  return type;
}

export async function requireTenantActor(req: Request, deps: MedreportDeps, opts: { write?: boolean } = {}): Promise<TenantActor> {
  const store = deps.tenantStore;
  if (!store || !deps.authenticate) {
    throw new HttpError(501, "Clinic storage is not available here", {
      code: "NOT_IMPLEMENTED",
      detail: "This deployment keeps reports in the browser only.",
    });
  }
  const write = opts.write ?? WRITE_METHODS.has(req.method.toUpperCase());
  // CSRF first: a cross-site write never reaches the sign-in lookup.
  if (write) assertSameOrigin(req);
  let actor: Actor;
  try {
    actor = await requireActor(req, deps);
  } catch (err) {
    // A demo or launch session token alone is not a clinic sign-in: the store answers "sign in" for every
    // session-token refusal, so the Studio's write queue waits for a sign-in instead of retrying.
    if (err instanceof HttpError && err.status === 401) throw signIn();
    throw err;
  }
  if (actor.via === "demo") throw signIn();
  assertSameSignIn(req, actor);
  if (write) await takeWriteSlot(deps, actor);
  return { actor, tenantId: actor.tenantId, store };
}

/**
 * The clinic and member the Studio page was opened for (STORE_TENANT_HEADER / STORE_MEMBER_HEADER) must be the
 * sign-in's. Absent headers are not checked (the clinic always comes from the sign-in).
 */
export function assertSameSignIn(req: Request, actor: Actor): void {
  const tenant = req.headers.get(STORE_TENANT_HEADER);
  if (tenant !== null && tenant.trim() !== actor.tenantId) {
    throw new HttpError(403, WORDING.server.access.signInChangedTitle, { code: "TENANT_MISMATCH", detail: WORDING.server.access.signInChangedDetail });
  }
  const member = req.headers.get(STORE_MEMBER_HEADER);
  if (member !== null && member.trim() !== (actor.userId ?? "")) {
    throw new HttpError(403, WORDING.server.access.signInChangedTitle, { code: "SIGN_IN_CHANGED", detail: WORDING.server.access.signInChangedDetail });
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Count `bytes` of NEW data (a new report or form map, an uploaded chunk) against the clinic's daily allowance
 * (STORE_NEW_KB_PER_CLINIC_PER_DAY): 429 RATE_LIMITED once it is used up, until the day's window ends.
 */
export async function takeNewData(deps: MedreportDeps, t: TenantActor, bytes: number): Promise<void> {
  const now = Date.now();
  const kb = Math.max(1, Math.ceil(bytes / 1024));
  const day = await countHit(deps, `store:new-kb:clinic:${t.tenantId}`, DAY_MS, now, kb);
  if (day.count <= STORE_NEW_KB_PER_CLINIC_PER_DAY) return;
  const seconds = Math.max(1, Math.ceil((day.resetAtMs - now) / 1000));
  logEvent("store_growth_limited", { kb });
  throw new HttpError(429, WORDING.server.access.storeLimitTitle, {
    code: "RATE_LIMITED",
    detail: WORDING.server.access.storeDailyLimitDetail,
    headers: { "retry-after": String(seconds) },
  });
}

/**
 * One write of the member's and the clinic's per-minute allowance (shared rate_limits counters; one atomic hit
 * per counter, in parallel). Over either → 429 RATE_LIMITED with Retry-After (the Studio's queue retries).
 */
async function takeWriteSlot(deps: MedreportDeps, actor: Actor): Promise<void> {
  const now = Date.now();
  const [member, clinic] = await Promise.all([
    countHit(deps, `store:writes:member:${actor.tenantId}:${actor.userId ?? actor.sid}`, MINUTE_MS, now),
    countHit(deps, `store:writes:clinic:${actor.tenantId}`, MINUTE_MS, now),
  ]);
  const over = [member.count > STORE_WRITES_PER_MEMBER_PER_MINUTE ? member : null, clinic.count > STORE_WRITES_PER_CLINIC_PER_MINUTE ? clinic : null].filter(
    (w): w is NonNullable<typeof w> => w !== null,
  );
  if (over.length === 0) return;
  const seconds = Math.max(1, Math.ceil((Math.max(...over.map((w) => w.resetAtMs)) - now) / 1000));
  logEvent("store_write_limited", { scope: member.count > STORE_WRITES_PER_MEMBER_PER_MINUTE ? "member" : "clinic" });
  throw new HttpError(429, WORDING.server.access.storeLimitTitle, {
    code: "RATE_LIMITED",
    detail: WORDING.server.access.storeLimitDetail(seconds),
    headers: { "retry-after": String(seconds) },
  });
}

function signIn(): HttpError {
  return new HttpError(401, WORDING.server.access.signInTitle, {
    code: "UNAUTHORIZED",
    detail: "Sign in to your clinic's account to open its records.",
  });
}

/** JSON with `ETag: "<rev>"`. */
export function jsonWithRev<T>(data: T, rev: number, init: ResponseOptions = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("etag", revTag(rev));
  return json(data, { ...init, headers });
}

/** problem+json with extra members (409 REV_CONFLICT carries `current`). */
export function problemWith(status: number, title: string, code: string, detail: string, extra: Record<string, unknown>): Response {
  const body = { type: `urn:appstackx:medreport:problem:${code.toLowerCase()}`, title, status, code, detail, ...extra };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": `${CONTENT_TYPES.problem}; charset=utf-8`, "cache-control": "no-store" },
  });
}

/**
 * Append one audit row (ids, actions and counts only). A failed audit write is logged and does not undo or
 * fail the change it records – the change is already stored, and the client would otherwise retry it.
 */
export async function auditStore(t: TenantActor, entry: Omit<StoreAuditEntry, "userId" | "sessionId">): Promise<void> {
  try {
    await t.store.audit(t.tenantId, { userId: t.actor.userId ?? "", sessionId: t.actor.sid, ...entry });
  } catch (err) {
    logEvent("store_audit_failed", { action: entry.action, target: entry.targetType, error: err instanceof Error ? err.name : typeof err });
  }
}

/** Path parameter, checked against a pattern (422 when it does not match). */
export function pathParam(params: Record<string, string>, name: string, pattern: RegExp): string {
  const raw = params[name];
  let value = "";
  try {
    value = decodeURIComponent(raw ?? "");
  } catch {
    value = "";
  }
  if (!pattern.test(value)) {
    throw new HttpError(422, "Invalid path", { code: "VALIDATION_FAILED", issues: [{ path: name, message: `Not a valid ${name}.` }] });
  }
  return value;
}
