import "server-only";

/**
 * ClinForms – server configuration and secrets.
 *
 * Reads `process.env` at CALL time (never at module load) so tests and route handlers see current
 * values. Never log or return secret values.
 *
 * Env vars (see .env.example): ANTHROPIC_API_KEY, MEDREPORT_AI_MODE, MEDREPORT_MODEL,
 * MEDREPORT_LIVE_PASSCODE, MEDREPORT_LAUNCH_SECRET, MEDREPORT_SIGNING_SECRET, MEDREPORT_PARTNER_KEY,
 * TM3_SIM_TOKEN, TM3_SIM_BASE_URL; wave 2: CLINFORMS_PUBLIC_DEMO, APP_ORIGIN (else BETTER_AUTH_URL),
 * CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE, CLINFORMS_TENANT_LIVE_CALLS_PER_DAY.
 */
import { createHmac } from "node:crypto";
import type { AiMode } from "./core/types";

/**
 * Claude models that MEDREPORT_MODEL may select. Each was checked against this app's exact request
 * (ai/claude.ts: structured output, explicit effort low/medium/high, no `thinking` parameter, no
 * sampling parameters, server-side fallbacks "default") on 09/10/2026. Claude Fable 5.1 is left out on
 * purpose: it needs 30-day data retention and costs five times as much. Add an id here only after
 * re-running the effort sweep and the quality checks with it (README → "Model and effort").
 */
export const AI_MODEL_ALLOW_LIST = [
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-5-5",
  "claude-opus-4-8",
] as const;
export type AiModelId = (typeof AI_MODEL_ALLOW_LIST)[number];

/** The default model for live drafting and form analysis (owner decision: Claude Sonnet 5.5). */
export const DEFAULT_AI_MODEL: AiModelId = "claude-sonnet-5-5";

export interface AiModelSetting {
  /** The model the calls use. */
  model: AiModelId;
  /** MEDREPORT_MODEL as set (trimmed), when it is not on the allow-list and was ignored. */
  rejected?: string;
}

function isAllowedModel(value: string): value is AiModelId {
  return (AI_MODEL_ALLOW_LIST as readonly string[]).indexOf(value) >= 0;
}

/**
 * Resolve a MEDREPORT_MODEL value: an allow-listed id (case and surrounding spaces ignored), else the
 * default. An unknown value never reaches the API (it would fail every live call); it is reported in
 * `rejected` so the caller can log it.
 */
export function resolveAiModel(raw: string | undefined): AiModelSetting {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return { model: DEFAULT_AI_MODEL };
  return isAllowedModel(value) ? { model: value } : { model: DEFAULT_AI_MODEL, rejected: raw!.trim().slice(0, 80) };
}

let warnedRejectedModel: string | null = null;

/**
 * AI_MODEL – the model used for live drafting and live form analysis: MEDREPORT_MODEL when it names an
 * allow-listed Claude model, else DEFAULT_AI_MODEL ("claude-sonnet-5-5"). Read at call time. An
 * unknown value is ignored with one warning in the server log. The model id is internal: API fields
 * the Studio shows carry publicEngineName() instead.
 */
export function aiModel(): AiModelId {
  const setting = resolveAiModel(process.env.MEDREPORT_MODEL);
  if (setting.rejected && warnedRejectedModel !== setting.rejected) {
    warnedRejectedModel = setting.rejected;
    // Same one-line JSON shape as api/http.ts logEvent() (not imported here: config has no dependencies).
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        svc: "medreport",
        event: "config.model_rejected",
        value: setting.rejected,
        using: setting.model,
        allowed: AI_MODEL_ALLOW_LIST.join(","),
      }),
    );
  }
  return setting.model;
}

export type AiModeSetting = "auto" | "demo" | "live";

/** Secrets that fall back to a FIXED demo constant when the deployment runs in demo AI mode. */
export type SecretName =
  | "MEDREPORT_LAUNCH_SECRET"
  | "MEDREPORT_SIGNING_SECRET"
  | "MEDREPORT_PARTNER_KEY"
  | "TM3_SIM_TOKEN";

/**
 * Fixed (never per-instance random) fallbacks, used ONLY in demo AI mode so a public demo link works
 * without configuration. They are public by design and protect fictional data only.
 * The sandbox duplicates the partner-key and TM3-sim-token fallbacks (it may not import this module).
 */
