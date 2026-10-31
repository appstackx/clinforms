/**
 * Environment → Better Auth settings (pure functions, unit-tested):
 *
 *   BETTER_AUTH_SECRET     required (32+ characters); signs cookies and encrypts the two-step secrets
 *   BETTER_AUTH_URL        the app's primary public origin. Production: https://clinforms.co.uk (required there).
 *                          Vercel previews: leave it UNSET – the base URL is then taken from the request, but only
 *                          when the request's host is one of THIS deployment's own Vercel hostnames (VERCEL_URL,
 *                          VERCEL_BRANCH_URL); any other Host header falls back to the branch URL, so a forged
 *                          host can never end up in an invitation or reset link.
 *                          Local: default http://localhost:$PORT (3000).
 *   CLINFORMS_AUTH_ORIGINS the OTHER public origins the same deployment signs people in on, comma-separated – the
 *                          brands' hosts (src/lib/brand.ts). Production: https://clindesk.co.uk (the clinic brand).
 *                          With it, the base URL is per request among BETTER_AUTH_URL + these origins (Better Auth's
 *                          allow-listed dynamic base URL, exactly as on previews), each origin is trusted for the
 *                          origin/CSRF check, and links go to the brand's own origin (brandOrigin). Unset: one static
 *                          base URL, exactly as before. Each origin must be a brand host of the same scheme as
 *                          BETTER_AUTH_URL (on production: https and a production host). Ignored on previews.
 *                          Locally e.g. http://clinic.localhost:3180 (with BETTER_AUTH_URL=http://localhost:3180).
 *
 * Cookies stay host-only (no Domain attribute): a session belongs to the host it was signed in on.
 */
import { BRANDS, brandForHost, hostName, type BrandId } from "../../lib/brand";

type Env = Readonly<Record<string, string | undefined>>;

export class AuthConfigError extends Error {
  readonly code = "AUTH_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export function authSecret(env: Env = process.env): string {
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new AuthConfigError("BETTER_AUTH_SECRET must be set to 32+ random characters (see docs/auth.md).");
  }
  return secret;
}

export type BaseUrlSetting =
  | { kind: "static"; url: string }
  | { kind: "dynamic"; allowedHosts: string[]; fallback: string; protocol: "https" | "http" };

function originOf(url: string, what: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    return parsed.origin;
  } catch {
    throw new AuthConfigError(`${what} is not a valid http(s) URL.`);
  }
}

/** Whether a host name (no port) belongs to a brand: its own hosts, or (local runs only) its dev hosts. */
function isBrandHost(name: string, allowDevHosts: boolean): boolean {
  return Object.values(BRANDS).some((b) => b.hosts.includes(name) || (allowDevHosts && b.devHosts.includes(name)));
}

/**
 * CLINFORMS_AUTH_ORIGINS → origins (deduplicated, in order). Each must be a bare http(s) origin of a brand host
 * (src/lib/brand.ts); on a Vercel production deployment https and a production host only.
 */
export function extraAuthOrigins(env: Env = process.env): string[] {
  const out: string[] = [];
  const onProduction = env.VERCEL_ENV === "production";
  for (const raw of (env.CLINFORMS_AUTH_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AuthConfigError("CLINFORMS_AUTH_ORIGINS must list origins such as https://clindesk.co.uk, separated by commas.");
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
      throw new AuthConfigError("CLINFORMS_AUTH_ORIGINS must list bare origins (scheme and host, no path), such as https://clindesk.co.uk.");
    }
    const name = hostName(url.host);
    if (!isBrandHost(name, !env.VERCEL)) {
      throw new AuthConfigError("CLINFORMS_AUTH_ORIGINS may only list the brands' hosts (src/lib/brand.ts).");
    }
    if (onProduction && url.protocol !== "https:") throw new AuthConfigError("CLINFORMS_AUTH_ORIGINS must use https on production.");
    if (!out.includes(url.origin)) out.push(url.origin);
  }
  return out;
}

/** The primary origin plus the other brand origins: one static base URL when there are none, else dynamic. */
function withBrandOrigins(primary: string, extras: string[]): BaseUrlSetting {
  const origins = [primary, ...extras.filter((o) => o !== primary)];
  if (origins.length === 1) return { kind: "static", url: primary };
  const protocol = primary.startsWith("https://") ? "https" : "http";
  if (origins.some((o) => !o.startsWith(`${protocol}://`))) {
    throw new AuthConfigError("CLINFORMS_AUTH_ORIGINS must use the same scheme as BETTER_AUTH_URL (https in production).");
  }
  return { kind: "dynamic", allowedHosts: origins.map((o) => new URL(o).host), fallback: primary, protocol };
}

