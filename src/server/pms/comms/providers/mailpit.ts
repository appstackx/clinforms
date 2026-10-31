/**
 * The Mailpit provider – LOCAL TESTING ONLY. Hands the real message (sign-in links included) to a local Mailpit
 * inbox through its HTTP send API (MAILPIT_URL, default http://localhost:8026; see src/server/email/mailpit.ts for
 * the local-only rules) and reports it "sent", like the test provider. Nothing reaches a patient.
 *
 *   email – sent as it would be: the clinic's name as sender name, its reply-to, the List-Unsubscribe headers;
 *   sms   – (CLINIC_SMS_PROVIDER=mailpit) shown as a plain email to "<phone digits>@sms.local" (e.g.
 *           447700900123@sms.local), subject "Text message",
 *           so a developer can read texts in the same inbox. Nothing is texted.
 *
 * A message Mailpit does not accept counts as failed ("mailpit_unavailable").
 */
import { mailpitBaseUrl, mailpitRefusal, mailpitSend } from "../../../email/mailpit";
import { CommsConfigError, type EmailProvider, type SmsProvider } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

export const MAILPIT_PROVIDER_ID = "mailpit";
export const MAILPIT_EMAIL_FROM = "clinic@clinforms.local";
export const MAILPIT_SMS_FROM = "sms@clinforms.local";
export const MAILPIT_SMS_DOMAIN = "sms.local";
export const MAILPIT_SMS_SUBJECT = "Text message";

function baseFor(name: string, env: Env): URL {
  const refusal = mailpitRefusal(env);
  if (refusal) throw new CommsConfigError(`${name}=mailpit is refused: ${refusal}`);
  return mailpitBaseUrl(env) as URL;
}

export function mailpitEmailProvider(env: Env, fetchImpl?: typeof fetch): EmailProvider {
  const base = baseFor("CLINIC_EMAIL_PROVIDER", env);
  return {
    id: MAILPIT_PROVIDER_ID,
    mode: "mailpit",
    async send(message) {
      const result = await mailpitSend(
        base,
        {
          From: { Email: MAILPIT_EMAIL_FROM, Name: message.fromName },
          To: [{ Email: message.to }],
          ...(message.replyTo ? { ReplyTo: [{ Email: message.replyTo, Name: message.fromName }] } : {}),
          Subject: message.subject,
          Text: message.text,
          ...(message.html ? { HTML: message.html } : {}),
          Headers: { ...message.headers },
          Tags: ["clinic-system", "email"],
        },
        { fetchImpl },
      );
      return result.ok ? { status: "sent", providerMessageId: `mailpit_${result.id}`.slice(0, 80) } : { status: "failed", errorCode: "mailpit_unavailable" };
    },
  };
}

export function mailpitSmsProvider(env: Env, fetchImpl?: typeof fetch): SmsProvider {
  const base = baseFor("CLINIC_SMS_PROVIDER", env);
  return {
    id: MAILPIT_PROVIDER_ID,
    mode: "mailpit",
    async send(message) {
      const label = `(Local test: a text message to ${message.to}${message.from ? ` from "${message.from}"` : ""}, caught by Mailpit. Nothing was texted.)`;
      const result = await mailpitSend(
        base,
        {
          From: { Email: MAILPIT_SMS_FROM, Name: message.from ? `Text from ${message.from}` : "Text message" },
          // Digits only ("447700900123@sms.local"): Mailpit would read a leading "+" as a plus-address tag.
          To: [{ Email: `${message.to.replace(/\D/g, "")}@${MAILPIT_SMS_DOMAIN}` }],
          Subject: MAILPIT_SMS_SUBJECT,
          Text: `${label}\n\n${message.body}`,
          Tags: ["clinic-system", "sms"],
        },
        { fetchImpl },
      );
      return result.ok ? { status: "sent", providerMessageId: `mailpit_${result.id}`.slice(0, 80) } : { status: "failed", errorCode: "mailpit_unavailable" };
    },
  };
}
