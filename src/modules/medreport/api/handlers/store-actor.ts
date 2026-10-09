import "server-only";

/**
 * Shared plumbing of the tenant-storage handlers (store-*.ts, `/api/reports/v1/store/**`):
 *
 * requireTenantActor(req, deps, {write}) – the signed-in clinic member behind the request:
 *   501 NOT_IMPLEMENTED      the host gave no storage or sign-in (the public demo)
 *   401 UNAUTHORIZED         no member signed in (or the sign-in has no active clinic)
 *   403 TWO_FACTOR_REQUIRED  the member has no two-step verification
 *   403 FORBIDDEN            a state-changing request from another site (Origin must be this app)
 *   415 UNSUPPORTED_MEDIA_TYPE a write whose body is not JSON (or, for chunks, raw bytes)
 * The clinic is always the actor's tenantId; nothing in the request can choose it.
 *
 * Integration note: this is the minimal tenant-only seam. When the API slice's `auth/actor.ts`
 * (`requireActor(req, deps, opts)`) lands, these handlers can call it instead – the contract is the same
 * (a two-step-verified member of the active clinic; the demo actor is never accepted here).
 */
import type { AuthContext, MedreportDeps } from "../deps";
import { HttpError, json, logEvent, requestOrigin, type ResponseOptions } from "../http";
import { CONTENT_TYPES } from "../contract";
import { revTag } from "../store-contract";
import type { StoreAuditEntry, TenantStore } from "../store-port";

export interface TenantActor {
  actor: AuthContext;
  tenantId: string;
  store: TenantStore;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The Origin of a state-changing request must be this app (CSRF). Browsers always send it on such requests. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) {
    throw new HttpError(403, "Request refused", { code: "FORBIDDEN", detail: "Changes can only be made from the ClinForms app." });
  }
  const own = new Set([requestOrigin(req), new URL(req.url).origin]);
  if (!own.has(origin)) {
    throw new HttpError(403, "Request refused", { code: "FORBIDDEN", detail: "Changes can only be made from the ClinForms app." });
  }
}

/** Writes with a body must be JSON (or, where allowed, raw bytes). */
export function assertContentType(req: Request, allowed: readonly string[] = [CONTENT_TYPES.json]): string {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!allowed.includes(type)) {
    throw new HttpError(415, "Unsupported content type", {
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
  let actor: AuthContext | null = null;
  try {
    actor = await deps.authenticate(req);
  } catch (err) {
    logEvent("store_auth_error", { error: err instanceof Error ? err.name : typeof err });
    actor = null;
  }
  if (!actor) {
    throw new HttpError(401, "Sign in to continue", { code: "UNAUTHORIZED", detail: "Your session has ended. Sign in again to continue." });
  }
  if (!actor.twoFactorVerified) {
    throw new HttpError(403, "Two-step verification is required", {
      code: "TWO_FACTOR_REQUIRED",
      detail: "Turn on two-step verification for your account before opening the clinic's records.",
    });
  }
  return { actor, tenantId: actor.tenantId, store };
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
    await t.store.audit(t.tenantId, { userId: t.actor.userId, sessionId: t.actor.authSessionId, ...entry });
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
