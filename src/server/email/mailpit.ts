/**
 * Mailpit (https://mailpit.axllent.org): a LOCAL test mail catcher. Messages are handed to its HTTP send API
 * (POST <MAILPIT_URL>/api/v1/send) and land in its inbox (web UI at MAILPIT_URL); nothing ever reaches a real
 * mailbox. Shared by the ClinForms account emails (CLINFORMS_EMAIL_PROVIDER=mailpit) and the clinic-system patient
 * emails (CLINIC_EMAIL_PROVIDER=mailpit).
 *
 * Local only, by construction (mailpitRefusal):
 *   - refused whenever VERCEL_ENV is set to anything (a Vercel deployment, preview, or a pulled Vercel env);
 *   - refused when NODE_ENV=production unless MAILPIT_URL points at this machine (localhost / 127.0.0.1 / ::1),
 *     so a local `next start` works but a production build elsewhere cannot post links to some other host.
 * MAILPIT_URL defaults to http://localhost:8026. It must be plain http(s) with no user name or password in it.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_MAILPIT_URL = "http://localhost:8026";

/** How long a hand-over to Mailpit may take before it counts as failed. */
export const MAILPIT_TIMEOUT_MS = 5000;

export interface MailpitAddress {
  Email: string;
  Name?: string;
}

/** The JSON body of POST /api/v1/send (Mailpit v1.x). */
export interface MailpitSendBody {
  From: MailpitAddress;
  To: MailpitAddress[];
  ReplyTo?: MailpitAddress[];
  Subject: string;
  Text: string;
  HTML?: string;
  Headers?: Record<string, string>;
  Tags?: string[];
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** MAILPIT_URL parsed (default http://localhost:8026), or null when it is not a plain http(s) URL. */
export function mailpitBaseUrl(env: Env = process.env): URL | null {
  const raw = (env.MAILPIT_URL ?? "").trim() || DEFAULT_MAILPIT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

/**
 * Why Mailpit may not be used here, or null when it may. The reason never contains the URL.
 */
export function mailpitRefusal(env: Env = process.env): string | null {
  if ((env.VERCEL_ENV ?? "").trim()) return "Mailpit is local only: it is refused on any Vercel environment.";
  const url = mailpitBaseUrl(env);
  if (!url) return "MAILPIT_URL must be a plain http(s) address, such as http://localhost:8026.";
  if (env.NODE_ENV === "production" && !isLoopbackHost(url.hostname)) {
    return "Mailpit is local only: with NODE_ENV=production, MAILPIT_URL must point at localhost or 127.0.0.1.";
  }
  return null;
}

export type MailpitResult = { ok: true; id: string } | { ok: false; status: number | null };

/** Hands one message to Mailpit. Never throws; never logs the message. */
export async function mailpitSend(
  base: URL,
  body: MailpitSendBody,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<MailpitResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = new URL("api/v1/send", base.href.endsWith("/") ? base.href : `${base.href}/`);
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? MAILPIT_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json().catch(() => null)) as { ID?: unknown } | null;
    const id = typeof data?.ID === "string" && data.ID ? data.ID : "unknown";
    return { ok: true, id };
  } catch {
    return { ok: false, status: null };
  }
}
