/**
 * The branded HTML email layout (13/11/2026) shared by every email the app sends: invitations, password resets, the
 * sign-up link, billing and text-credit notices and the trial emails. Built for the mail clients clinics use – Gmail,
 * Outlook (desktop: Word's renderer), Apple Mail:
 *   - tables for layout, every style inline (no <style> block a client may strip), max-width 600 px with an Outlook
 *     "ghost table" so it does not stretch;
 *   - the brand as a TEXT wordmark (no image to block or load – no remote content at all), the brand's colours
 *     (ClinDesk: cream header, coral button; ClinForms: teal);
 *   - a bulletproof button (a padded table cell, not a background image) plus the plain link under it;
 *   - a hidden preheader line (the inbox preview), no tracking pixel, no web fonts.
 * Every dynamic value is escaped by the caller (paragraphs are HTML) or here (titles, labels, links).
 */
import { COMPANY_NAME } from "../../lib/account-copy";
import { BRANDS, CLINIC_SYSTEM_NAME, type BrandId } from "../../lib/brand";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface EmailTheme {
  /** The wordmark's text. */
  name: string;
  /** Header band behind the wordmark. */
  headerBg: string;
  /** Wordmark and button colour. */
  accent: string;
  /** Text on the button. */
  onAccent: string;
  /** A thin line under the header. */
  rule: string;
  /** The page behind the card. */
  pageBg: string;
  ink: string;
  muted: string;
  /** The brand's own website (footer). */
  siteUrl: string;
  /** "Questions? Reply to this email or write to …" (null: no line, e.g. platform staff alerts). */
  contactEmail: string | null;
}

export const EMAIL_THEMES: Readonly<Record<BrandId, EmailTheme>> = {
  clinic: {
    name: CLINIC_SYSTEM_NAME,
    headerBg: "#FBF4E8",
    accent: "#C4432B",
    onAccent: "#FFFFFF",
    rule: "#E6DAC6",
    pageBg: "#F4EFE6",
    ink: "#1A2723",
    muted: "#4C5954",
    siteUrl: BRANDS.clinic.siteUrl,
    contactEmail: BRANDS.clinic.contactEmail,
  },
  clinforms: {
    name: BRANDS.clinforms.productName,
    headerBg: "#F0FDFA",
    accent: "#0D9488",
    onAccent: "#FFFFFF",
    rule: "#CCFBF1",
    pageBg: "#F1F5F9",
    ink: "#0F172A",
    muted: "#475569",
    siteUrl: BRANDS.clinforms.siteUrl,
    contactEmail: BRANDS.clinforms.contactEmail,
  },
};

/** The theme for a sender name the older templates pass ("ClinDesk" → the clinic brand; anything else ClinForms'). */
export function themeForName(name: string): EmailTheme {
  if (name === EMAIL_THEMES.clinic.name) return EMAIL_THEMES.clinic;
  if (name === EMAIL_THEMES.clinforms.name) return EMAIL_THEMES.clinforms;
  // Platform staff alerts ("ClinForms platform"): ClinForms' colours, its own name, no contact line.
  return { ...EMAIL_THEMES.clinforms, name, contactEmail: null };
}

export interface BrandedEmailInput {
  theme: EmailTheme;
  /** <title> (the subject). */
  title: string;
  /** The inbox preview line (hidden in the body). */
  preheader?: string;
  /** A large heading at the top of the card (escaped here). */
  heading?: string;
  /** Body paragraphs – HTML, already escaped by the caller. */
  paragraphs: string[];
  /** A short list (HTML items, escaped by the caller) after the paragraphs. */
  list?: string[];
  /** Paragraphs after the list, before the button (HTML, escaped by the caller). */
  closing?: string[];
  action?: { label: string; href: string };
  /** Small print under the button (HTML, escaped by the caller). */
  footnote?: string;
  /** "Stop these tips" (non-essential emails only). */
  unsubscribe?: { label: string; href: string };
  /**
   * The footer's contact line and website link (the trial emails). The older transactional emails (invitation, reset,
   * sign-up link, notices) keep their footer as it was: the name and the company only.
   */
  contact?: boolean;
}

const FONT = "Arial, Helvetica, sans-serif";

export function brandedEmail(input: BrandedEmailInput): string {
  const t = input.theme;
  const p = (html: string) => `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${t.ink}">${html}</p>`;
  const heading = input.heading
    ? `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${t.ink}">${escapeHtml(input.heading)}</h1>`
    : "";
  const list = input.list?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${input.list
        .map(
          (item) =>
            `<tr><td valign="top" style="padding:0 10px 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${t.accent}">&#8226;</td>` +
            `<td style="padding:0 0 8px;font-family:${FONT};font-size:16px;line-height:24px;color:${t.ink}">${item}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr>` +
      `<td align="center" bgcolor="${t.accent}" style="border-radius:8px;background:${t.accent}">` +
      `<a href="${escapeHtml(input.action.href)}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:bold;color:${t.onAccent};text-decoration:none;border-radius:8px">${escapeHtml(input.action.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${t.muted}">If the button does not work, copy this link into your browser:<br>` +
      `<a href="${escapeHtml(input.action.href)}" style="color:${t.accent};word-break:break-all">${escapeHtml(input.action.href)}</a></p>`
    : "";
  const footnote = input.footnote ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${t.muted}">${input.footnote}</p>` : "";
  const contact = input.contact && t.contactEmail
    ? `Questions? Reply to this email or write to <a href="mailto:${escapeHtml(t.contactEmail)}" style="color:${t.muted}">${escapeHtml(t.contactEmail)}</a>.<br>`
    : "";
  const unsubscribe = input.unsubscribe
    ? `<br><a href="${escapeHtml(input.unsubscribe.href)}" style="color:${t.muted};text-decoration:underline">${escapeHtml(input.unsubscribe.label)}</a>`
    : "";
  const preheader = input.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(input.preheader)}</div>`
    : "";
  return (
    `<!doctype html><html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${t.pageBg};-webkit-text-size-adjust:100%">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.pageBg}" style="background:${t.pageBg}"><tr><td align="center" style="padding:24px 12px">` +
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${t.rule};border-radius:12px">` +
    `<tr><td bgcolor="${t.headerBg}" style="background:${t.headerBg};padding:20px 28px;border-bottom:3px solid ${t.accent};border-radius:12px 12px 0 0">` +
    `<span style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${t.accent};letter-spacing:-0.3px">${escapeHtml(t.name)}</span>` +
    `</td></tr>` +
    `<tr><td style="padding:28px 28px 20px">${heading}${input.paragraphs.map(p).join("")}${list}${(input.closing ?? []).map(p).join("")}${button}${footnote}</td></tr>` +
    `</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%"><tr>` +
    `<td style="padding:16px 28px;font-family:${FONT};font-size:12px;line-height:18px;color:${t.muted}">` +
    contact +
    `${escapeHtml(t.name)} · ${escapeHtml(COMPANY_NAME)}` +
    (input.contact ? ` · <a href="${escapeHtml(t.siteUrl)}" style="color:${t.muted}">${escapeHtml(t.siteUrl.replace(/^https:\/\//, ""))}</a>` : "") +
    unsubscribe +
    `</td></tr></table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`
  );
}
