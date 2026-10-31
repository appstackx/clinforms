/**
 * Email providers:
 *   mailersend – MailerSend API (MAILERSEND_API_KEY, MAILERSEND_FROM_EMAIL), the same service as the owner's
 *                other apps; optional CLINFORMS_EMAIL_REPLY_TO = where replies go (one address, checked). The clinic
 *                brand (ClinDesk) can send through its OWN MailerSend account (clinicMailAccount below);
 *   log        – development: the message is printed to the server console (never on a Vercel deployment);
 *   none       – nothing is sent (the default until a MailerSend key exists). Invitation and reset links are
 *                then shown to the clinic administrator who asked for them, to pass on;
 *   mailpit    – LOCAL TESTING ONLY: the message goes to a local Mailpit inbox (MAILPIT_URL, default
 *                http://localhost:8026) through its HTTP send API. Refused (treated as none) on any Vercel environment,
 *                and with NODE_ENV=production unless MAILPIT_URL is localhost / 127.0.0.1 (see ./mailpit.ts).
 */
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { BRANDS } from "../../lib/brand";
import { logAuthEvent } from "./log";
import { mailpitBaseUrl, mailpitRefusal, mailpitSend } from "./mailpit";
import type { DeliveryResult, EmailMessage, EmailProvider, EmailProviderName } from "./types";

export const SENDER_NAME = "ClinForms";

/**
 * Sender per brand (31/10/2026). The clinic brand's messages (a clinic with the clinic package) can go through the
 * clinic brand's own MailerSend account – a SEPARATE account from ClinForms' – with its own API key, sender address
 * (verified in that account) and reply-to, as the clinic brand's product name ("ClinDesk"). MailerSend (production)
 * switches ONLY when both MAILERSEND_API_KEY_CLINIC and MAILERSEND_FROM_EMAIL_CLINIC are set; with one of them only,
 * nothing half-switches (the clinic brand's messages go as ClinForms' do, and that is logged once per process – the
 * variable's name, never its value). Neither set (the default): every message, whatever its brand, goes as before –
 * SENDER_NAME at MAILERSEND_FROM_EMAIL (or CLINFORMS_EMAIL_FROM) through MAILERSEND_API_KEY. ClinForms' messages never
 * use the clinic brand's settings.
 * Mailpit (local testing only, no account) follows MAILERSEND_FROM_EMAIL_CLINIC alone (senderFor).
 */
export const CLINIC_BRAND_FROM_VAR = "MAILERSEND_FROM_EMAIL_CLINIC";
export const CLINIC_BRAND_KEY_VAR = "MAILERSEND_API_KEY_CLINIC";
/** Where replies to the clinic brand's messages go; unset = CLINFORMS_EMAIL_REPLY_TO (as before), if set. */
export const CLINIC_BRAND_REPLY_TO_VAR = "CLINFORMS_EMAIL_REPLY_TO_CLINIC";

export interface SenderIdentity {
  email: string;
  name: string;
}

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

/** One plain address from `name`, or null when unset; anything else is a configuration error (the value is not echoed). */
function addressVar(env: Env, name: string, example: string): string | null {
  const raw = (env[name] ?? "").trim();
  if (!raw) return null;
  if (raw.length > 254 || !EMAIL_ADDRESS.test(raw)) throw new EmailConfigError(`${name} must be a single email address, such as ${example}.`);
  return raw;
}

/** The clinic brand's own sender (MAILERSEND_FROM_EMAIL_CLINIC as the clinic brand's name), or null when unset. */
function clinicSender(env: Env): SenderIdentity | null {
  const email = addressVar(env, CLINIC_BRAND_FROM_VAR, "no-reply@example.com");
  return email ? { email, name: BRANDS.clinic.productName } : null;
}

/**
 * Who a message comes from when there is no separate account (Mailpit): the clinic brand's own sender when the
 * message is the clinic brand's and MAILERSEND_FROM_EMAIL_CLINIC is set, else `fallbackFrom` as SENDER_NAME (the sender
 * before brands existed). A malformed MAILERSEND_FROM_EMAIL_CLINIC is a configuration error (the value is not echoed).
 */
export function senderFor(message: Pick<EmailMessage, "brand">, fallbackFrom: string, env: Env = process.env): SenderIdentity {
  return (message.brand === "clinic" ? clinicSender(env) : null) ?? { email: fallbackFrom, name: SENDER_NAME };
}

/**
 * CLINFORMS_EMAIL_REPLY_TO: where a reply to any ClinForms email goes (e.g. the support address), or null when unset.
 * One plain address only (no name, no list); anything else is a configuration error (the value is not echoed).
 */
export function replyToAddress(env: Env = process.env): string | null {
  return addressVar(env, "CLINFORMS_EMAIL_REPLY_TO", "help@example.com");
}

/** The clinic brand's reply-to: CLINFORMS_EMAIL_REPLY_TO_CLINIC, else `fallback` (CLINFORMS_EMAIL_REPLY_TO). */
export function clinicReplyToAddress(fallback: string | null, env: Env = process.env): string | null {
  return addressVar(env, CLINIC_BRAND_REPLY_TO_VAR, "hello@example.com") ?? fallback;
}

/** The clinic brand's own MailerSend account: API key, sender and reply-to. */
export interface ClinicMailAccount {
  apiKey: string;
  sender: SenderIdentity;
  replyTo: string | null;
}

