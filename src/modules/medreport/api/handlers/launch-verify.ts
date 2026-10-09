import "server-only";

/**
 * POST /api/reports/v1/launch/verify
 *
 * Body LaunchVerifyRequest {token} → LaunchVerifyResponse {claims, session}: the launch token's claims
 * plus a 1-hour session token (kind "launch") bound to tenant, connector, patient and episode. The
 * Studio stores the session and strips `lt` from the URL.
 *
 * Each launch token is exchanged ONCE: its `jti` is remembered until the token expires, and a replay
 * (from browser history, a proxy log…) is refused. The store is in memory per instance (demo); in
 * production it would be a shared store (KV / Redis) with the same expiry.
 *
 * Errors: 401 TOKEN_EXPIRED, 401 TOKEN_INVALID (bad signature, malformed, not a launch token, no ID, or
 * already used).
 *
 * Owner: integration agent.
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { verifyLaunchToken } from "../../auth/launch-token";
import { createSessionToken } from "../../auth/session-token";
import { LaunchVerifyRequestSchema, type LaunchVerifyResponse } from "../contract";
import { HttpError, json, logEvent, parseBody, type MedreportHandler } from "../http";

/** jti → expiry (ms) of launch tokens already exchanged on this instance. */
const usedLaunchTokens = new Map<string, number>();

/** Record a launch token as used; false when it was used before. */
export function claimLaunchToken(jti: string, expSeconds: number, nowMs: number = Date.now()): boolean {
  if (usedLaunchTokens.size > 1000) {
    for (const [id, until] of Array.from(usedLaunchTokens.entries())) if (until <= nowMs) usedLaunchTokens.delete(id);
  }
  const until = usedLaunchTokens.get(jti);
  if (until !== undefined && until > nowMs) return false;
  usedLaunchTokens.set(jti, expSeconds * 1000);
  return true;
}

export const handleLaunchVerify: MedreportHandler = async (req) => {
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
  if (!claims.jti || !claimLaunchToken(claims.jti, claims.exp)) {
    logEvent("launch_verify_failed", { reason: claims.jti ? "replayed" : "no_jti" });
    throw new HttpError(401, "Launch link already used", {
      code: "TOKEN_INVALID",
      detail: "Each launch link opens the report once. Open the patient again from the clinic system.",
    });
  }
  if (claims.tenantId !== DEMO_TENANT_ID) {
    throw new HttpError(403, "Unknown tenant", { code: "FORBIDDEN", detail: "This deployment serves the demo tenant only." });
  }

  const session = createSessionToken({
    tenantId: claims.tenantId,
    kind: "launch",
    connectorId: claims.connectorId,
    patientId: claims.patientId,
    episodeId: claims.episodeId,
    clinician: claims.clinician,
  });
  logEvent("launch_verified", { connectorId: claims.connectorId, patientId: claims.patientId, episodeId: claims.episodeId });
  const res: LaunchVerifyResponse = { claims, session };
  return json(res);
};
