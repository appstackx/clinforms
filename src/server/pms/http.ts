/**
 * Route handlers of the clinic system (src/app/app/clinic/**\/route.ts), when a server action does not fit (file
 * downloads, polling the diary, JSON for client components). Same checks as the pages and actions
 * (./actor.ts) plus, for anything but GET/HEAD, a same-origin check (server actions get theirs from Next):
 *
 *   export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor, params) => Response.json(…));
 *
 * Errors are JSON {error: {code, message}} with plain messages; RepoInputError → 400; anything else → 500 with
 * nothing of the cause in the response (it is logged by name only). Responses are never cached.
 */
import "server-only";
import type { PmsPermission } from "../../modules/pms/core/permissions";
import { logAuthEvent } from "../email/log";
import { RepoInputError } from "../repos/context";
import { actorErrorMessage, actorErrorStatus, clinicActionActor, type ClinicActor } from "./actor";

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export function clinicRoute<P = Record<string, string>>(
  options: { permission: PmsPermission },
  handler: (req: Request, actor: ClinicActor, params: P) => Promise<Response>,
): (req: Request, ctx: { params: P }) => Promise<Response> {
  return async (req, ctx) => {
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
      return json(403, { error: { code: "CROSS_ORIGIN", message: "This request must come from the clinic's own pages." } });
    }
    const actor = await clinicActionActor({ permission: options.permission });
    if ("error" in actor) return json(actorErrorStatus(actor.error), { error: { code: actor.error.toUpperCase(), message: actorErrorMessage(actor.error) } });
    try {
      const res = await handler(req, actor, ctx.params);
      try {
        if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      } catch {
        // immutable headers (e.g. Response.redirect): leave them
      }
      return res;
    } catch (err) {
      if (err instanceof RepoInputError) return json(400, { error: { code: "INVALID_INPUT", message: err.message } });
      logAuthEvent("pms.route_failed", { error: err instanceof Error ? err.name : "error" });
      return json(500, { error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." } });
    }
  };
}
