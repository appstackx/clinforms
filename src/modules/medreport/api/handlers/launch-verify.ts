import "server-only";

/**
 * POST /api/reports/v1/launch/verify
 *
 * Body LaunchVerifyRequest {token} → LaunchVerifyResponse {claims, session}: the launch token's claims
 * plus a 1-hour session token (kind "launch") bound to tenant, connector, patient and episode. The
 * Studio stores the session and strips `lt` from the URL.
 *
 * Who may redeem it (wave 2):
 * - the public demo's launch (tenant "demo"): the launch token itself is the credential, while the public
 *   demo is on (403 DEMO_DISABLED otherwise);
 * - a clinic's launch: only that clinic's signed-in member (auth/actor.ts; 401 without a sign-in,
 *   403 TWO_FACTOR_REQUIRED, 403 TENANT_MISMATCH for another clinic's member). The session it returns
 *   narrows the member to the launched episode ("user+launch") while it is sent alongside the sign-in.
 *   Checked BEFORE the token is used up, so a member who signs in first can still open the link.
 *
 * Each launch token is exchanged ONCE: its `jti` is claimed in the shared store (MedreportDeps.sharedState →
 * launch_token_uses), so a replay is refused on every server instance. A clinic's launch is refused
 * (503) rather than checked in one instance's memory when the shared store is unavailable; the public
 * demo falls back to memory.
 *
 * Errors: 401 TOKEN_EXPIRED, 401 TOKEN_INVALID (bad signature, malformed, not a launch token, no ID, or
 * already used).
 *
 * Owner: integration agent (wave 2: API slice).
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { publicDemoEnabled } from "../../config.server";
import { assertActorTenant, requireActor } from "../../auth/actor";
import { verifyLaunchToken } from "../../auth/launch-token";
import { createSessionToken } from "../../auth/session-token";
import { claimOnce } from "../../auth/shared-limits";
import { WORDING } from "../../core/wording";
import { LaunchVerifyRequestSchema, type LaunchVerifyResponse } from "../contract";
import { HttpError, json, logEvent, parseBody, type MedreportHandler } from "../http";

export const handleLaunchVerify: MedreportHandler = async (req, _ctx, deps) => {
  const parsed = await parseBody(req, LaunchVerifyRequestSchema, { maxBytes: 8_000 });
  if (!parsed.ok) return parsed.response;

  const result = verifyLaunchToken(parsed.data.token.trim());
  if (!result.ok) {
    logEvent("launch_verify_failed", { reason: result.reason });
    if (result.reason === "expired") {
      throw new HttpError(401, "Launch link expired", {
        code: "TOKEN_EXPIRED",
        detail: "Launch links are valid for 10 minutes. Open the report again from the clinic system.",
      });
    }
    throw new HttpError(401, "Launch link invalid", {
      code: "TOKEN_INVALID",
      detail: "This launch link could not be verified. Open the report again from the clinic system.",
    });
  }
  const claims = result.claims;
  const demo = claims.tenantId === DEMO_TENANT_ID;
  if (demo) {
    if (!publicDemoEnabled()) {
      throw new HttpError(403, WORDING.server.access.demoOffTitle, { code: "DEMO_DISABLED", detail: WORDING.server.access.demoOffDetail });
    }
  } else {
    // A clinic's launch: its own signed-in member only (checked before the single-use token is spent).
    const actor = await requireActor(req, deps);
    if (actor.via === "demo") {
      throw new HttpError(401, WORDING.server.access.signInTitle, { code: "UNAUTHORIZED", detail: WORDING.server.access.clinicSignInDetail });
    }
    assertActorTenant(actor, claims.tenantId, "launch link");
  }

  if (!claims.jti || !(await claimOnce(deps, `launch:${claims.jti}`, claims.exp * 1000, { requireShared: !demo }))) {
    logEvent("launch_verify_failed", { reason: claims.jti ? "replayed" : "no_jti" });
    throw new HttpError(401, "Launch link already used", {
      code: "TOKEN_INVALID",
      detail: "Each launch link opens the report once. Open the patient again from the clinic system.",
    });
  }

  const session = createSessionToken({
    tenantId: claims.tenantId,
    kind: "launch",
    connectorId: claims.connectorId,
    patientId: claims.patientId,
    episodeId: claims.episodeId,
    clinician: claims.clinician,
  });
  logEvent("launch_verified", { connectorId: claims.connectorId, patientId: claims.patientId, episodeId: claims.episodeId, tenant: demo ? "demo" : "clinic" });
  const res: LaunchVerifyResponse = { claims, session };
  return json(res);
};