const DEMO_SECRET_FALLBACKS: Record<SecretName, string> = {
  MEDREPORT_LAUNCH_SECRET: "demo-only-launch-secret-appstackx-reports-v1",
  MEDREPORT_SIGNING_SECRET: "demo-only-signing-secret-appstackx-reports-v1",
  MEDREPORT_PARTNER_KEY: "demo-only-partner-key-v1",
  TM3_SIM_TOKEN: "demo-only-tm3-sim-token-v1",
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** MEDREPORT_AI_MODE: "auto" (default), "demo" or "live". Unknown values are treated as "auto". */
export function aiModeSetting(): AiModeSetting {
  const raw = env("MEDREPORT_AI_MODE")?.toLowerCase();
  return raw === "demo" || raw === "live" ? raw : "auto";
}

export function hasAnthropicKey(): boolean {
  return env("ANTHROPIC_API_KEY") !== undefined;
}

/**
 * The shortest MEDREPORT_LIVE_PASSCODE accepted. The passcode is all that stands between the public demo and
 * live drafting on this deployment's API key, and wrong guesses are only rate limited (auth/passcode.ts), so a
 * shorter one counts as NOT configured: live drafting stays off and the server log says why (once).
 * The sandbox repeats this rule (src/sandbox/tm3-sim/server-config.ts).
 */
export const MIN_LIVE_PASSCODE_LENGTH = 16;

let warnedShortPasscode = false;

/** MEDREPORT_LIVE_PASSCODE (trimmed) when it is set and long enough, else undefined. */
function livePasscodeSetting(): string | undefined {
  const value = env("MEDREPORT_LIVE_PASSCODE");
  if (value === undefined || value.length >= MIN_LIVE_PASSCODE_LENGTH) return value;
  if (!warnedShortPasscode) {
    warnedShortPasscode = true;
    // Same one-line JSON shape as api/http.ts logEvent(); never the value or its length.
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        svc: "medreport",
        event: "config.live_passcode_too_short",
        minLength: MIN_LIVE_PASSCODE_LENGTH,
        effect: "live drafting off for the public demo",
      }),
    );
  }
  return undefined;
}

/**
 * Whether a usable live-AI passcode is configured: set, and at least MIN_LIVE_PASSCODE_LENGTH characters (its
 * value is never exposed).
 */
export function hasLivePasscode(): boolean {
  return livePasscodeSetting() !== undefined;
}

/**
 * Live drafting is available when the mode is not forced to "demo" AND an API key AND a passcode (16+
 * characters) are configured. ("live" cannot be honoured without a key, so it then degrades to demo.)
 */
export function liveAiAvailable(): boolean {
  return aiModeSetting() !== "demo" && hasAnthropicKey() && hasLivePasscode();
}

/** Effective AI mode of this deployment: "live" when liveAiAvailable(), otherwise "demo". */
export function resolveAiMode(): AiMode {
  return liveAiAvailable() ? "live" : "demo";
}

/** True on a Vercel PRODUCTION deployment (previews and local runs are not production). */
export function isProductionDeployment(): boolean {
  return env("VERCEL_ENV") === "production";
}

/**
 * The launch and signing secrets protect session tokens, approval receipts, form-map confirmations and
 * filed-document tokens. Their public demo constants are acceptable on a preview or a local demo, but
 * on a production deployment anyone who reads the repository could forge receipts with them. There,
 * an unset secret is DERIVED from a server-only secret the deployment already holds
 * (HMAC-SHA256(ANTHROPIC_API_KEY or VERCEL_AUTOMATION_BYPASS_SECRET, purpose)) – stable across
 * instances, never public – or refused, unless MEDREPORT_ALLOW_DEMO_SECRETS=1 is set explicitly.
 */
const NO_PUBLIC_FALLBACK_IN_PRODUCTION: ReadonlySet<SecretName> = new Set<SecretName>(["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET"]);

function derivedSecret(name: SecretName): string | null {
  const root = env("ANTHROPIC_API_KEY") ?? env("VERCEL_AUTOMATION_BYPASS_SECRET");
  return root ? createHmac("sha256", root).update(`appstackx-reports:${name}:v1`, "utf8").digest("base64url") : null;
}

/**
 * A required secret. If it is unset: in demo AI mode returns the FIXED demo constant (except the
 * launch and signing secrets on a production deployment – see above); otherwise throws (a live
 * deployment must configure every secret).
 */
export function getSecret(name: SecretName): string {
  const value = env(name);
  if (value) return value;
  if (resolveAiMode() === "demo") {
    if (NO_PUBLIC_FALLBACK_IN_PRODUCTION.has(name) && isProductionDeployment() && env("MEDREPORT_ALLOW_DEMO_SECRETS") !== "1") {
      const derived = derivedSecret(name);
      if (derived) return derived;
      throw new Error(`${name} is not configured (required on a production deployment; set it, or MEDREPORT_ALLOW_DEMO_SECRETS=1)`);
    }
    return DEMO_SECRET_FALLBACKS[name];
  }
  throw new Error(`${name} is not configured`);
}

/**
 * A purpose-bound key derived from MEDREPORT_SIGNING_SECRET (domain separation: a receipt MAC can
 * never be replayed as a form-map confirmation or a filed-document token).
 */
export function signingKey(purpose: "receipt" | "form-confirmation" | "file-token" | "rate-limit-key"): string {
  const secret = getSecret("MEDREPORT_SIGNING_SECRET");
  return purpose === "receipt" ? secret : createHmac("sha256", secret).update(`appstackx-reports:${purpose}:v1`, "utf8").digest("base64url");
}

/**
 * The live-AI passcode, or null when none is configured (or it is shorter than MIN_LIVE_PASSCODE_LENGTH).
 * Compare with timingSafeEqualString only.
 */
export function getLivePasscode(): string | null {
  return livePasscodeSetting() ?? null;
}

