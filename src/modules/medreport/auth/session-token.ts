import "server-only";

/**
 * Session tokens (1 h) gate patient data even though it is fictional. HMAC-SHA256 with
 * MEDREPORT_LAUNCH_SECRET (distinct token type from launch tokens).
 *
 * Handlers call `requireSession(req)` (Bearer token → claims, or a 401 problem) and then
 * `sessionAllowsEpisode` / `assertSessionConnector` before touching patient data.
 *
 * Wave 2: the handlers use auth/actor.ts `requireActor()` instead (a clinic's signed-in member, or these
 * session tokens for the public demo). `requireSession` is kept for compatibility (demo tenant only).
 *
 * Owner: integration agent.
 */
import { getSecret } from "../config.server";
import { DEMO_TENANT_ID } from "../config.public";
import { HttpError, getBearerToken } from "../api/http";
import { SessionClaimsSchema } from "../core/schemas";
import { createId } from "../core/ids";
import type { ConnectorId, SessionClaims, SessionToken } from "../core/types";
import { signHmacToken, verifyHmacToken, type TokenVerifyResult } from "./hmac-token";
import type { TokenOptions } from "./launch-token";

export const SESSION_TOKEN_TTL_SECONDS = 3600;

export type SessionTokenInput = Omit<SessionClaims, "iat" | "exp" | "sid"> & { sid?: string };

export function createSessionToken(
  input: SessionTokenInput,
  opts: TokenOptions & { ttlSeconds?: number } = {},
): SessionToken {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = iat + (opts.ttlSeconds ?? SESSION_TOKEN_TTL_SECONDS);
  const claims: SessionClaims = SessionClaimsSchema.parse({ ...input, sid: input.sid ?? createId("ses"), iat, exp });
  const token = signHmacToken("medreport.session", claims, opts.secret ?? getSecret("MEDREPORT_LAUNCH_SECRET"));
  return { token, expiresAt: new Date(exp * 1000).toISOString(), claims };
}

export function verifySessionToken(token: string, opts: TokenOptions = {}): TokenVerifyResult<SessionClaims> {
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return verifyHmacToken(
    token,
    "medreport.session",
    opts.secret ?? getSecret("MEDREPORT_LAUNCH_SECRET"),
    SessionClaimsSchema,
    nowSeconds,
  );
}

/**
 * Whether a session may read/write this episode. "launch" sessions must match connector, patient and
 * episode exactly; "demo" sessions may access any episode of the demo tenant (and of their connector,
 * when one is set).
 */
export function sessionAllowsEpisode(
  claims: SessionClaims,
  ref: { tenantId: string; connectorId: ConnectorId; patientId: string; episodeId: string },
): boolean {
  if (claims.tenantId !== ref.tenantId) return false;
  if (claims.connectorId && claims.connectorId !== ref.connectorId) return false;
  if (claims.kind === "demo") return true;
  return claims.patientId === ref.patientId && claims.episodeId === ref.episodeId;
}

/**
 * Read and verify the `Authorization: Bearer <session token>` header. Throws HttpError:
 * 401 UNAUTHORIZED (missing), 401 TOKEN_EXPIRED, 401 TOKEN_INVALID (bad signature, wrong token type,
 * malformed), 403 FORBIDDEN (a tenant this deployment does not serve).
 */
export function requireSession(req: Request, opts: TokenOptions = {}): SessionClaims {
  const token = getBearerToken(req);
  if (!token) {
    throw new HttpError(401, "Session required", {
      code: "UNAUTHORIZED",
      detail: "Send the session token as 'Authorization: Bearer <token>'. Get one from POST /launch/verify or POST /sessions/demo.",
      headers: { "www-authenticate": 'Bearer realm="appstackx-reports"' },
    });
  }
  const result = verifySessionToken(token, opts);
  if (!result.ok) {
    const expired = result.reason === "expired";
    throw new HttpError(401, expired ? "Session expired" : "Session token invalid", {
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      detail: expired
        ? "The session has expired (sessions last 1 hour). Start again from the clinic system or the Studio."
        : "The session token could not be verified.",
      headers: { "www-authenticate": `Bearer realm="appstackx-reports", error="invalid_token"` },
    });
  }
  if (result.claims.tenantId !== DEMO_TENANT_ID) {
    throw new HttpError(403, "Unknown tenant", { code: "FORBIDDEN", detail: "This deployment serves the demo tenant only." });
  }
  return result.claims;
}

/** 403 SESSION_MISMATCH unless the session may use this connector (launch sessions are bound to one). */
export function assertSessionConnector(claims: SessionClaims, connectorId: ConnectorId): void {
  if (claims.connectorId && claims.connectorId !== connectorId) {
    throw new HttpError(403, "Session does not cover this connector", {
      code: "SESSION_MISMATCH",
      detail: `This session was issued for the ${claims.connectorId} connector.`,
    });
  }
}

/** 403 SESSION_MISMATCH unless `sessionAllowsEpisode`. */
export function assertSessionEpisode(
  claims: SessionClaims,
  ref: { tenantId: string; connectorId: ConnectorId; patientId: string; episodeId: string },
): void {
  if (!sessionAllowsEpisode(claims, ref)) {
    throw new HttpError(403, "Session does not cover this episode", {
      code: "SESSION_MISMATCH",
      detail: "This session was opened from the clinic system for a different patient or episode.",
    });
  }
}
