/**
 * Writing a message: the merge values (patient, appointment, site, clinic) and the finished text, email or
 * letter. The template rules are pure (src/modules/pms/comms/merge-fields.ts); this file reads what they need.
 *
 * Emails get a footer with the clinic's name and number and the stop-emails link (and the List-Unsubscribe
 * headers); marketing texts get "Reply STOP to opt out." when the template does not say it already.
 */
import { REPLY_INSTRUCTIONS, SMS_OPT_OUT } from "../../../modules/pms/comms/defaults";
import { renderTemplate, type MergeValues } from "../../../modules/pms/comms/merge-fields";
import { formatAppointmentDate, formatAppointmentDateShort, formatAppointmentTime, formatDuration } from "../../../modules/pms/comms/schedule";
import { normaliseSmsText, smsInfo } from "../../../modules/pms/comms/sms";
import { greetingName } from "../../../modules/pms/comms/consent";
import type { CommsSettings, MessageChannel, MessagePurpose, MessagingContact, TemplateKind } from "../../../modules/pms/comms/types";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import { getClinicProfile } from "../../repos/clinic-profile";
import type { DbContext } from "../../repos/context";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";

export interface ClinicContact {
  name: string;
  phone: string | null;
  email: string | null;
  address: string[] | null;
  postcode: string | null;
}

/**
 * The clinic's name and contact details: its profile (Settings → Clinic), the message settings' phone and email
 * winning; without a profile, the clinic's account name.
 */
export async function clinicContact(ctx: DbContext, tenantId: string, settings: Pick<CommsSettings, "replyPhone" | "replyEmail">, fallbackName?: string): Promise<ClinicContact> {
  const profile = await getClinicProfile(ctx, tenantId);
  let name = profile?.displayName ?? fallbackName ?? null;
  if (!name) {
    const org = await ctx.db.selectFrom("organization").select("name").where("slug", "=", tenantId).executeTakeFirst();
    name = org?.name ?? tenantId;
  }
  return {
    name,
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

/** The finished message from a template (or a typed text) and its merge values. */
export function composeMessage(input: ComposeInput): Composed {
  const replies = input.channel === "sms" && input.settings.repliesEnabled && (input.kind === "reminder" || input.kind === "confirmation" || input.kind === "moved") ? REPLY_INSTRUCTIONS : null;
  const values: MergeValues = {
    ...input.values,
    "reply.instructions": replies,
    "optout.sms": input.channel === "sms" && input.purpose === "marketing" ? SMS_OPT_OUT : null,
    "unsubscribe.link": input.channel === "email" ? input.stopUrl : null,
  };
  if (input.channel === "sms") {
    let text = normaliseSmsText(renderTemplate(input.body, values, { missing: "empty" }).text);
    if (input.purpose === "marketing" && !/\bSTOP\b/.test(text)) text = `${text} ${SMS_OPT_OUT}`;
    return { subject: null, text, html: null, segments: smsInfo(text).segments, headers: {} };
  }
  const subject = renderTemplate(input.subject ?? "", values, { missing: "empty" }).text.replace(/\s+/g, " ").trim() || input.clinic.name;
  const body = renderTemplate(input.body, values, { missing: "empty" }).text;
  const why = input.purpose === "marketing" ? "You are receiving this because you agreed to hear from us." : "This email is about your appointments with us.";
  const footer = [
    "--",
    [input.clinic.name, input.clinic.phone].filter(Boolean).join(" · "),
    input.stopUrl && !body.includes(input.stopUrl) ? `${why} To stop these emails: ${input.stopUrl}` : why,
  ].join("\n");
  const text = `${body}\n\n${footer}`;
  const linkify = (s: string) => (input.stopUrl ? s.split(escapeHtml(input.stopUrl)).join(`<a href="${escapeHtml(input.stopUrl)}">${escapeHtml(input.stopUrl)}</a>`) : s);
  const html = `<!doctype html><html lang="en-GB"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${linkify(escapeHtml(body))
    .split("\n")
    .join("<br>")}<hr style="border:0;border-top:1px solid #cbd5e1;margin:24px 0 12px"><p style="font-size:13px;color:#334155">${linkify(escapeHtml(footer.slice(3)))
    .split("\n")
    .join("<br>")}</p></body></html>`;
  const headers: Record<string, string> = input.stopUrl ? { "List-Unsubscribe": `<${input.stopUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
  return { subject, text, html, segments: null, headers };
}
