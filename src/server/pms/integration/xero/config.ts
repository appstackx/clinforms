/**
 * Xero sync: the platform's Xero app, from env NAMES only (values live in the host's env, never in git or app .env
 * files): XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI. Nothing here runs unless CLINFORMS_XERO=on.
 */
import "server-only";
import { XERO_CLIENT_ID_ENV, XERO_CLIENT_SECRET_ENV, XERO_REDIRECT_URI_ENV, xeroSwitchOn } from "../../../../modules/pms/integration/xero";
import { XeroClient, type FetchLike, type XeroAppConfig } from "./client";

type Env = Readonly<Record<string, string | undefined>>;

export function xeroAvailable(env: Env = process.env): boolean {
  return xeroSwitchOn(env);
}

/** The app's credentials, or null while any is missing or the redirect address is not https (http only for localhost). */
export function xeroAppConfig(env: Env = process.env): XeroAppConfig | null {
  const clientId = (env[XERO_CLIENT_ID_ENV] ?? "").trim();
  const clientSecret = (env[XERO_CLIENT_SECRET_ENV] ?? "").trim();
  const redirectUri = (env[XERO_REDIRECT_URI_ENV] ?? "").trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  if (u.pathname !== "/api/xero/callback" || u.search || u.hash) return null;
  return { clientId, clientSecret, redirectUri };
}

/** The host (and port) the redirect address points at: the connect must start on that host (host-only session cookies). */
export function redirectHost(config: XeroAppConfig): string {
  return new URL(config.redirectUri).host;
}

export function xeroClientFromEnv(env: Env = process.env, fetchImpl: FetchLike = (input, init) => fetch(input, init)): XeroClient | null {
  if (!xeroAvailable(env)) return null;
  const config = xeroAppConfig(env);
  return config ? new XeroClient(config, { fetch: fetchImpl }) : null;
}
