/**
 * Environment → Better Auth settings (pure functions, unit-tested):
 *
 *   BETTER_AUTH_SECRET  required (32+ characters); signs cookies and encrypts the two-step secrets
 *   BETTER_AUTH_URL     the app's public origin. Production: https://clinforms.co.uk (required there).
 *                       Vercel previews: leave it UNSET – the base URL is then taken from the request, but only
 *                       when the request's host is one of THIS deployment's own Vercel hostnames (VERCEL_URL,
 *                       VERCEL_BRANCH_URL); any other Host header falls back to the branch URL, so a forged
 *                       host can never end up in an invitation or reset link.
 *                       Local: default http://localhost:$PORT (3000).
 */
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

export function baseUrlSetting(env: Env = process.env): BaseUrlSetting {
  if (env.BETTER_AUTH_URL) return { kind: "static", url: originOf(env.BETTER_AUTH_URL, "BETTER_AUTH_URL") };
  if (env.VERCEL) {
    if (env.VERCEL_ENV === "production") {
      throw new AuthConfigError("BETTER_AUTH_URL must be set on the production deployment (https://clinforms.co.uk).");
    }
    const hosts = Array.from(new Set([env.VERCEL_BRANCH_URL, env.VERCEL_URL].filter((h): h is string => Boolean(h))));
    if (hosts.length === 0) throw new AuthConfigError("Set BETTER_AUTH_URL (no VERCEL_URL to derive the base URL from).");
    return { kind: "dynamic", allowedHosts: hosts, fallback: `https://${hosts[0]}`, protocol: "https" };
  }
  return { kind: "static", url: `http://localhost:${env.PORT || "3000"}` };
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
