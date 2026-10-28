/**
 * Writing a message: the merge values (patient, appointment, site, clinic) and the finished text, email or
 * letter. The template rules are pure (src/modules/pms/comms/merge-fields.ts); this file reads what they need.
 *
 * Emails get a footer with the clinic's name and number, why the patient gets them and – appointment, general and
 * marketing emails – the stop-emails link (and the List-Unsubscribe headers); billing emails and letters go without
 * it (they answer the patient's own account or are to a third party). Texts end "STOP to opt out" where the template
 * says {{optout.sms}}; marketing texts always do. Everything goes out under the CLINIC's name (texts: its short
 * sender name), never the product's.
 */
import { REPLY_INSTRUCTIONS, SMS_OPT_OUT } from "../../../modules/pms/comms/defaults";
import { renderTemplate, type MergeValues } from "../../../modules/pms/comms/merge-fields";
import { formatAppointmentDate, formatAppointmentDateShort, formatAppointmentDay, formatAppointmentTime, formatDuration } from "../../../modules/pms/comms/schedule";
import { normaliseSmsText, smsInfo } from "../../../modules/pms/comms/sms";
import { greetingName } from "../../../modules/pms/comms/consent";
import type { CommsSettings, MessageChannel, MessagePurpose, MessagingContact, TemplateKind } from "../../../modules/pms/comms/types";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import { getClinicProfile } from "../../repos/clinic-profile";
import type { DbContext } from "../../repos/context";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";

export interface ClinicContact {
  name: string;
  /** What texts start with: the SMS sender name, else the clinic's name. */
  shortName: string;
  phone: string | null;
  email: string | null;
  address: string[] | null;
  postcode: string | null;
}

/**
 * The clinic's name and contact details: its profile (Settings → Clinic), the message settings' phone and email
 * winning; without a profile, the clinic's account name.
 */
export async function clinicContact(ctx: DbContext, tenantId: string, settings: Pick<CommsSettings, "replyPhone" | "replyEmail"> & Partial<Pick<CommsSettings, "smsSender">>, fallbackName?: string): Promise<ClinicContact> {
  const profile = await getClinicProfile(ctx, tenantId);
  let name = profile?.displayName ?? fallbackName ?? null;
  if (!name) {
    const org = await ctx.db.selectFrom("organization").select("name").where("slug", "=", tenantId).executeTakeFirst();
    name = org?.name ?? tenantId;
  }
  return {
    name,
    shortName: settings.smsSender ?? name,
    phone: settings.replyPhone ?? profile?.phone ?? null,
    email: settings.replyEmail ?? profile?.email ?? null,
    address: profile?.address ?? null,
    postcode: profile?.postcode ?? null,
  };
}

export interface Directory {
  sites: Map<string, Site>;
  practitioners: Map<string, Practitioner>;
  services: Map<string, Service>;
}

