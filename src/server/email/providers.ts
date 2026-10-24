/**
 * Email providers:
 *   mailersend – MailerSend API (MAILERSEND_API_KEY, MAILERSEND_FROM_EMAIL), the same service as the owner's
 *                other apps; optional CLINFORMS_EMAIL_REPLY_TO = where replies go (one address, checked);
 *   log        – development: the message is printed to the server console (never on a Vercel deployment);
 *   none       – nothing is sent (the default until a MailerSend key exists). Invitation and reset links are
 *                then shown to the clinic administrator who asked for them, to pass on.
 */
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { logAuthEvent } from "./log";
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
  throw new EmailConfigError(`CLINFORMS_EMAIL_PROVIDER must be mailersend, log or none (got "${raw}").`);
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

export function mailerSendProvider(env: Env = process.env, client?: Pick<MailerSend, "email">): EmailProvider {
  const apiKey = env.MAILERSEND_API_KEY;
  const from = env.MAILERSEND_FROM_EMAIL || env.CLINFORMS_EMAIL_FROM;
  if (!client && !apiKey) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_API_KEY.");
  if (!from) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_FROM_EMAIL.");
  const replyTo = replyToAddress(env);
  const mailer = client ?? new MailerSend({ apiKey: apiKey as string });
  return {
    name: "mailersend",
    async send(message: EmailMessage): Promise<DeliveryResult> {
      const params = new EmailParams()
        .setFrom(new Sender(from, SENDER_NAME))
        .setTo([new Recipient(message.to.email, message.to.name ?? undefined)])
        .setSubject(message.subject)
        .setHtml(message.html)
        .setText(message.text);
      if (replyTo) params.setReplyTo(new Recipient(replyTo, SENDER_NAME));
      try {
        await mailer.email.send(params);
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

export function createEmailProvider(env: Env = process.env): EmailProvider {
  const name = resolveEmailProviderName(env);
  if (name === "mailersend") return mailerSendProvider(env);
  if (name === "log") return logProviderFor(env);
  return noneProvider;
}
