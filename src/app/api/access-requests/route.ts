/**
 * POST /api/access-requests – the public "Request access" form (src/app/(marketing)/request-access).
 * JSON only, same-origin only, ≤ 16 KiB; validation, honeypot and rate limits in
 * src/server/site/access-request.ts. Answers 201 {ok: true} when stored (or for a honeypot hit),
 * 422 with field errors, 429 with Retry-After, 503 when the database is not configured.
 */
import "server-only";
import { COMPANY } from "@/lib/site";
import { getDb } from "@/server/db";
import { getDataCipher } from "@/server/crypto";
import type { RepoContext } from "@/server/repos/context";
import { MAX_ACCESS_REQUEST_BYTES, clientIpFrom, hashClientIp, submitAccessRequest } from "@/server/site/access-request";
import { mailerSendSettingsFromEnv, sendAccessRequestNotification } from "@/server/site/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = `Requests cannot be received right now. Please email ${COMPANY.contactEmail} instead.`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function log(event: string, detail: Record<string, unknown> = {}): void {
  // IDs and outcomes only – never names, emails or message text.
  console.info(JSON.stringify({ event, ...detail }));
}

/** Same-origin check: a browser always sends Origin on a cross-site POST; it must name this host. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return originHost === host.split(",")[0].trim();
}

/** Repository context for a table without encrypted columns: the data cipher is resolved only if used. */
function siteRepoContext(): RepoContext {
  const db = getDb();
  return {
    db,
    get cipher() {
      return getDataCipher();
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { ok: false, error: "This form can only be sent from the ClinForms website." });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(415, { ok: false, error: "Send the form as JSON." });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_ACCESS_REQUEST_BYTES) return json(413, { ok: false, error: "The form is too large." });
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_ACCESS_REQUEST_BYTES) return json(413, { ok: false, error: "The form is too large." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "The form could not be read." });
  }

  let ctx: RepoContext;
  try {
    ctx = siteRepoContext();
  } catch {
    log("access_request.unavailable", { reason: "db_not_configured" });
    return json(503, { ok: false, error: UNAVAILABLE });
  }

  const ip = clientIpFrom(req.headers);
  const mail = mailerSendSettingsFromEnv();
  try {
    const outcome = await submitAccessRequest(body, {
      ctx,
      clientKey: ip ? hashClientIp(ip, process.env.BETTER_AUTH_SECRET ?? process.env.CLINFORMS_D1_GATEWAY_SECRET) : null,
      notify: mail ? (request) => sendAccessRequestNotification(mail, request) : undefined,
    });
    switch (outcome.kind) {
      case "stored":
        log("access_request.stored", { id: outcome.id, notified: outcome.notified ?? "disabled" });
        return json(201, { ok: true });
      case "spam":
        log("access_request.honeypot");
        return json(201, { ok: true });
      case "invalid":
        return json(422, { ok: false, error: "Please check the highlighted fields.", fieldErrors: outcome.fieldErrors });
      case "rate_limited":
        log("access_request.rate_limited");
        return json(
          429,
          { ok: false, error: "Too many requests from this connection. Please try again later or email us." },
          { "retry-after": String(outcome.retryAfterSeconds) },
        );
    }
  } catch (error) {
    log("access_request.failed", { error: error instanceof Error ? error.name : "unknown" });
    return json(503, { ok: false, error: UNAVAILABLE });
  }
}
