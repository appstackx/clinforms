/**
 * Bot check for the public booking and sign-in forms – READY BUT OFF. When both
 *   NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY (shown in the page) and CLINIC_TURNSTILE_SECRET (server only)
 * are set, the forms show the challenge and the server verifies the token with Cloudflare's siteverify endpoint
 * before booking; otherwise the honeypot field and the rate limits protect the forms on their own. Turning it on
 * also needs challenges.cloudflare.com in the Content Security Policy (script-src, frame-src) – next.config.mjs.
 */
import "server-only";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Readonly<Record<string, string | undefined>>;

export function humanCheckSiteKey(env: Env = process.env): string | null {
  const site = env.NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY?.trim();
  const secret = env.CLINIC_TURNSTILE_SECRET?.trim();
  return site && secret ? site : null;
}

export async function verifyHumanCheck(
  token: string | null | undefined,
  clientIp: string | null,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; checked: boolean } | { ok: false }> {
  const secret = env.CLINIC_TURNSTILE_SECRET?.trim();
  if (!humanCheckSiteKey(env) || !secret) return { ok: true, checked: false };
  if (typeof token !== "string" || token.length < 10 || token.length > 4096) return { ok: false };
  const body = new URLSearchParams({ secret, response: token });
  if (clientIp) body.set("remoteip", clientIp);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { success?: unknown };
    return json.success === true ? { ok: true, checked: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}