let incompleteClinicAccountLogged = false;

/** TESTS ONLY: let the "clinic account incomplete" line be logged again. */
export function resetClinicAccountLogForTests(): void {
  incompleteClinicAccountLogged = false;
}

/**
 * The clinic brand's own MailerSend account, or null: the clinic brand's messages then go through ClinForms' account
 * as ClinForms' do. Needs BOTH MAILERSEND_API_KEY_CLINIC and MAILERSEND_FROM_EMAIL_CLINIC; one without the other is
 * not a half-switch – null, logged once per process (the missing variable's name only; the key is never logged or
 * echoed). With both set, a malformed sender or reply-to address is a configuration error (the clinic brand's sends
 * then fail; ClinForms' are not affected).
 */
export function clinicMailAccount(fallbackReplyTo: string | null, env: Env = process.env): ClinicMailAccount | null {
  const apiKey = (env[CLINIC_BRAND_KEY_VAR] ?? "").trim();
  const hasFrom = (env[CLINIC_BRAND_FROM_VAR] ?? "").trim() !== "";
  if (!apiKey || !hasFrom) {
    if ((apiKey || hasFrom) && !incompleteClinicAccountLogged) {
      incompleteClinicAccountLogged = true;
      logAuthEvent("email.clinic_account_incomplete", { missing: apiKey ? CLINIC_BRAND_FROM_VAR : CLINIC_BRAND_KEY_VAR, using: "clinforms" });
    }
    return null;
  }
  return { apiKey, sender: clinicSender(env) as SenderIdentity, replyTo: clinicReplyToAddress(fallbackReplyTo, env) };
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
  /** TESTS: the client for the clinic brand's own account (default: a MailerSend client with MAILERSEND_API_KEY_CLINIC). */
  clinicClient?: Pick<MailerSend, "email">;
}

type MailRoute = { mailer: Pick<MailerSend, "email">; sender: SenderIdentity; replyTo: string | null };

export function mailerSendProvider(env: Env = process.env, client?: Pick<MailerSend, "email">, options: MailerSendOptions = {}): EmailProvider {
  const apiKey = env.MAILERSEND_API_KEY;
  const from = env.MAILERSEND_FROM_EMAIL || env.CLINFORMS_EMAIL_FROM;
  if (!client && !apiKey) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_API_KEY.");
  if (!from) throw new EmailConfigError("CLINFORMS_EMAIL_PROVIDER=mailersend needs MAILERSEND_FROM_EMAIL.");
  const replyTo = replyToAddress(env);
  const mailer = client ?? new MailerSend({ apiKey: apiKey as string });
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  const skipReserved = options.skipReservedAddresses ?? !client;
  const clinforms: MailRoute = { mailer, sender: { email: from, name: SENDER_NAME }, replyTo };
  // The clinic brand's route: its own account, or ClinForms' (null), or a configuration error (only its sends fail).
  let clinic: MailRoute | null | EmailConfigError;
  try {
    const account = clinicMailAccount(replyTo, env);
    clinic = account && { mailer: options.clinicClient ?? new MailerSend({ apiKey: account.apiKey }), sender: account.sender, replyTo: account.replyTo };
  } catch (err) {
    if (!(err instanceof EmailConfigError)) throw err;
    clinic = err;
  }
  return {
    name: "mailersend",
    async send(message: EmailMessage): Promise<DeliveryResult> {
      if (skipReserved && reservedTestAddress(message.to.email)) {
        logAuthEvent("email.failed", { provider: "mailersend", kind: message.kind, status: null, reason: "reserved_address" });
        return { status: "failed", provider: "mailersend" };
      }
      const route = message.brand === "clinic" ? (clinic ?? clinforms) : clinforms;
      if (route instanceof EmailConfigError) {
        logAuthEvent("email.not_configured", { kind: message.kind });
        return { status: "failed", provider: "mailersend" };
      }
      const { sender } = route;
      const params = new EmailParams()
        .setFrom(new Sender(sender.email, sender.name))
        .setTo([new Recipient(message.to.email, message.to.name ?? undefined)])
        .setSubject(message.subject)
        .setHtml(message.html)
        .setText(message.text)
        .setSettings({ ...NO_TRACKING });
      if (route.replyTo) params.setReplyTo(new Recipient(route.replyTo, sender.name));
      try {
        await withTimeout(route.mailer.email.send(params), timeoutMs);
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
  const defaultReplyTo = replyToAddress(env);
  return {
    name: "mailpit",
    async send(message) {
      let sender: SenderIdentity;
      let replyTo = defaultReplyTo;
      try {
        const own = message.brand === "clinic" ? clinicSender(env) : null;
        sender = own ?? { email: from, name: SENDER_NAME };
        if (own) replyTo = clinicReplyToAddress(defaultReplyTo, env);
      } catch (err) {
        if (!(err instanceof EmailConfigError)) throw err;
        logAuthEvent("email.not_configured", { kind: message.kind });
        return { status: "failed", provider: "mailpit" };
      }
      const result = await mailpitSend(
        base,
        {
          From: { Email: sender.email, Name: sender.name },
          To: [{ Email: message.to.email, ...(message.to.name ? { Name: message.to.name } : {}) }],
          ...(replyTo ? { ReplyTo: [{ Email: replyTo, Name: sender.name }] } : {}),
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
