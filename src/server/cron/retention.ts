/**
 * The retention cron (GET /api/cron/retention, scheduled in vercel.json). Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET environment variable is set on the project.
 * Without CRON_SECRET (16+ characters) the endpoint refuses every call, so it can never run unauthenticated.
 * Logs counts only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { DbContext } from "../repos/context";
import { runRetention, type RetentionResult } from "../repos/maintenance";

export const CRON_SECRET_MIN_LENGTH = 16;

/** Constant-time comparison of the Authorization header with `Bearer <secret>` (hashes first: equal lengths). */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH || !authorization) return false;
  const a = createHash("sha256").update(authorization, "utf8").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(a, b);
}

export interface RetentionCronDeps {
  secret: string | undefined;
  /** Resolved lazily: an unauthorised call never touches the database. */
  ctx: () => DbContext;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleRetentionCron(req: Request, deps: RetentionCronDeps): Promise<Response> {
  const log = deps.log ?? ((event, detail) => console.info(JSON.stringify({ event, ...detail })));
  if (!deps.secret || deps.secret.length < CRON_SECRET_MIN_LENGTH) {
    log("cron.retention.refused", { reason: "not_configured" });
    return json(503, { ok: false, error: "Not configured." });
  }
  if (!cronAuthorized(req.headers.get("authorization"), deps.secret)) {
    log("cron.retention.refused", { reason: "unauthorized" });
    return json(401, { ok: false, error: "Unauthorized." });
  }
  try {
    const result: RetentionResult = await runRetention(deps.ctx());
    log("cron.retention.done", { ...result });
    return json(200, { ok: true, deleted: result });
  } catch (error) {
    log("cron.retention.failed", { error: error instanceof Error ? error.name : "unknown" });
    return json(500, { ok: false, error: "Retention run failed." });
  }
}
