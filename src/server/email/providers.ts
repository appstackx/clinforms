/**
 * Email providers:
 *   mailersend – MailerSend API (MAILERSEND_API_KEY, MAILERSEND_FROM_EMAIL), the same service as the owner's
 *                other apps; optional CLINFORMS_EMAIL_REPLY_TO = where replies go (one address, checked);
 *   log        – development: the message is printed to the server console (never on a Vercel deployment);
 *   none       – nothing is sent (the default until a MailerSend key exists). Invitation and reset links are
 *                then shown to the clinic administrator who asked for them, to pass on;
 *   mailpit    – LOCAL TESTING ONLY: the message goes to a local Mailpit inbox (MAILPIT_URL, default
 *                http://localhost:8026) through its HTTP send API. Refused (treated as none) on any Vercel environment,
 *                and with NODE_ENV=production unless MAILPIT_URL is localhost / 127.0.0.1 (see ./mailpit.ts).
 */
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { logAuthEvent } from "./log";
import { mailpitBaseUrl, mailpitRefusal, mailpitSend } from "./mailpit";
import type { DeliveryResult, EmailMessage, EmailProvider, EmailProviderName } from "./types";

export const SENDER_NAME = "ClinForms";

export class EmailConfigError extends Error {
  readonly code = "EMAIL_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether this process runs on a Vercel deployment (production or preview), where `log` would put links in the logs.
 * (`vercel env pull` writes VERCEL_ENV=development for local runs: that is not a deployment.)
 */
function onVercelDeployment(env: Env): boolean {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/**
 * CLINFORMS_EMAIL_PROVIDER = mailersend | log | none (default none). `log` is refused (treated as none) on every Vercel
 * deployment: it prints whole messages, links included, and deployment logs must never hold a link.
 */
export function resolveEmailProviderName(env: Env = process.env): EmailProviderName {
  const raw = (env.CLINFORMS_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return "none";
  if (raw === "mailersend") return "mailersend";
  if (raw === "log") return onVercelDeployment(env) ? "none" : "log";
  // Local testing only: refused (treated as none) on any Vercel environment and on a non-local production run.
  if (raw === "mailpit") return mailpitRefusal(env) ? "none" : "mailpit";
  throw new EmailConfigError(`CLINFORMS_EMAIL_PROVIDER must be mailersend, log or none (or mailpit, local only) (got "${raw}").`);
}

const EMAIL_ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * CLINFORMS_EMAIL_REPLY_TO: where a reply to any ClinForms email goes (e.g. the support address), or null when unset.
 * One plain address only (no name, no list); anything else is a configuration error (the value is not echoed).
 */
export function replyToAddress(env: Env = process.env): string | null {
  const raw = (env.CLINFORMS_EMAIL_REPLY_TO ?? "").trim();
  if (!raw) return null;
  if (raw.length > 254 || !EMAIL_ADDRESS.test(raw)) {
    throw new EmailConfigError("CLINFORMS_EMAIL_REPLY_TO must be a single email address, such as help@example.com.");
  }
  return raw;
}

/**
 * Security fix 24/10/2026 (D1): every message switches MailerSend's click, open and content tracking off. Invitation and
 * reset emails carry live one-time links: click tracking would rewrite them through MailerSend's redirector, and
 * content tracking would keep the whole message (link included) in the account's activity view.
 */
export const NO_TRACKING = Object.freeze({ track_clicks: false, track_opens: false, track_content: false });

/** How long a send may take before it counts as failed (security fix 24/10, D7): the link is then shown to pass on. */
export const SEND_TIMEOUT_MS = 8000;

/**
 * Addresses that can never receive mail (RFC 2606 / 6761 reserved names: example domains, .test, .invalid, .localhost) –
 * a real send to one only bounces and hurts the sending domain's reputation (L4, 24/10).
 */
export function reservedTestAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return /\.(?:invalid|test|example|localhost)$/.test(a) || /@(?:[^@]+\.)?example\.(?:com|net|org)$/.test(a);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("MailerSend did not answer in time."), { statusCode: 0 })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface MailerSendOptions {
  /** Default SEND_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Refuse reserved test addresses without calling MailerSend. Default: on, except with an injected (test) client. */
  skipReservedAddresses?: boolean;
}

export function mailerSendProvider(env: Env = process.env, client?: Pick<MailerSend, "email">, options: MailerSendOptions = {}): EmailProvider {
  const apiKey = env.MAILERSEND_API_KEY;
  const from = env.MAILERSEND_FROM_EMAIL || env.CLINFORMS_EMAIL_FROM;
  if (!client && !apiKey) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_API_KEY.");
  if (!from) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_FROM_EMAIL.");
  const replyTo = replyToAddress(env);
  const mailer = client ?? new MailerSend({ apiKey: apiKey as string });
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  const skipReserved = options.skipReservedAddresses ?? !client;
  return {
    name: "mailersend",
    async send(message: EmailMessage): Promise<DeliveryResult> {
      if (skipReserved && reservedTestAddress(message.to.email)) {
        logAuthEvent("email.failed", { provider: "mailersend", kind: message.kind, status: null, reason: "reserved_address" });
        return { status: "failed", provider: "mailersend" };
      }
      const params = new EmailParams()
        .setFrom(new Sender(from, SENDER_NAME))
        .setTo([new Recipient(message.to.email, message.to.name ?? undefined)])
        .setSubject(message.subject)
        .setHtml(message.html)
        .setText(message.text)
        .setSettings({ ...NO_TRACKING });
      if (replyTo) params.setReplyTo(new Recipient(replyTo, SENDER_NAME));
      try {
        await withTimeout(mailer.email.send(params), timeoutMs);
        logAuthEvent("email.sent", { provider: "mailersend", kind: message.kind });
        return { status: "sent", provider: "mailersend" };
      } catch (err) {
        const status = (err as { statusCode?: unknown })?.statusCode;
        logAuthEvent("email.failed", { provider: "mailersend", kind: message.kind, status: typeof status === "number" ? status : null });
        return { status: "failed", provider: "mailersend" };
      }
    },
  };
}

/** Development only (resolveEmailProviderName never picks it on a Vercel deployment). */
export function logProviderFor(env: Env = process.env): EmailProvider {
  const replyTo = replyToAddress(env);
  return {
    name: "log",
    async send(message) {
      // Print the whole message so a developer can follow the link.
      console.info(`\n[email:log] to=${message.to.email}${replyTo ? ` reply-to=${replyTo}` : ""} subject="${message.subject}"\n${message.text}\n`);
      return { status: "sent", provider: "log" };
    },
  };
}

export const logProvider: EmailProvider = logProviderFor({});

export const noneProvider: EmailProvider = {
  name: "none",
  async send(message) {
    logAuthEvent("email.not_sent", { provider: "none", kind: message.kind });
    return { status: "not_sent", provider: "none" };
  },
};

/** Local Mailpit sender address when no MailerSend sender is configured. */
export const MAILPIT_DEFAULT_FROM = "no-reply@clinforms.local";

/**
 * LOCAL TESTING ONLY (resolveEmailProviderName never picks it on Vercel or a non-local production run; this function
 * refuses too, so it cannot be built by mistake). The whole message, link included, goes to the local Mailpit inbox.
 */
export function mailpitProviderFor(env: Env = process.env, fetchImpl?: typeof fetch): EmailProvider {
  const refusal = mailpitRefusal(env);
  if (refusal) throw new EmailConfigError(`CLINFORMS_EMAIL_PROVIDER=mailpit: ${refusal}`);
  const base = mailpitBaseUrl(env) as URL;
  const from = env.MAILERSEND_FROM_EMAIL || env.CLINFORMS_EMAIL_FROM || MAILPIT_DEFAULT_FROM;
  const replyTo = replyToAddress(env);
  return {
    name: "mailpit",
    async send(message) {
      const result = await mailpitSend(
        base,
        {
          From: { Email: from, Name: SENDER_NAME },
          To: [{ Email: message.to.email, ...(message.to.name ? { Name: message.to.name } : {}) }],
          ...(replyTo ? { ReplyTo: [{ Email: replyTo, Name: SENDER_NAME }] } : {}),
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
          Tags: ["clinforms", message.kind],
        },
        { fetchImpl },
      );
      if (result.ok) {
        logAuthEvent("email.sent", { provider: "mailpit", kind: message.kind });
        return { status: "sent", provider: "mailpit" };
      }
      logAuthEvent("email.failed", { provider: "mailpit", kind: message.kind, status: result.status });
      return { status: "failed", provider: "mailpit" };
    },
  };
}

export function createEmailProvider(env: Env = process.env): EmailProvider {
  const name = resolveEmailProviderName(env);
  if (name === "mailersend") return mailerSendProvider(env);
  if (name === "log") return logProviderFor(env);
  if (name === "mailpit") return mailpitProviderFor(env);
  return noneProvider;
}