/** The clinic's sites, practitioners and appointment types (inactive ones too: old appointments name them). */
export async function loadDirectory(ctx: DbContext, tenantId: string): Promise<Directory> {
  const [sites, practitioners, services] = await Promise.all([
    listSites(ctx, tenantId, { includeInactive: true }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
    listServices(ctx, tenantId, { includeInactive: true }),
  ]);
  return { sites: new Map(sites.map((s) => [s.id, s])), practitioners: new Map(practitioners.map((p) => [p.id, p])), services: new Map(services.map((s) => [s.id, s])) };
}

export function patientValues(contact: Pick<MessagingContact, "firstName" | "preferredName" | "lastName" | "title">): Record<string, string | null> {
  return { "patient.first_name": greetingName(contact), "patient.last_name": contact.lastName, "patient.title": contact.title };
}

export function clinicValues(clinic: ClinicContact): Record<string, string | null> {
  return {
    "clinic.name": clinic.name,
    "clinic.short_name": clinic.shortName,
    "clinic.phone": clinic.phone,
    "clinic.email": clinic.email,
    "clinic.address": [...(clinic.address ?? []), clinic.postcode].filter(Boolean).join("\n") || null,
  };
}

export interface AppointmentSnapshot {
  startsAt: string;
  endsAt: string | null;
  siteId: string | null;
  practitionerId: string | null;
  serviceId: string | null;
}

export function appointmentValues(a: AppointmentSnapshot, dir: Directory, clinic: ClinicContact): Record<string, string | null> {
  const site = a.siteId ? dir.sites.get(a.siteId) : undefined;
  const practitioner = a.practitionerId ? dir.practitioners.get(a.practitionerId) : undefined;
  const service = a.serviceId ? dir.services.get(a.serviceId) : undefined;
  return {
    "appointment.date": formatAppointmentDate(a.startsAt),
    "appointment.date_short": formatAppointmentDateShort(a.startsAt),
    "appointment.day": formatAppointmentDay(a.startsAt),
    "appointment.time": formatAppointmentTime(a.startsAt),
    "appointment.end_time": a.endsAt ? formatAppointmentTime(a.endsAt) : null,
    "appointment.duration": formatDuration(a.startsAt, a.endsAt) || null,
    "appointment.with": practitioner?.displayName ?? null,
    "appointment.type": service?.name ?? null,
    "site.name": site?.name ?? null,
    "site.address": site ? [...(site.address ?? []), site.postcode].filter(Boolean).join(", ") || null : null,
    // Patients call the site; the clinic's number when the site has none.
    "site.phone": site?.phone ?? clinic.phone,
  };
}

export interface ComposeInput {
  kind: TemplateKind;
  channel: MessageChannel;
  purpose: MessagePurpose;
  subject: string | null;
  body: string;
  values: MergeValues;
  settings: Pick<CommsSettings, "repliesEnabled">;
  clinic: ClinicContact;
  /** The stop-emails link (emails), or null when links cannot be signed. */
  stopUrl: string | null;
}

export interface Composed {
  subject: string | null;
  /** What is stored and sent as text (emails: with the footer). */
  text: string;
  html: string | null;
  segments: number | null;
  headers: Record<string, string>;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Kinds whose emails carry the stop-emails link (the rest answer the patient's own account or go to a third party). */
const STOP_LINK_KINDS: ReadonlySet<TemplateKind> = new Set<TemplateKind>(["confirmation", "reminder", "moved", "cancelled", "late_cancelled", "dna", "offer", "general", "marketing"]);

/** Why the patient gets an email (the footer). */
function whyLine(kind: TemplateKind, purpose: MessagePurpose): string {
  if (purpose === "marketing") return "You're getting this because you agreed to hear from us.";
  if (kind === "invoice" || kind === "receipt" || kind === "statement" || kind === "payment_link") return "You're getting this because of your account with us.";
  if (kind === "letter") return "This email carries a letter from the clinic.";
  if (kind === "portal_link") return "You're getting this because someone asked to sign in with this email address.";
  return "You're getting this because you booked an appointment.";
}

const CARD_LINE = /^(When|What|With|Where): (.+)$/;

/**
 * The HTML version of an email's text: paragraphs, the appointment card ("When: …" lines as a small table, design
 * round 3 "Booking confirmation email"), links made clickable, and the footer in small print.
 */
export function emailHtml(clinicName: string, body: string, footer: string, links: readonly string[] = []): string {
  const linkify = (escaped: string) => {
    let out = escaped;
    for (const url of links) out = out.split(escapeHtml(url)).join(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    return out;
  };
  const blocks: string[] = [];
  let card: string[] = [];
  const flushCard = () => {
    if (!card.length) return;
    blocks.push(`<table role="presentation" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:12px 0;border-collapse:separate">${card.join("")}</table>`);
    card = [];
  };
  for (const line of body.split("\n")) {
    const m = CARD_LINE.exec(line.trim());
    if (m) {
      card.push(`<tr><td style="color:#475569;padding:2px 24px 2px 0;vertical-align:top">${escapeHtml(m[1])}</td><td style="padding:2px 0">${linkify(escapeHtml(m[2]))}</td></tr>`);
      continue;
    }
    flushCard();
    blocks.push(line.trim() === "" ? "<br>" : `${linkify(escapeHtml(line))}<br>`);
  }
  flushCard();
  return `<!doctype html><html lang="en-GB"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a"><p style="font-weight:700;margin:0 0 12px">${escapeHtml(clinicName)}</p>${blocks.join("")}<hr style="border:0;border-top:1px solid #cbd5e1;margin:24px 0 12px"><p style="font-size:13px;color:#334155">${linkify(escapeHtml(footer)).split("\n").join("<br>")}</p></body></html>`;
}

/** The finished message from a template (or a typed text) and its merge values. */
export function composeMessage(input: ComposeInput): Composed {
  const replies = input.channel === "sms" && input.settings.repliesEnabled && (input.kind === "reminder" || input.kind === "confirmation" || input.kind === "moved") ? REPLY_INSTRUCTIONS : null;
  const stopUrl = input.channel === "email" && STOP_LINK_KINDS.has(input.kind) ? input.stopUrl : null;
  const values: MergeValues = {
    ...input.values,
    "reply.instructions": replies,
    "optout.sms": input.channel === "sms" ? SMS_OPT_OUT : null,
    "unsubscribe.link": stopUrl,
  };
  if (input.channel === "sms") {
    let text = normaliseSmsText(renderTemplate(input.body, values, { missing: "empty" }).text);
    if (input.purpose === "marketing" && !/\bSTOP\b/.test(text)) text = `${text} ${SMS_OPT_OUT}`;
    return { subject: null, text, html: null, segments: smsInfo(text).segments, headers: {} };
  }
  const subject = renderTemplate(input.subject ?? "", values, { missing: "empty" }).text.replace(/\s+/g, " ").trim() || input.clinic.name;
  const body = renderTemplate(input.body, values, { missing: "empty" }).text;
  const stopWords = input.purpose === "marketing" ? "Stop these emails" : "Stop reminder emails";
  const stopLine = stopUrl && !body.includes(stopUrl) ? `${stopWords}${input.purpose === "marketing" ? "" : " (booking confirmations will still be sent)"}: ${stopUrl}` : null;
  const footer = [[input.clinic.name, input.clinic.phone].filter(Boolean).join(" · "), whyLine(input.kind, input.purpose), stopLine].filter(Boolean).join("\n");
  const text = `${body}\n\n--\n${footer}`;
  const html = emailHtml(input.clinic.name, body, footer, [stopUrl, ...((input.values["billing.link"] as string | null | undefined) ? [input.values["billing.link"] as string] : [])].filter((u): u is string => Boolean(u)));
  const headers: Record<string, string> = stopUrl ? { "List-Unsubscribe": `<${stopUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
  return { subject, text, html, segments: null, headers };
}

/** An email's HTML from its stored text (a retry: the text already has its footer after "--"). */
export function htmlFromStoredText(clinicName: string, text: string): string {
  const cut = text.lastIndexOf("\n--\n");
  const body = cut >= 0 ? text.slice(0, cut) : text;
  const footer = cut >= 0 ? text.slice(cut + 4) : "";
  const urls = Array.from(text.matchAll(/https?:\/\/\S+/g)).map((m) => m[0]);
  return emailHtml(clinicName, body, footer, urls);
}
