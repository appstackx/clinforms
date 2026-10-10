/**
 * ClinForms data gateway (Worker `clinforms-data` / `clinforms-data-preview`): an authenticated SQL gateway
 * in front of the D1 binding `DB`, used by the Next app on Vercel (src/server/db/dialects/d1-http.ts).
 * Contract: docs/production-architecture.md §2.
 *
 *   GET  /v1/health  → {ok: true}                 (no auth)
 *   POST /v1/query   → {results: [{rows, changes, lastRowId}]}
 *        body {statements: [{sql, params}], mode: "single" | "batch"}; "batch" = env.DB.batch() (atomic)
 *   errors           → {error: {code, message}}   (never echoes SQL parameters)
 *
 * Email is sent by the app itself (MailerSend), so there is no /v1/email here.
 */
import { SIG_HEADER, TS_HEADER, checkAuthHeaders, verifySignature, type AuthFailure } from "./auth";
import type { D1ResultLike, Env } from "./d1";
import { LIMITS, RequestError, bindValue, parseQueryBody, type QueryBody } from "./validate";

export type { Env } from "./d1";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

const AUTH_MESSAGES: Record<AuthFailure, string> = {
  MISSING_HEADERS: "Missing or malformed signature headers.",
  STALE_TIMESTAMP: "Request timestamp is outside the allowed window.",
  BAD_SIGNATURE: "Signature does not match.",
};

/** Reads at most `limit` bytes; null when the body is larger. */
async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** D1 / SQLite error → {status, code, message}; the message never carries parameter values. */
export function mapDatabaseError(err: unknown): { status: number; code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw
    .replace(/^D1_ERROR:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .slice(0, 300);
  if (/append-only/i.test(message)) return { status: 409, code: "APPEND_ONLY", message: "audit_log is append-only." };
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return { status: 409, code: "CONSTRAINT_UNIQUE", message };
  if (/FOREIGN KEY constraint failed/i.test(message)) return { status: 409, code: "CONSTRAINT_FOREIGN_KEY", message };
  if (/CHECK constraint failed/i.test(message)) return { status: 409, code: "CONSTRAINT_CHECK", message };
  if (/NOT NULL constraint failed/i.test(message)) return { status: 409, code: "CONSTRAINT_NOT_NULL", message };
  if (/no such (table|column|function)|syntax error|SQLITE_ERROR|datatype mismatch|too many|too big|SQLITE_(TOOBIG|MISMATCH|RANGE)/i.test(message)) {
    return { status: 400, code: "SQL_ERROR", message };
  }
  return { status: 503, code: "UNAVAILABLE", message: "The database is temporarily unavailable." };
}

function toResult(result: D1ResultLike) {
  return {
    rows: Array.isArray(result.results) ? result.results : [],
    changes: typeof result.meta?.changes === "number" ? result.meta.changes : 0,
    lastRowId: typeof result.meta?.last_row_id === "number" ? result.meta.last_row_id : null,
  };
}

async function runQuery(env: Env, body: QueryBody): Promise<Response> {
  const statements = body.statements.map((s) => env.DB.prepare(s.sql).bind(...s.params.map(bindValue)));
  try {
    const results = body.mode === "batch" ? await env.DB.batch(statements) : [await statements[0].all()];
    return json(200, { results: results.map(toResult) });
  } catch (err) {
    const mapped = mapDatabaseError(err);
    console.error(
      JSON.stringify({ event: "query_error", code: mapped.code, mode: body.mode, statements: body.statements.length, message: mapped.message }),
    );
    return fail(mapped.status, mapped.code, mapped.message);
  }
}

export async function handleRequest(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/health") {
    if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "METHOD_NOT_ALLOWED", "Use GET.");
    return json(200, { ok: true });
  }
  if (url.pathname !== "/v1/query") return fail(404, "NOT_FOUND", "Not found.");
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Use POST.");

  const secret = env.GATEWAY_SECRET;
  if (!secret || secret.length < 32) return fail(503, "NOT_CONFIGURED", "The gateway is not configured.");

  const ts = request.headers.get(TS_HEADER);
  const sig = request.headers.get(SIG_HEADER);
  const headerProblem = checkAuthHeaders(ts, sig, now);
  if (headerProblem) return fail(401, "UNAUTHORIZED", AUTH_MESSAGES[headerProblem]);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.maxBodyBytes) return fail(413, "PAYLOAD_TOO_LARGE", "Request body is larger than 8 MiB.");
  const body = await readBody(request, LIMITS.maxBodyBytes);
  if (!body) return fail(413, "PAYLOAD_TOO_LARGE", "Request body is larger than 8 MiB.");

  if (!(await verifySignature(secret, ts as string, request.method, url.pathname, body, sig as string))) {
    return fail(401, "UNAUTHORIZED", AUTH_MESSAGES.BAD_SIGNATURE);
  }

  let parsed: QueryBody;
  try {
    parsed = parseQueryBody(body);
  } catch (err) {
    if (err instanceof RequestError) return fail(err.status, err.code, err.message);
    throw err;
  }
  return runQuery(env, parsed);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error(JSON.stringify({ event: "unhandled", name: err instanceof Error ? err.name : "unknown" }));
      return fail(500, "INTERNAL", "Internal error.");
    }
  },
};
