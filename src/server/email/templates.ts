/**
 * Email templates (plain text + HTML). Neutral wording: what the product does, never the technology.
 * Every dynamic value is HTML-escaped. UK English, UK dates (Europe/London).
 */
import { COMPANY_NAME, roleLabel } from "../../lib/account-copy";
import { BRANDS, type BrandId } from "../../lib/brand";
import type { EmailMessage, EmailRecipient } from "./types";

/**
 * The brand an email speaks for (src/lib/brand.ts): ClinForms by default; "clinic" for a clinic with the clinic
 * package, whose links go to the clinic brand's host (src/server/auth/brand-links.ts). Only the product name changes.
 */
function productNameOf(brand: BrandId | undefined): string {
  return BRANDS[brand ?? "clinforms"].productName;
}

/** The message's `brand` field: set only for a brand other than ClinForms (ClinForms' messages are as before). */
function brandField(brand: BrandId | undefined): { brand?: BrandId } {
  return brand && brand !== "clinforms" ? { brand } : {};
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const UK_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "16 October 2026 at 14:05 (UK time)" */
export function ukDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return `${UK_DATE_TIME.format(date).replace(",", " at")} (UK time)`;
}

function layout(name: string, title: string, paragraphs: string[], action?: { label: string; href: string }, footnote?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join("");
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.href)}" style="display:inline-block;background:#0d9488;color:#ffffff;` +
      `text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(action.label)}</a></p>` +
      `<p style="margin:0 0 14px;line-height:1.5;font-size:13px;color:#475569">If the button does not work, copy this link into your browser:<br>` +
      `<span style="word-break:break-all">${escapeHtml(action.href)}</span></p>`
    : "";
  const note = footnote ? `<p style="margin:18px 0 0;font-size:13px;color:#475569;line-height:1.5">${footnote}</p>` : "";
  return (
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">` +
    `<div style="max-width:560px;margin:0 auto;padding:28px 20px">` +
    `<p style="margin:0 0 18px;font-weight:700;color:#0d9488;font-size:18px">${escapeHtml(name)}</p>` +
    `<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">${body}${button}${note}</div>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#64748b">${escapeHtml(name)} · ${escapeHtml(COMPANY_NAME)}</p>` +
    `</div></body></html>`
  );
}

function greeting(to: EmailRecipient): string {
  return to.name ? `Hello ${to.name},` : "Hello,";
}

export interface InvitationEmailInput {
  to: EmailRecipient;
  /** Default ClinForms. */
  brand?: BrandId;
  clinicName: string;
  role: string;
  /** Who sent it (absent when the clinic account was set up for you). */
  inviterName?: string | null;
  link: string;
  expiresAt: string;
}

export function invitationEmail(input: InvitationEmailInput): EmailMessage {
  const name = productNameOf(input.brand);
  const role = roleLabel(input.role);
  const who = input.inviterName ? `${input.inviterName} has invited you` : "You have been invited";
  const expires = ukDateTime(input.expiresAt);
  const subject = `Join ${input.clinicName} on ${name}`;
  const text = [
    greeting(input.to),
    "",
    `${who} to join ${input.clinicName} on ${name} as ${role}.`,
    "",
    "Open this link to create your account (you will choose a password and set up two-step verification):",
    input.link,
    "",
    `The link works once and expires on ${expires}.`,
    "If you were not expecting this invitation, you can ignore this email.",
    "",
    `${name} · ${COMPANY_NAME}`,
  ].join("\n");
  const html = layout(
    name,
    subject,
    [
      escapeHtml(greeting(input.to)),
      `${escapeHtml(who)} to join <strong>${escapeHtml(input.clinicName)}</strong> on ${escapeHtml(name)} as ` +
        `<strong>${escapeHtml(role)}</strong>.`,
      "Create your account with the button below. You will choose a password and set up two-step verification.",
    ],
    { label: "Accept the invitation", href: input.link },
    `The link works once and expires on ${escapeHtml(expires)}. If you were not expecting this invitation, you can ignore this email.`,
  );
  return { kind: "invitation", to: input.to, subject, text, html, link: input.link, linkExpiresAt: input.expiresAt, ...brandField(input.brand) };
}

export interface PasswordResetEmailInput {
  to: EmailRecipient;
  /** Default ClinForms. */
  brand?: BrandId;
  link: string;
  expiresAt: string;
}

