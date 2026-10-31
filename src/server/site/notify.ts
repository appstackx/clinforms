/**
 * Notification email to the ClinForms team when a clinic requests access (MailerSend, the same provider
 * the owner's other apps use). Optional: without MAILERSEND_API_KEY (and MAILERSEND_FROM_EMAIL) nothing
 * is sent and the request is only stored – the platform admin sees it in the database.
 *
 * ClinDesk's demo requests (source "clindesk") can go to their own recipient and through ClinDesk's own MailerSend
 * account – see mailerSendSettingsFromEnv.
 *
 * Internal email (to us, not to the clinic). Never contains patient information: the form asks for none.
 */
import "server-only";
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { BRANDS } from "@/lib/brand";
import { COMPANY } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";
import { clinicMailAccount, EmailConfigError } from "@/server/email/providers";
import { logAuthEvent } from "@/server/email/log";
import type { NotificationPayload } from "./access-request";
import type { AccessRequestSource } from "./demo-request";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Removes line breaks and control characters (header-safe single line). */
function oneLine(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

export interface NotificationEmail {
  subject: string;
  text: string;
  html: string;
}

export function accessRequestEmail(request: NotificationPayload): NotificationEmail {
  const rows: Array<[string, string]> = [
    ["Clinic", request.clinicName],
    ["Name", request.contactName],
    ["Work email", request.email],
    ["Phone", request.phone ?? "–"],
    ["Number of sites", request.sites],
    ...(request.details ?? []).map(([k, v]) => [k, v] as [string, string]),
    ["Received", request.createdAt],
    ["Reference", request.id],
  ];
  const message = request.message ?? "";
  const product = request.product ?? PRODUCT.name;
  const kind = request.product ? "demo request" : "access request";
  const subject = `${product} ${kind}: ${oneLine(request.clinicName, 80)}`;
  const text = [
    `New ${product} ${kind}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${oneLine(v, 300)}`),
    "",
    "Message:",
    message || "–",
    "",
    "Reply to this email to answer the clinic directly.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:600px;margin:0 auto">
<h2 style="color:#0f766e;margin:0 0 12px">New ${escapeHtml(product)} ${kind}</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 8px;border:1px solid #e2e8f0;font-weight:bold;width:150px">${escapeHtml(k)}</td><td style="padding:6px 8px;border:1px solid #e2e8f0">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>
<h3 style="margin:16px 0 6px;font-size:15px">Message</h3>
<p style="white-space:pre-wrap;margin:0;padding:12px;background:#f8fafc;border-radius:8px;font-size:14px">${escapeHtml(message || "–")}</p>
<p style="margin-top:16px;color:#64748b;font-size:12px">Reply to this email to answer the clinic directly.</p>
</body></html>`;
  return { subject, text, html };
}

export interface MailerSendSettings {
  apiKey: string;
  fromEmail: string;
  to: string;
  /** Sender name; default PRODUCT.name (ClinForms). "ClinDesk" when sent through ClinDesk's own account. */
  fromName?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Recipient of ClinDesk's demo-request notifications; unset = CLINFORMS_ACCESS_REQUEST_TO (as before). */
export const CLINIC_ACCESS_REQUEST_TO_VAR = "CLINFORMS_ACCESS_REQUEST_TO_CLINIC";

/**
 * MailerSend settings from the environment for a request from `source`, or null when email is not configured.
 *
 *   clinforms (default) – unchanged: MAILERSEND_API_KEY + MAILERSEND_FROM_EMAIL as ClinForms, to
 *                         CLINFORMS_ACCESS_REQUEST_TO (default COMPANY.contactEmail).
 *   clindesk            – to CLINFORMS_ACCESS_REQUEST_TO_CLINIC (unset: as ClinForms). Sent through ClinDesk's own
 *                         MailerSend account as "ClinDesk" when both MAILERSEND_API_KEY_CLINIC and
 *                         MAILERSEND_FROM_EMAIL_CLINIC are set (clinicMailAccount); otherwise through ClinForms'
 *                         account as before. A malformed clinic sender address falls back to ClinForms' account (one
 *                         `email.not_configured` line; never a key or an address).
 */
export function mailerSendSettingsFromEnv(env: Env = process.env, source: AccessRequestSource = "clinforms"): MailerSendSettings | null {
  const defaultTo = env.CLINFORMS_ACCESS_REQUEST_TO?.trim() || COMPANY.contactEmail;
  const apiKey = env.MAILERSEND_API_KEY?.trim();
  const fromEmail = env.MAILERSEND_FROM_EMAIL?.trim();
  const clinforms: MailerSendSettings | null = apiKey && fromEmail ? { apiKey, fromEmail, to: defaultTo } : null;
  if (source !== "clindesk") return clinforms;

  const to = env[CLINIC_ACCESS_REQUEST_TO_VAR]?.trim() || defaultTo;
  let account: ReturnType<typeof clinicMailAccount> = null;
  try {
    account = clinicMailAccount(null, env);
  } catch (err) {
    if (!(err instanceof EmailConfigError)) throw err;
    logAuthEvent("email.not_configured", { kind: "access_request_notification", using: "clinforms" });
  }
  if (account) return { apiKey: account.apiKey, fromEmail: account.sender.email, fromName: BRANDS.clinic.productName, to };
  return clinforms && { ...clinforms, to };
}

/** Sends the access-request notification (throws on failure; the caller keeps the stored request). */
export async function sendAccessRequestNotification(
  settings: MailerSendSettings,
  request: NotificationPayload,
  client?: Pick<MailerSend, "email">,
): Promise<void> {
  const email = accessRequestEmail(request);
  const params = new EmailParams()
    .setFrom(new Sender(settings.fromEmail, settings.fromName ?? PRODUCT.name))
    .setTo([new Recipient(settings.to, `${request.product ?? PRODUCT.name} team`)])
    .setReplyTo(new Recipient(request.email, oneLine(request.contactName, 100)))
    .setSubject(email.subject)
    .setText(email.text)
    .setHtml(email.html)
    // Security fix 24/10/2026 (D1): no click, open or content tracking (the message holds the requester's details).
    .setSettings({ track_clicks: false, track_opens: false, track_content: false });
  const mailer = client ?? new MailerSend({ apiKey: settings.apiKey });
  const response = await mailer.email.send(params);
  if (response.statusCode >= 300) throw new Error(`MailerSend answered ${response.statusCode}`);
}
