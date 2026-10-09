/**
 * Email providers:
 *   mailersend – MailerSend API (MAILERSEND_API_KEY, MAILERSEND_FROM_EMAIL), the same service as the owner's
 *                other apps;
 *   log        – development: the message is printed to the server console (never on a production deployment);
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

/** CLINFORMS_EMAIL_PROVIDER = mailersend | log | none (default none). `log` is refused on production. */
export function resolveEmailProviderName(env: Env = process.env): EmailProviderName {
  const raw = (env.CLINFORMS_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return "none";
  if (raw === "mailersend") return "mailersend";
  if (raw === "log") return env.VERCEL_ENV === "production" ? "none" : "log";
  throw new EmailConfigError(`CLINFORMS_EMAIL_PROVIDER must be mailersend, log or none (got "${raw}").`);
}

export function mailerSendProvider(env: Env = process.env, client?: Pick<MailerSend, "email">): EmailProvider {
  const apiKey = env.MAILERSEND_API_KEY;
  const from = env.MAILERSEND_FROM_EMAIL || env.CLINFORMS_EMAIL_FROM;
  if (!client && !apiKey) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_API_KEY.");
  if (!from) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_FROM_EMAIL.");
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

export const logProvider: EmailProvider = {
  name: "log",
  async send(message) {
    // Development only (resolveEmailProviderName never picks it on production): print the whole message so a
    // developer can follow the link.
    console.info(`\n[email:log] to=${message.to.email} subject="${message.subject}"\n${message.text}\n`);
    return { status: "sent", provider: "log" };
  },
};

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
  if (name === "log") return logProvider;
  return noneProvider;
}