export function passwordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  const name = productNameOf(input.brand);
  const expires = ukDateTime(input.expiresAt);
  const subject = `Reset your ${name} password`;
  const text = [
    greeting(input.to),
    "",
    `Someone asked to reset the password of your ${name} account. Open this link to choose a new password:`,
    input.link,
    "",
    `The link works once and expires on ${expires}. You will still need your authenticator app to sign in.`,
    "If you did not ask for this, you can ignore this email: your password has not changed.",
    "",
    `${name} · ${COMPANY_NAME}`,
  ].join("\n");
  const html = layout(
    name,
    subject,
    [
      escapeHtml(greeting(input.to)),
      `Someone asked to reset the password of your ${escapeHtml(name)} account. Choose a new password with the button below.`,
    ],
    { label: "Choose a new password", href: input.link },
    `The link works once and expires on ${escapeHtml(expires)}. You will still need your authenticator app to sign in. ` +
      "If you did not ask for this, you can ignore this email: your password has not changed.",
  );
  return { kind: "password_reset", to: input.to, subject, text, html, link: input.link, linkExpiresAt: input.expiresAt, ...brandField(input.brand) };
}

export interface TwoFactorEnabledEmailInput {
  to: EmailRecipient;
  /** Default ClinForms. */
  brand?: BrandId;
  at: string;
}

export function twoFactorEnabledEmail(input: TwoFactorEnabledEmailInput): EmailMessage {
  const name = productNameOf(input.brand);
  const when = ukDateTime(input.at);
  const subject = `Two-step verification is on for your ${name} account`;
  const text = [
    greeting(input.to),
    "",
    `Two-step verification was turned on for your ${name} account on ${when}.`,
    "From now on you will enter a code from your authenticator app each time you sign in.",
    "Keep your backup codes somewhere safe: each one signs you in once if you lose your phone.",
    "",
    "If this was not you, tell your clinic's owner or administrator straight away.",
    "",
    `${name} · ${COMPANY_NAME}`,
  ].join("\n");
  const html = layout(name, subject, [
    escapeHtml(greeting(input.to)),
    `Two-step verification was turned on for your ${escapeHtml(name)} account on ${escapeHtml(when)}.`,
    "From now on you will enter a code from your authenticator app each time you sign in. Keep your backup codes somewhere safe: each one signs you in once if you lose your phone.",
    "<strong>If this was not you</strong>, tell your clinic's owner or administrator straight away.",
  ]);
  return { kind: "two_factor_enabled", to: input.to, subject, text, html, ...brandField(input.brand) };
}

export type TextCreditNotice = { kind: "low"; balance: number; lowThreshold: number } | { kind: "zero" } | { kind: "topup_failed" };

export interface TextCreditNoticeEmailInput {
  to: EmailRecipient;
  /** Default ClinForms (a clinic with the clinic package: "clinic"). */
  brand?: BrandId;
  clinicName: string;
  notice: TextCreditNotice;
  /** The clinic's Text credits page. */
  creditsUrl: string;
}

/**
 * Text credits (the clinic system's prepaid texts): the warning at 20 % of the last pack, at zero, and when an
 * automatic top-up did not go through. To the clinic's owner and admins. No patient data; never the payment
 * provider's name.
 */
export function textCreditNoticeEmail(input: TextCreditNoticeEmailInput): EmailMessage {
  const name = productNameOf(input.brand);
  const n = input.notice;
  const subject =
    n.kind === "low" ? `Text credits running low – ${input.clinicName}` : n.kind === "zero" ? `Text credits used up – ${input.clinicName}` : `Automatic top-up did not go through – ${input.clinicName}`;
  const first =
    n.kind === "low"
      ? `${input.clinicName} has ${n.balance.toLocaleString("en-GB")} text ${n.balance === 1 ? "credit" : "credits"} left.`
      : n.kind === "zero"
        ? `${input.clinicName} has no text credits left.`
        : `The card payment for the automatic top-up of ${input.clinicName}'s text credits did not go through. Nothing was charged, and automatic top-up is paused.`;
  const second =
    n.kind === "topup_failed"
      ? "Check the saved card or buy a pack, then switch automatic top-up on again. Until then, automatic messages go by email where the patient has an email address and allows email; otherwise they are not sent."
      : "When credits run out, automatic messages go by email where the patient has an email address and allows email; otherwise they are not sent. Texts are never sent on credit.";
  const text = [greeting(input.to), "", first, "", second, "", "Buy more credits or change automatic top-up here:", input.creditsUrl, "", `${name} · ${COMPANY_NAME}`].join("\n");
  const html = layout(name, subject, [escapeHtml(greeting(input.to)), escapeHtml(first), escapeHtml(second)], { label: "Open text credits", href: input.creditsUrl });
  return { kind: "text_credit_notice", to: input.to, subject, text, html, ...brandField(input.brand) };
}