export function baseUrlSetting(env: Env = process.env): BaseUrlSetting {
  if (env.BETTER_AUTH_URL) return withBrandOrigins(originOf(env.BETTER_AUTH_URL, "BETTER_AUTH_URL"), extraAuthOrigins(env));
  if (env.VERCEL) {
    if (env.VERCEL_ENV === "production") {
      throw new AuthConfigError("BETTER_AUTH_URL must be set on the production deployment (https://clinforms.co.uk).");
    }
    const hosts = Array.from(new Set([env.VERCEL_BRANCH_URL, env.VERCEL_URL].filter((h): h is string => Boolean(h))));
    if (hosts.length === 0) throw new AuthConfigError("Set BETTER_AUTH_URL (no VERCEL_URL to derive the base URL from).");
    return { kind: "dynamic", allowedHosts: hosts, fallback: `https://${hosts[0]}`, protocol: "https" };
  }
  return withBrandOrigins(`http://localhost:${env.PORT || "3000"}`, extraAuthOrigins(env));
}

/** Every origin Better Auth trusts for its origin/CSRF check under a setting (also derived by Better Auth itself). */
export function trustedOriginsOf(setting: BaseUrlSetting): string[] {
  if (setting.kind === "static") return [setting.url];
  return Array.from(new Set([setting.fallback, ...setting.allowedHosts.map((h) => `${setting.protocol}://${h}`)]));
}

/**
 * The origin of a brand under a setting: the first allowed origin whose host is that brand's (clindesk.co.uk for
 * "clinic" in production, clinic.localhost:<port> locally), else the primary origin (BETTER_AUTH_URL, or a
 * preview's branch URL) – so a deployment without the brand's host keeps every link on its own origin.
 */
export function brandOrigin(setting: BaseUrlSetting, brand: BrandId): string {
  if (setting.kind === "static") return setting.url;
  const fallbackBrand = brandForHost(new URL(setting.fallback).host).id;
  if (fallbackBrand === brand) return setting.fallback;
  const host = setting.allowedHosts.find((h) => !h.includes("*") && brandForHost(h).id === brand && isBrandHost(hostName(h), true));
  return host ? `${setting.protocol}://${host}` : setting.fallback;
}

/**
 * Where a link for `brand` goes and which brand it then speaks for: the brand's own origin, or – when this deployment
 * does not serve that brand's host – the primary origin, speaking for ClinForms (an email never names a brand whose
 * host its link does not open).
 */
export function linkTarget(setting: BaseUrlSetting, brand: BrandId): { origin: string; brand: BrandId } {
  const origin = brandOrigin(setting, brand);
  return { origin, brand: brandForHost(new URL(origin).host).id };
}

/** The brand of a request's host when that host is one of the setting's own origins (else null: not trusted). */
export function requestBrand(setting: BaseUrlSetting, headers?: Headers | null): BrandId | null {
  const host = headers?.get("host")?.trim().toLowerCase();
  if (!host) return null;
  const allowed = setting.kind === "static" ? [new URL(setting.url).host] : setting.allowedHosts.map((h) => h.toLowerCase());
  return allowed.includes(host) ? brandForHost(host).id : null;
}

/** Better Auth's `baseURL` option for a setting. */
export function betterAuthBaseURL(setting: BaseUrlSetting): string | { allowedHosts: string[]; fallback: string; protocol: "https" | "http" } {
  return setting.kind === "static" ? setting.url : { allowedHosts: setting.allowedHosts, fallback: setting.fallback, protocol: setting.protocol };
}

/**
 * The app's origin for links we build (invitations, password resets), from the request headers when the
 * setting is dynamic. Never trusts a host outside the allow-list.
 */
export function appOrigin(setting: BaseUrlSetting, headers?: Headers | null): string {
  if (setting.kind === "static") return setting.url;
  const host = headers?.get("host")?.trim().toLowerCase();
  if (host && setting.allowedHosts.some((h) => h.toLowerCase() === host)) return `${setting.protocol}://${host}`;
  return setting.fallback;
}

export function usesSecureCookies(setting: BaseUrlSetting): boolean {
  return setting.kind === "dynamic" ? setting.protocol === "https" : setting.url.startsWith("https://");
}

/** CLINFORMS_PLATFORM_ADMINS: comma-separated emails allowed into any future platform-admin page. */
export function platformAdmins(env: Env = process.env): Set<string> {
  return new Set(
    (env.CLINFORMS_PLATFORM_ADMINS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)),
  );
}

export function isPlatformAdmin(email: string | null | undefined, env: Env = process.env): boolean {
  return Boolean(email) && platformAdmins(env).has(String(email).trim().toLowerCase());
}

/** Only same-site paths inside the app may be used as a post-sign-in destination (no open redirects). */
export function safeNextPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  if (value === "/app" || value.startsWith("/app/") || value.startsWith("/app?") || value.startsWith("/accept-invite?")) return value;
  return fallback;
}