/**
 * Base URL of the simulated TM3 API (e.g. https://clinforms.co.uk), or null to use the
 * request origin. The connector falls back to in-process calls if HTTP is blocked (preview protection).
 */
export function getTm3SimBaseUrl(): string | null {
  return env("TM3_SIM_BASE_URL") ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Wave 2: the public demo, clinics (tenant actors) and trusted origins
 * ----------------------------------------------------------------------------------------------*/

/**
 * CLINFORMS_PUBLIC_DEMO: the public demo – tenant "demo" at /reports and /pms-sandbox, fictional data,
 * browser storage, anonymous demo sessions – is ON unless this is exactly "0".
 */
export function publicDemoEnabled(): boolean {
  return env("CLINFORMS_PUBLIC_DEMO") !== "0";
}

/**
 * Live drafting and form analysis for a CLINIC (a signed-in member): the mode is not forced to "demo" and
 * an API key is configured. No passcode – the passcode gates the public demo only; a clinic's use is
 * governed by clinic_profile.drafting_enabled and the per-clinic limits below.
 */
export function tenantLiveAiAvailable(): boolean {
  return aiModeSetting() !== "demo" && hasAnthropicKey();
}

export interface TenantDraftingLimits {
  /** Live calls (drafting groups + analysis chunks) per clinic per minute. */
  perMinute: number;
  /** Live calls per clinic per UTC day. */
  perDay: number;
}

export const DEFAULT_TENANT_LIVE_CALLS_PER_MINUTE = 10;
export const DEFAULT_TENANT_LIVE_CALLS_PER_DAY = 400;

function intSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= min && n <= max ? n : fallback;
}

/** CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE (default 10) and CLINFORMS_TENANT_LIVE_CALLS_PER_DAY (default 400). */
export function tenantDraftingLimits(): TenantDraftingLimits {
  return {
    perMinute: intSetting("CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE", DEFAULT_TENANT_LIVE_CALLS_PER_MINUTE, 1, 600),
    perDay: intSetting("CLINFORMS_TENANT_LIVE_CALLS_PER_DAY", DEFAULT_TENANT_LIVE_CALLS_PER_DAY, 1, 1_000_000),
  };
}

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function requestHost(req: Request | undefined): string | null {
  if (!req) return null;
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || req.headers.get("host")?.trim();
  if (host) return host.toLowerCase();
  try {
    return new URL(req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

function requestProto(req: Request): "http" | "https" {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  try {
    return new URL(req.url).protocol === "https:" ? "https" : "http";
  } catch {
    return "https";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** This Vercel deployment's own hostnames (platform-set, never from the request). */
function vercelHosts(): string[] {
  if (!env("VERCEL")) return [];
  return Array.from(
    new Set(
      [env("VERCEL_BRANCH_URL"), env("VERCEL_URL"), env("VERCEL_PROJECT_PRODUCTION_URL")]
        .filter((h): h is string => Boolean(h))
        .map((h) => h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()),
    ),
  );
}

/**
 * The app's public origin for links the server builds (the launch URL of POST /launch): APP_ORIGIN, else
 * BETTER_AUTH_URL, else – on Vercel – the request's host when it is one of THIS deployment's own
 * hostnames (else its branch/deployment URL), else – locally – the request's host when it is the loopback
 * interface (else http://localhost:$PORT), or TM3_SIM_BASE_URL's origin when the request came to that host.
 * Never a forged Host header.
 */
export function appOrigin(req?: Request): string {
  const configured = originOf(env("APP_ORIGIN")) ?? originOf(env("BETTER_AUTH_URL"));
  if (configured) return configured;
  const host = requestHost(req);
  const hosts = vercelHosts();
  if (hosts.length > 0) {
    if (host && hosts.indexOf(host) >= 0) return `https://${host}`;
    return `https://${hosts[0]}`;
  }
  if (req && host) {
    let hostname = "";
    try {
      hostname = new URL(`http://${host}`).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
    if (LOOPBACK_HOSTNAMES.has(hostname)) return `${requestProto(req)}://${host}`;
    const sim = originOf(env("TM3_SIM_BASE_URL"));
    if (sim && new URL(sim).host.toLowerCase() === host) return sim;
  }
  return `http://localhost:${env("PORT") ?? "3000"}`;
}

/**
 * Origins a state-changing browser request may come from (CSRF check in api/http.ts bindHandler): the
 * request's own origin, APP_ORIGIN, BETTER_AUTH_URL, this Vercel deployment's hostnames and TM3_SIM_BASE_URL.
 */
export function allowedRequestOrigins(req: Request): string[] {
  const list: string[] = [];
  const host = requestHost(req);
  if (host) list.push(`${requestProto(req)}://${host}`);
  for (const raw of [env("APP_ORIGIN"), env("BETTER_AUTH_URL"), env("TM3_SIM_BASE_URL")]) {
    const o = originOf(raw);
    if (o) list.push(o);
  }
  for (const h of vercelHosts()) list.push(`https://${h}`);
  return Array.from(new Set(list.map((o) => o.toLowerCase())));
}