/* ------------------------------------------------------------------------------------------------
 * Payments and subscriptions (31/10/2026)
 * ----------------------------------------------------------------------------------------------*/

export interface PaymentAlertEmailInput {
  to: EmailRecipient;
  /** What happened, in a few plain words ("A paid checkout was refused"). */
  what: string;
  /** Ids and reason codes only (event, object, clinic id, why) – never card or patient details. */
  facts: Record<string, string | null>;
  platformUrl: string;
}

/** To ClinForms platform staff: a payment the system received but did not apply (to be checked by hand). */
export function paymentAlertEmail(input: PaymentAlertEmailInput): EmailMessage {
  const subject = `Payment needs checking – ${input.what}`;
  const lines = Object.entries(input.facts).map(([k, v]) => `${k}: ${v ?? "–"}`);
  const first = "A payment was received but not applied, because it did not match what the system expected. Nothing was credited or switched on.";
  const text = [greeting(input.to), "", first, "", ...lines, "", "Check it in the payment account and on the platform page:", input.platformUrl, "", `${PRODUCT_TEAM} · ${COMPANY_NAME}`].join("\n");
  const html = layout(PRODUCT_TEAM, subject, [escapeHtml(greeting(input.to)), escapeHtml(first), lines.map(escapeHtml).join("<br>")], { label: "Open the platform page", href: input.platformUrl });
  return { kind: "payment_alert", to: input.to, subject, text, html };
}

const PRODUCT_TEAM = "ClinForms platform";

export type BillingNotice =
  | { kind: "payment_failed"; graceUntil: string }
  | { kind: "read_only" }
  | { kind: "payment_received" }
  | { kind: "cancelled"; endsOn: string };

export interface BillingNoticeEmailInput {
  to: EmailRecipient;
  brand?: BrandId;
  clinicName: string;
  notice: BillingNotice;
  billingUrl: string;
}

/** To a clinic's owner and admins: the subscription's payment failed, the account is read-only, or it ends. */
export function billingNoticeEmail(input: BillingNoticeEmailInput): EmailMessage {
  const name = productNameOf(input.brand);
  const n = input.notice;
  const subject =
    n.kind === "payment_failed"
      ? `Payment for your plan did not go through – ${input.clinicName}`
      : n.kind === "read_only"
        ? `Your account is now read-only – ${input.clinicName}`
        : n.kind === "payment_received"
          ? `Payment received – ${input.clinicName}`
          : `Your plan has been cancelled – ${input.clinicName}`;
  const paragraphs =
    n.kind === "payment_failed"
      ? [
          `The latest payment for ${input.clinicName}'s ${name} plan did not go through.`,
          `Everything keeps working until ${n.graceUntil}. Please update the payment details before then, or the account becomes read-only: your records stay safe and can still be opened, but nothing new can be added until the payment is made.`,
        ]
      : n.kind === "read_only"
        ? [
            `The payment for ${input.clinicName}'s ${name} plan is still outstanding, so the account is now read-only.`,
            "Your records are safe and can still be opened and downloaded. Update the payment details to carry on as normal.",
          ]
        : n.kind === "payment_received"
          ? [`Thank you – the payment for ${input.clinicName}'s ${name} plan has been received and everything is working as normal.`]
          : [`${input.clinicName}'s ${name} plan has been cancelled. It stays fully available until ${n.endsOn}. Your records are kept – you can choose a plan again at any time.`];
  const text = [greeting(input.to), "", ...paragraphs.flatMap((p) => [p, ""]), "Plan and billing:", input.billingUrl, "", `${name} · ${COMPANY_NAME}`].join("\n");
  const html = layout(name, subject, [escapeHtml(greeting(input.to)), ...paragraphs.map(escapeHtml)], { label: "Open plan and billing", href: input.billingUrl });
  return { kind: "billing_notice", to: input.to, subject, text, html, ...brandField(input.brand) };
}
