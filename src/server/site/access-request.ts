/**
 * "Request access" (public website → POST /api/access-requests): validation, spam protection, storage
 * and the optional notification email. No patient information is requested; the form says not to
 * include any.
 *
 * Spam protection: a hidden honeypot field (a filled one is answered "ok" and dropped) and a fixed-window
 * rate limit per client (keyed by an HMAC of the IP address, never the address itself) plus a global cap,
 * both in the shared `rate_limits` table.
 *
 * Kept free of Next.js imports so it can be tested directly (access-request.test.ts).
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { nowIso, type RepoContext } from "../repos/context";
import { createAccessRequest } from "../repos/access-requests";
import { hitRateLimit } from "../repos/rate-limits";

export const SITE_BANDS = ["1", "2-5", "6-10", "11+"] as const;
export type SitesBand = (typeof SITE_BANDS)[number];

const PER_CLIENT_LIMIT = 5;
const GLOBAL_LIMIT = 100;
const WINDOW_MS = 60 * 60 * 1000;
/** Largest request body accepted (bytes). */
export const MAX_ACCESS_REQUEST_BYTES = 16 * 1024;

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const AccessRequestBodySchema = z.object({
  clinicName: text("Clinic name", 200),
  contactName: text("Your name", 200),
  email: z
    .string({ error: "Work email is required." })
    .trim()
    .max(254, "Work email is too long.")
    .pipe(z.email("Enter a valid work email address.")),
  phone: z
    .string()
    .trim()
    .max(40, "Phone must be at most 40 characters.")
    .regex(/^[0-9+()\-.\s]*$/, "Phone may contain only digits, spaces and + ( ) - .")
    .optional()
    .default(""),
  sites: z.enum(SITE_BANDS, { error: "Choose the number of sites." }),
  message: z.string().trim().max(2000, "Message must be at most 2,000 characters.").optional().default(""),
  /** Honeypot: hidden from people, filled by naive bots. */
  website: z.string().max(500).optional().default(""),
});

export type AccessRequestBody = z.infer<typeof AccessRequestBodySchema>;

export type AccessRequestOutcome =
  | { kind: "stored"; id: string; sites: SitesBand }
  | { kind: "spam" }
  | { kind: "invalid"; fieldErrors: Record<string, string> }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export interface AccessRequestDeps {
  ctx: RepoContext;
  /** Pseudonymous client key (hashClientIp), or null when the client address is unknown. */
  clientKey: string | null;
  /** Sends the notification; failures are reported to the caller but never undo the stored request. */
  notify?: (request: NotificationPayload) => Promise<void>;
  now?: () => Date;
}

export interface NotificationPayload {
  id: string;
  clinicName: string;
  contactName: string;
  email: string;
  phone: string | null;
  sites: SitesBand;
  message: string | null;
  createdAt: string;
}

/** First message per field, keyed by field name ("form" for anything else). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** The stored message: the number of sites first (the table has no column for it), then the visitor's text. */
export function storedMessage(sites: SitesBand, message: string): string {
  const head = `Sites: ${sites}`;
  return message ? `${head}\n\n${message}` : head;
}

/**
 * Validates, applies the spam checks, stores the request and (optionally) sends the notification.
 * Returns what happened; the route maps it to an HTTP response.
 */
export async function submitAccessRequest(raw: unknown, deps: AccessRequestDeps): Promise<AccessRequestOutcome & { notified?: boolean }> {
  const parsed = AccessRequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    // A bot that fills the honeypot gets the same quiet "ok" even when other fields are invalid.
    if (raw && typeof raw === "object" && typeof (raw as { website?: unknown }).website === "string" && (raw as { website: string }).website.trim()) {
      return { kind: "spam" };
    }
    return { kind: "invalid", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const body = parsed.data;
  if (body.website.trim()) return { kind: "spam" };

  const ctx: RepoContext = deps.now ? { ...deps.ctx, now: deps.now } : deps.ctx;
  const limited = (resetAtIso: string): AccessRequestOutcome => ({
    kind: "rate_limited",
    retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(resetAtIso) - Date.parse(nowIso(ctx))) / 1000)),
  });
  // The client's own limit first: a client over it never touches the shared counter, so one sender cannot
  // use up the site-wide allowance and block the form for everyone else.
  const client = deps.clientKey ? await hitRateLimit(ctx, `access-request:${deps.clientKey}`, WINDOW_MS) : null;
  if (client && client.count > PER_CLIENT_LIMIT) return limited(client.resetAt);
  const global = await hitRateLimit(ctx, "access-request:all", WINDOW_MS);
  if (global.count > GLOBAL_LIMIT) return limited(global.resetAt);

  const stored = await createAccessRequest(ctx, {
    clinicName: body.clinicName,
    contactName: body.contactName,
    email: body.email,
    phone: body.phone || null,
    message: storedMessage(body.sites, body.message),
  });

  let notified: boolean | undefined;
  if (deps.notify) {
    try {
      await deps.notify({
        id: stored.id,
        clinicName: stored.clinicName,
        contactName: stored.contactName,
        email: stored.email,
        phone: stored.phone,
        sites: body.sites,
        message: body.message || null,
        createdAt: stored.createdAt,
      });
      notified = true;
    } catch {
      notified = false;
    }
  }
  return { kind: "stored", id: stored.id, sites: body.sites, notified };
}

/**
 * The client's address from the proxy headers. On Vercel `x-real-ip` and the first `x-forwarded-for`
 * entry are set by the platform; elsewhere they may be absent (then null: only the global cap applies).
 */
export function clientIpFrom(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

/**
 * Pseudonymous rate-limit key for an IP address: HMAC-SHA256 with a server secret when one is
 * configured, truncated. The address itself is never stored; the rows expire with the retention job.
 */
export function hashClientIp(ip: string, secret: string | undefined): string {
  return createHmac("sha256", secret && secret.length >= 16 ? secret : "clinforms:access-request:v1")
    .update(ip)
    .digest("hex")
    .slice(0, 32);
}
