/**
 * What the booking pages need, as plain data for the browser: the sites offered online (name, address, next free
 * time, map position for the browser's distance – no patient data), the appointment types, the practitioners per
 * site, the policy wording; and the slots of a week for a choice. Nothing here identifies a patient.
 */
import "server-only";
import { formatPence, ukToday } from "../../../modules/pms/core/text";
import type { Practitioner, Service } from "../../../modules/pms/core/types";
import { addDays, formatUkTime } from "../../../modules/pms/portal/time";
import type { PublicClinic } from "./public-clinic";
import { bookingCatalogue, bookingWindow, findSlots, nextFreeBySite } from "./availability";
import type { FlowData, FlowDay, FlowPractitioner, SlotsAnswer } from "../../../modules/pms/portal/flow-types";

export type { FlowData, FlowDay, SlotsAnswer };
import { publicLimits } from "./rate-limit";
import type { FlowDeps } from "./booking";

const PROFESSIONS: Record<string, string> = {
  physiotherapist: "Physiotherapist",
  sports_therapist: "Sports therapist",
  osteopath: "Osteopath",
  chiropractor: "Chiropractor",
  podiatrist: "Podiatrist",
  massage_therapist: "Massage therapist",
  other: "Practitioner",
};

function describe(s: Service): string {
  const minutes = `${s.durationMinutes} min`;
  if (s.category === "initial") return `${minutes} · first visit for a new problem`;
  if (s.category === "follow_up") return `${minutes} · if you've been seen for this problem`;
  if (s.category === "assessment") return `${minutes} · assessment`;
  return `${minutes}`;
}

function practitionerView(p: Practitioner): FlowPractitioner {
  return { id: p.id, name: p.displayName, subtitle: PROFESSIONS[p.profession] ?? "Practitioner" };
}

/** The policy wording the patient reads before confirming. */
export function policyWords(clinic: PublicClinic): string {
  const hours = clinic.settings.cancelNoticeHours;
  return (
    clinic.settings.cancellationPolicy ??
    `Cancel or move free of charge up to ${hours} hours before. Later than that, or if you don't attend, the full fee may be charged.`
  );
}

export async function bookingFlowData(clinic: PublicClinic, deps: FlowDeps): Promise<FlowData> {
  const { ctx, now } = deps;
  const catalogue = await bookingCatalogue(ctx, clinic.tenantId, now);
  const next = await nextFreeBySite(ctx, clinic.tenantId, clinic.settings, catalogue, null, now);
  const practitioners: Record<string, FlowPractitioner[]> = {};
  for (const [siteId, list] of Array.from(catalogue.practitionersBySite.entries())) practitioners[siteId] = list.map(practitionerView);
  return {
    sites: catalogue.sites.map((s) => ({
      id: s.id,
      name: s.name,
      address: [...(s.address ?? []), s.postcode].filter(Boolean).join(", "),
      outward: s.postcode ? s.postcode.trim().split(/\s+/)[0].toUpperCase() : null,
      next: next.get(s.id) ?? null,
      position: catalogue.positions.get(s.id) ?? null,
    })),
    services: catalogue.services.map((s) => ({ id: s.id, name: s.name, minutes: s.durationMinutes, price: s.defaultPricePence === null ? null : formatPence(s.defaultPricePence), description: describe(s) })),
    practitioners,
    policy: policyWords(clinic),
    cancelNoticeHours: clinic.settings.cancelNoticeHours,
    intro: clinic.settings.introText,
    today: ukToday(now),
    lastDate: bookingWindow(clinic.settings, now).lastDate,
    contactPhone: clinic.settings.contactPhone,
  };
}

/** A week of free times for a choice (rate-limited per client). */
export async function slotsForWeek(clinic: PublicClinic, raw: { siteId: unknown; serviceId: unknown; practitionerId: unknown; fromDate: unknown; patientId?: string | null }, deps: FlowDeps): Promise<SlotsAnswer> {
  const { ctx, now } = deps;
  if (deps.clientIp) {
    const limited = await publicLimits(ctx, clinic.tenantId, [["slotsPerClient", deps.clientIp]], deps.limitSecret);
    if (!limited.ok) return { ok: false, error: "Too many searches. Please wait a minute and try again." };
  }
  const id = (v: unknown) => (typeof v === "string" && /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(v) ? v : null);
  const siteId = id(raw.siteId);
  const serviceId = id(raw.serviceId);
  const practitionerId = raw.practitionerId === "any" ? "any" : id(raw.practitionerId);
  const today = ukToday(now);
  const fromDate = typeof raw.fromDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.fromDate) && raw.fromDate >= today ? raw.fromDate : today;
  if (!siteId || !serviceId || !practitionerId) return { ok: false, error: "Please choose again." };
  const catalogue = await bookingCatalogue(ctx, clinic.tenantId, now);
  const { slots } = await findSlots(ctx, clinic.tenantId, clinic.settings, catalogue, { siteId, serviceId, practitionerId, fromDate, days: 7, now, limit: 200, patientId: raw.patientId ?? null });
  const days = new Map<string, FlowDay>();
  for (const s of slots) {
    const day = days.get(s.date) ?? { date: s.date, slots: [] };
    day.slots.push({ startsAt: s.startsAt, time: formatUkTime(s.startsAt), practitionerId: s.practitionerId });
    days.set(s.date, day);
  }
  const lastDate = bookingWindow(clinic.settings, now).lastDate;
  const nextFrom = addDays(fromDate, 7) <= lastDate ? addDays(fromDate, 7) : null;
  return { ok: true, days: Array.from(days.values()), fromDate, nextFrom };
}
