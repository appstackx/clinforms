/**
 * TESTS ONLY: callers for the Report API (wave 2 – every endpoint that handles patient data or drafting
 * needs an actor, auth/actor.ts).
 *
 * demoBearer() – an Authorization header value carrying a public-demo session (tenant "demo"), as the
 * demo Studio sends it. Minted at call time, so it uses the secrets in force for the test.
 */
import { createSessionToken } from "@/modules/medreport/auth/session-token";

export function demoSessionToken(): string {
  return createSessionToken({ tenantId: "demo", kind: "demo" }).token;
}

export function demoBearer(): string {
  return `Bearer ${demoSessionToken()}`;
}
