import "server-only";

/**
 * Framework-agnostic HTTP helpers for the Report API handlers: (req: Request) => Promise<Response>.
 * No Next.js imports, so the handlers can move to another host unchanged.
 *
 * Shared contract (orchestrator-owned).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { CONTENT_TYPES, type Problem, type ProblemCode, type ProblemIssue } from "./contract";
import type { MedreportDeps } from "./deps";
import { allowedRequestOrigins } from "../config.server";
import type { ReportFlag } from "../core/types";
import { WORDING } from "../core/wording";

/* ------------------------------------------------------------------------------------------------
 * Handler types
 * ----------------------------------------------------------------------------------------------*/

export type HandlerContext = { params: Record<string, string> };

/** What a Next.js route exports (GET/POST). */
export type HandlerFn = (req: Request, ctx: HandlerContext) => Promise<Response>;

/** What a Report API handler file exports; bound to deps by the app glue (bindHandler). */
export type MedreportHandler = (req: Request, ctx: HandlerContext, deps: MedreportDeps) => Promise<Response>;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard (wave 2: the Report API now also accepts a sign-in cookie). A state-changing request is
 * refused (403 ORIGIN_NOT_ALLOWED) when:
 *   - it carries an Origin header that is not one of this app's origins (config.server.ts
 *     allowedRequestOrigins: the request's own origin, APP_ORIGIN, BETTER_AUTH_URL, this deployment), or
 *   - it carries no Origin but the browser says it is cross-site (Sec-Fetch-Site other than
 *     same-origin / none).
 * Server-to-server calls (the clinic system's POST /launch, scripts, tests) send neither and pass. With
 * SameSite=Lax cookies and the JSON content type required by parseBody (a cross-site form cannot send
 * it without a CORS preflight, which this API never grants) this closes cross-site request forgery.
 */
export function checkRequestOrigin(req: Request): Response | null {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return null;
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    if (allowedRequestOrigins(req).indexOf(origin.trim().toLowerCase()) >= 0) return null;
    return problem(403, WORDING.server.access.originTitle, { code: "ORIGIN_NOT_ALLOWED", detail: WORDING.server.access.originDetail });
  }
  if (origin === "null") {
    return problem(403, WORDING.server.access.originTitle, { code: "ORIGIN_NOT_ALLOWED", detail: WORDING.server.access.originDetail });
  }
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") {
    return problem(403, WORDING.server.access.originTitle, { code: "ORIGIN_NOT_ALLOWED", detail: WORDING.server.access.originDetail });
  }
  return null;
}

/**
 * Bind a handler to its dependencies. Refuses cross-site state-changing requests first
 * (checkRequestOrigin). Catches anything thrown: HttpError → its problem response; anything else →
 * 500 INTERNAL (logged by name only, never with request content).
 */
