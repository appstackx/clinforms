/**
 * Simulated TM3 sandbox – server-side secrets. Demo scaffolding, NOT the product.
 *
 * Mirrors the module's config.server.ts `getSecret()` rule without importing the module:
 * - the env var wins when it is set;
 * - otherwise, in demo AI mode, the FIXED public demo constant from config.ts is used;
 * - otherwise (a live deployment with the secret missing) the secret is "not configured" → null.
 *
 * "Demo AI mode" = MEDREPORT_AI_MODE is "demo", or ANTHROPIC_API_KEY / MEDREPORT_LIVE_PASSCODE is unset
 * (same rule as the module's resolveAiMode()). Values are read at call time and never logged.
 *
 * Only server code (route handlers, server actions) imports this file.
 *
 * Owner: sandbox agent.
 */
import { DEMO_FALLBACKS } from "./config";

export type SandboxSecretName = keyof typeof DEMO_FALLBACKS;

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** Same rule as the module's resolveAiMode(): live only with mode ≠ demo, an API key and a passcode. */
export function sandboxDemoMode(): boolean {
  const mode = env("MEDREPORT_AI_MODE")?.toLowerCase();
  const live = mode !== "demo" && env("ANTHROPIC_API_KEY") !== undefined && env("MEDREPORT_LIVE_PASSCODE") !== undefined;
  return !live;
}

/** The secret, its fixed demo fallback in demo mode, or null when a live deployment has not set it. */
export function getSandboxSecret(name: SandboxSecretName): string | null {
  const value = env(name);
  if (value) return value;
  return sandboxDemoMode() ? DEMO_FALLBACKS[name] : null;
}

/** Constant-time string comparison (no early exit on the first differing character). */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
