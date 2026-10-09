import "server-only";

/**
 * Launch tokens: issued by POST /launch to the clinic system (partner key), carried in
 * /reports/new?lt=…, exchanged once by POST /launch/verify for a session token. HMAC-SHA256 with
 * MEDREPORT_LAUNCH_SECRET, 10-minute expiry.
 *
 * Owner: integration agent. (Implemented by the foundation.)
 */
import { createId } from "../core/ids";
import { getSecret } from "../config.server";
import { LaunchClaimsSchema } from "../core/schemas";
import type { LaunchClaims } from "../core/types";
import { signHmacToken, verifyHmacToken, type TokenVerifyResult } from "./hmac-token";

export const LAUNCH_TOKEN_TTL_SECONDS = 600;

export type LaunchTokenInput = Omit<LaunchClaims, "iat" | "exp">;

export interface TokenOptions {
  now?: Date;
  /** Override the secret (tests). Default: getSecret("MEDREPORT_LAUNCH_SECRET"). */
  secret?: string;
}

export interface IssuedLaunchToken {
  token: string;
  claims: LaunchClaims;
  /** ISO timestamp of `claims.exp`. */
  expiresAt: string;
}

export function createLaunchToken(
  input: LaunchTokenInput,
  opts: TokenOptions & { ttlSeconds?: number } = {},
): IssuedLaunchToken {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = iat + (opts.ttlSeconds ?? LAUNCH_TOKEN_TTL_SECONDS);
  const claims: LaunchClaims = LaunchClaimsSchema.parse({ jti: createId("lt"), ...input, iat, exp });
  const token = signHmacToken("medreport.launch", claims, opts.secret ?? getSecret("MEDREPORT_LAUNCH_SECRET"));
  return { token, claims, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyLaunchToken(token: string, opts: TokenOptions = {}): TokenVerifyResult<LaunchClaims> {
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return verifyHmacToken(
    token,
    "medreport.launch",
    opts.secret ?? getSecret("MEDREPORT_LAUNCH_SECRET"),
    LaunchClaimsSchema,
    nowSeconds,
  );
}
