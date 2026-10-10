/**
 * Notification email to the ClinForms team when a clinic requests access (MailerSend, the same provider
 * the owner's other apps use). Optional: without MAILERSEND_API_KEY (and MAILERSEND_FROM_EMAIL) nothing
 * is sent and the request is only stored – the platform admin sees it in the database.
 *
 * Internal email (to us, not to the clinic). Never contains patient information: the form asks for none.
 */
import "server-only";
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { COMPANY } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";
import type { NotificationPayload } from "./access-request";

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
    ["Received", request.createdAt],
    ["Reference", request.id],
  ];
  const message = request.message ?? "";
  const subject = `${PRODUCT.name} access request: ${oneLine(request.clinicName, 80)}`;
  const text = [
    `New ${PRODUCT.name} access request`,
    "",
    ...rows.map(([k, v]) => `${k}: ${oneLine(v, 300)}`),
    "",
    "Message:",
    message || "–",
    "",
    "Reply to this email to answer the clinic directly.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:600px;margin:0 auto">
<h2 style="color:#0f766e;margin:0 0 12px">New ${escapeHtml(PRODUCT.name)} access request</h2>
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
}

/** MailerSend settings from the environment, or null when email is not configured. */
export function mailerSendSettingsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): MailerSendSettings | null {
  const apiKey = env.MAILERSEND_API_KEY?.trim();
  const fromEmail = env.MAILERSEND_FROM_EMAIL?.trim();
  if (!apiKey || !fromEmail) return null;
  return { apiKey, fromEmail, to: env.CLINFORMS_ACCESS_REQUEST_TO?.trim() || COMPANY.contactEmail };
}

/** Sends the access-request notification (throws on failure; the caller keeps the stored request). */
export async function sendAccessRequestNotification(settings: MailerSendSettings, request: NotificationPayload): Promise<void> {
  const email = accessRequestEmail(request);
  const params = new EmailParams()
    .setFrom(new Sender(settings.fromEmail, PRODUCT.name))
    .setTo([new Recipient(settings.to, `${PRODUCT.name} team`)])
    .setReplyTo(new Recipient(request.email, oneLine(request.contactName, 100)))
    .setSubject(email.subject)
    .setText(email.text)
    .setHtml(email.html);
  const mailer = new MailerSend({ apiKey: settings.apiKey });
  const response = await mailer.email.send(params);
  if (response.statusCode >= 300) throw new Error(`MailerSend answered ${response.statusCode}`);
}
