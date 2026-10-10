import "server-only";

/**
 * POST /api/reports/v1/passcode/check – the public demo's passcode dialog asks the server BEFORE it stores a
 * passcode (and the Studio re-checks a stored one once per page load), so the mode badge never shows live
 * drafting for a passcode the server would refuse.
 *
 * Request: the passcode in the x-medreport-passcode header (HEADERS.passcode) – never in the URL or the body;
 * the body is ignored. The caller is the public demo: a demo session (Bearer), like every live request.
 *
 *   204                                 the passcode is right and this deployment can draft live
 *   401 PASSCODE_REQUIRED               no passcode sent
 *   401 PASSCODE_INVALID                wrong passcode (counted as a wrong guess)
 *   429 RATE_LIMITED + Retry-After      locked out after wrong guesses
 *   503 LIVE_AI_UNAVAILABLE             no live drafting on this deployment (no key / no passcode / demo mode)
 *   401 UNAUTHORIZED / TOKEN_*          no demo session (auth/actor.ts)
 *   403 FORBIDDEN                       a clinic's signed-in member: the passcode is the demo's only
 *   404 NOT_FOUND                       the public demo is switched off (CLINFORMS_PUBLIC_DEMO=0)
 *   403 ORIGIN_NOT_ALLOWED              a cross-site request (bindHandler, like every POST)
 *
 * The check is ai/live-gate.ts checkDemoPasscode() – the very path every live request of the demo takes, with
 * the same wrong-guess counters (5 per client – an IPv6 client by its /64 – and 30 for the deployment, per 10
 * minutes; shared by every instance via MedreportDeps.sharedState; each attempt counted BEFORE the compare, so
 * guesses sent at once are bounded too), so this endpoint allows no faster guessing than POST /drafts already
 * does. A passcode shorter than 16 characters is never configured (config.server.ts MIN_LIVE_PASSCODE_LENGTH).
 * It takes NO live-call slot and calls no drafting service. Logs carry the outcome only, never the passcode.
 *
 * Owner: API slice.
 */
import { checkDemoPasscode } from "../../ai/live-gate";
import { requireActor } from "../../auth/actor";
import { publicDemoEnabled } from "../../config.server";
import { WORDING } from "../../core/wording";
import { logEvent, problem, type MedreportHandler } from "../http";

export const handlePasscodeCheck: MedreportHandler = async (req, _ctx, deps) => {
  if (!publicDemoEnabled()) {
    return problem(404, "Not found", { code: "NOT_FOUND", detail: "The public demo is not available on this site." });
  }
  const actor = await requireActor(req, deps);
  if (actor.via !== "demo") {
    logEvent("passcode_check", { result: "not_demo" });
    return problem(403, WORDING.server.access.passcodeDemoOnlyTitle, { code: "FORBIDDEN", detail: WORDING.server.access.passcodeDemoOnlyDetail });
  }
  const result = await checkDemoPasscode(req, deps, {
    action: WORDING.server.gateActionCheck,
    alternative: WORDING.server.checkAlternative,
    rateTitle: "Too many wrong passcodes",
  });
  logEvent("passcode_check", { result: result.ok ? "ok" : result.reason });
  if (!result.ok) return result.response;
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};