export function bindHandler(handler: MedreportHandler, getDeps: () => MedreportDeps): HandlerFn {
  return async (req, ctx) => {
    const started = Date.now();
    try {
      const refused = checkRequestOrigin(req);
      if (refused) {
        logEvent("request_origin_refused", { path: new URL(req.url).pathname, method: req.method });
        return refused;
      }
      return await handler(req, { params: ctx?.params ?? {} }, getDeps());
    } catch (err) {
      const res = errorToResponse(err);
      logEvent("handler_error", {
        path: new URL(req.url).pathname,
        status: res.status,
        error: err instanceof Error ? err.name : typeof err,
        ms: Date.now() - started,
      });
      return res;
    }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Responses
 * ----------------------------------------------------------------------------------------------*/

export interface ResponseOptions {
  status?: number;
  headers?: HeadersInit;
}

/** JSON response (`no-store`: every response may carry patient data). */
export function json<T>(data: T, init: ResponseOptions = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", `${CONTENT_TYPES.json}; charset=utf-8`);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

const DEFAULT_CODES: Record<number, ProblemCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "SIGNOFF_BLOCKED",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  501: "NOT_IMPLEMENTED",
};

export interface ProblemInit {
  code?: ProblemCode;
  detail?: string;
  /** Defaults to a URN derived from the code. */
  type?: string;
  issues?: ProblemIssue[];
  flags?: ReportFlag[];
  retryable?: boolean;
  headers?: HeadersInit;
}

/** `application/problem+json` error: {type, title, status, detail, code, …}. */
export function problem(status: number, title: string, init: ProblemInit = {}): Response {
  const code: ProblemCode = init.code ?? DEFAULT_CODES[status] ?? (status >= 500 ? "INTERNAL" : "BAD_REQUEST");
  const body: Problem = {
    type: init.type ?? `urn:appstackx:medreport:problem:${code.toLowerCase()}`,
    title,
    status,
    code,
    ...(init.detail !== undefined && { detail: init.detail }),
    ...(init.issues && { issues: init.issues }),
    ...(init.flags && { flags: init.flags }),
    ...(init.retryable !== undefined && { retryable: init.retryable }),
  };
  const headers = new Headers(init.headers);
  headers.set("content-type", `${CONTENT_TYPES.problem}; charset=utf-8`);
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/** 501 for endpoints whose handler has not been built yet. */
export function notImplemented(endpoint: string): Response {
  return problem(501, "Not implemented", { code: "NOT_IMPLEMENTED", detail: `${endpoint} is not implemented yet.` });
}

/** Throw from anywhere inside a handler; bindHandler turns it into a problem response. */
export class HttpError extends Error {
  readonly status: number;
  readonly init: ProblemInit;

  constructor(status: number, title: string, init: ProblemInit = {}) {
    super(title);
    this.name = "HttpError";
    this.status = status;
    this.init = init;
  }

  toResponse(): Response {
    return problem(this.status, this.message, this.init);
  }
}

export function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) return err.toResponse();
  return problem(500, "Internal error", { code: "INTERNAL", detail: "Something went wrong. Please try again." });
}

/** Binary file download (e.g. .docx/.pdf) with an RFC 6266 Content-Disposition. */
export function fileResponse(
  bytes: Uint8Array,
  opts: { contentType: string; fileName: string; headers?: HeadersInit; inline?: boolean },
): Response {
  const headers = new Headers(opts.headers);
  headers.set("content-type", opts.contentType);
  headers.set("content-length", String(bytes.byteLength));
  headers.set("cache-control", "no-store");
  const ascii = opts.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  headers.set(
    "content-disposition",
    `${opts.inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`,
  );
  // Copy into a fresh ArrayBuffer so any Uint8Array view (incl. Node Buffer) is a valid BodyInit.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, { status: 200, headers });
}

/* ------------------------------------------------------------------------------------------------
 * Request parsing
 * ----------------------------------------------------------------------------------------------*/

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Default body cap: Vercel rejects request bodies over 4.5 MB anyway. */
export const DEFAULT_MAX_BODY_BYTES = 4_500_000;

function zodIssues(error: z.ZodError): ProblemIssue[] {
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Whether a Content-Type header names JSON (application/json, or application/<x>+json), any parameters. */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0].trim().toLowerCase();
  return type === CONTENT_TYPES.json || /^application\/[a-z0-9.+-]+\+json$/.test(type);
}

/**
 * Read and validate a JSON body. Not sent as JSON (Content-Type) → 415 UNSUPPORTED_MEDIA_TYPE (wave 2,
 * CSRF hardening); too large → 413; not JSON → 400 BAD_JSON; schema mismatch → 422 VALIDATION_FAILED with
 * `issues` (paths and messages only, never the submitted values).
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number } = {},
): Promise<ParseResult<z.output<S>>> {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return {
      ok: false,
      response: problem(415, WORDING.server.access.jsonTitle, { code: "UNSUPPORTED_MEDIA_TYPE", detail: WORDING.server.access.jsonDetail }),
    };
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return { ok: false, response: problem(413, "Request body too large", { code: "PAYLOAD_TOO_LARGE" }) };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: problem(400, "Could not read request body", { code: "BAD_REQUEST" }) };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, response: problem(413, "Request body too large", { code: "PAYLOAD_TOO_LARGE" }) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: problem(400, "Request body is not valid JSON", { code: "BAD_JSON" }) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: problem(422, "Request body is invalid", { code: "VALIDATION_FAILED", issues: zodIssues(result.error) }),
    };
  }
  return { ok: true, data: result.data };
}

/** Validate the query string (all values are strings; repeated keys keep the last value). */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): ParseResult<z.output<S>> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      ok: false,
      response: problem(422, "Query parameters are invalid", { code: "VALIDATION_FAILED", issues: zodIssues(result.error) }),
    };
  }
  return { ok: true, data: result.data };
}

/** `Authorization: Bearer <token>` → token, else null. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Constant-time string comparison (hashes both sides first so differing lengths do not leak via
 * timing). Use for passcodes, partner keys and bearer tokens.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Request origin, honouring x-forwarded-* (Vercel). */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/* ------------------------------------------------------------------------------------------------
 * Logging: IDs, timings and token counts only – never note text, names or secrets.
 * ----------------------------------------------------------------------------------------------*/

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logEvent(event: string, fields: LogFields = {}): void {
  // One JSON line per event; values are primitives by type, so objects (notes, bundles) cannot slip in.
  console.info(JSON.stringify({ at: new Date().toISOString(), svc: "medreport", event, ...fields }));
}
