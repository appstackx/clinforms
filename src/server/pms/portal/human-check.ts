/**
 * Bot check for the public booking and sign-in forms – READY BUT OFF. When both
 *   NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY (shown in the page) and CLINIC_TURNSTILE_SECRET (server only)
 * are set, the forms show the Cloudflare Turnstile widget (src/components/pms/portal/human-check.tsx; the pages pass
 * humanCheckSiteKey() down), the actions forward its token (humanTokenFrom) and the server verifies it with
 * Cloudflare's siteverify endpoint before booking or sending a sign-in link; otherwise the honeypot field and the
 * rate limits protect the forms on their own. next.config.mjs adds challenges.cloudflare.com to the Content Security
 * Policy (script-src, frame-src) when the site key is set at build time.
 */
import "server-only";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Env = Readonly<Record<string, string | undefined>>;

export function humanCheckSiteKey(env: Env = process.env): string | null {
  const site = env.NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY?.trim();
  const secret = env.CLINIC_TURNSTILE_SECRET?.trim();
  return site && secret ? site : null;
}

/**
 * The widget's token from a form's input (the field `humanToken`), or null. The schemas ignore the extra field; the
 * actions pass it to the flows as FlowDeps.humanToken (final check 29/10/2026: before this the token never reached
 * the server, so setting the two keys refused every booking and sign-in link).
 */
export function humanTokenFrom(input: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const t = input?.humanToken;
  return typeof t === "string" && t.length > 0 && t.length <= 4096 ? t : null;
}

/**
 * M10 M6: on a production deployment (VERCEL_ENV=production) online booking for new patients needs the bot check –
 * without it booking cannot be switched on, and the public booking page refuses bookings. Local and preview
 * deployments keep working without it (the honeypot and the rate limits).
 */
export function humanCheckRequired(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** Why public online booking may not run here, or null. */
export function bookingNeedsHumanCheck(env: Env = process.env): string | null {
  return humanCheckRequired(env) && !humanCheckSiteKey(env) ? "Online booking needs the bot check (Cloudflare Turnstile) set up on this deployment first. Ask ClinForms support." : null;
}

/**
 * The client's address for the public pages' rate limits (M10 M6), from the header the platform sets – never the
 * first, client-written value of x-forwarded-for. On Vercel: x-real-ip (set by Vercel), else the LAST hop of
 * x-forwarded-for (the one Vercel's edge appended). Locally: the last hop too, else "local". The ClinForms sign-in
 * flows keep src/server/auth/session.ts clientIp unchanged.
 */
export function trustedClientIp(h: Pick<Headers, "get">, env: Env = process.env): string {
  const real = h.get("x-real-ip")?.trim();
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const last = hops[hops.length - 1];
  const ip = env.VERCEL === "1" || env.VERCEL_ENV ? (real || last) : (last || real);
  return (ip || "local").slice(0, 64);
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
