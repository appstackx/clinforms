/**
 * What a patient can book online, and when: the appointment types, sites and practitioners offered online (the
 * clinic directory's "online" switches, the sites switched on in Online booking set-up, and the practitioners with
 * rota hours marked for online booking there) and the free slots – from the DIARY (./diary-port.ts), within the
 * clinic's booking policy (minimum notice, how far ahead, slot step).
 */
import "server-only";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import { ukToday } from "../../../modules/pms/core/text";
import { addDays } from "../../../modules/pms/portal/time";
import type { BookingSettings, BookingSite } from "../../../modules/pms/portal/types";
import type { RepoContext } from "../../repos/context";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";
import { listBookingSites } from "../../repos/pms/portal/sites";
import { portalDiary, type PortalSlot } from "./diary-port";
import { pmsNow } from "../../../modules/pms/core/clock";

export interface BookingCatalogue {
  services: Service[];
  sites: Site[];
  practitioners: Practitioner[];
  /** Practitioners offering online hours at each site. */
  practitionersBySite: Map<string, Practitioner[]>;
  /** Map positions of the sites (for the browser's distance – null when not set). */
  positions: Map<string, { latitude: number; longitude: number }>;
}

/** Appointment types, sites and practitioners offered online today. */
export async function bookingCatalogue(ctx: RepoContext, tenantId: string, now: Date = pmsNow()): Promise<BookingCatalogue> {
  const [services, sites, practitioners, siteSettings, rota] = await Promise.all([
    listServices(ctx, tenantId, { onlineOnly: true }),
    listSites(ctx, tenantId),
    listPractitioners(ctx, tenantId),
    listBookingSites(ctx, tenantId),
    portalDiary().onlineRota(ctx, tenantId, ukToday(now)),
  ]);
  const online = practitioners.filter((p) => p.active && p.bookable && p.onlineBookable);
  const onlineIds = new Set(online.map((p) => p.id));
  const siteOn = (s: Site) => s.active && (siteSettings.get(s.id)?.online ?? true);
  const practitionersBySite = new Map<string, Practitioner[]>();
  for (const site of sites.filter(siteOn)) {
    const ids = new Set(rota.filter((r) => r.siteId === site.id && onlineIds.has(r.practitionerId)).map((r) => r.practitionerId));
    if (ids.size > 0) practitionersBySite.set(site.id, online.filter((p) => ids.has(p.id)));
  }
  const positions = new Map<string, { latitude: number; longitude: number }>();
  for (const [siteId, b] of Array.from((siteSettings as Map<string, BookingSite>).entries())) {
    if (b.latitude !== null && b.longitude !== null) positions.set(siteId, { latitude: b.latitude, longitude: b.longitude });
  }
  const offered = new Set(Array.from(practitionersBySite.values()).flat().map((p) => p.id));
  return {
    services: services.filter((s) => s.active && s.onlineBookable),
    sites: sites.filter((s) => practitionersBySite.has(s.id)),
    practitioners: online.filter((p) => offered.has(p.id)),
    practitionersBySite,
    positions,
  };
}

export interface SlotRequest {
  siteId: string;
  serviceId: string;
  practitionerId: string | "any";
  fromDate: string;
  days: number;
  now: Date;
  limit?: number;
  /** Leave out times this patient already has an appointment (portal bookings and moves). */
  patientId?: string | null;
}

export interface SlotAnswer {
  slots: PortalSlot[];
  service: Service | null;
  candidates: Practitioner[];
}

/** The first and last instants a patient may book now (minimum notice, how far ahead). */
export function bookingWindow(settings: Pick<BookingSettings, "minNoticeHours" | "maxDaysAhead">, now: Date): { notBefore: string; notAfter: string; lastDate: string } {
  const notBefore = new Date(now.getTime() + settings.minNoticeHours * 3_600_000).toISOString();
  const lastDate = addDays(ukToday(now), settings.maxDaysAhead);
  const notAfter = new Date(now.getTime() + (settings.maxDaysAhead + 1) * 86_400_000).toISOString();
  return { notBefore, notAfter, lastDate };
}

/** Free slots for a request (empty when the type, site or practitioner is not offered online). */
export async function findSlots(ctx: RepoContext, tenantId: string, settings: BookingSettings, catalogue: BookingCatalogue, req: SlotRequest): Promise<SlotAnswer> {
  const service = catalogue.services.find((s) => s.id === req.serviceId) ?? null;
  const atSite = catalogue.practitionersBySite.get(req.siteId) ?? [];
  const candidates = req.practitionerId === "any" ? atSite : atSite.filter((p) => p.id === req.practitionerId);
  if (!service || candidates.length === 0) return { slots: [], service, candidates };
  const window = bookingWindow(settings, req.now);
  if (req.fromDate > window.lastDate) return { slots: [], service, candidates };
  const days = Math.max(1, Math.min(28, req.days));
  const slots = await portalDiary().freeSlots(ctx, tenantId, {
    fromDate: req.fromDate,
    days,
    siteId: req.siteId,
    practitionerIds: candidates.map((p) => p.id),
    serviceId: service.id,
    stepMinutes: settings.slotStepMinutes,
    notBefore: window.notBefore,
    notAfter: window.notAfter,
    limit: req.limit ?? 200,
    patientId: req.patientId ?? null,
  });
  // "Anyone available": one time per start (the clinic's practitioner order decides who).
  if (req.practitionerId !== "any") return { slots, service, candidates };
  const order = new Map(candidates.map((p, i) => [p.id, i]));
  const byStart = new Map<string, PortalSlot>();
  for (const s of slots) {
    const kept = byStart.get(s.startsAt);
    if (!kept || (order.get(s.practitionerId) ?? 99) < (order.get(kept.practitionerId) ?? 99)) byStart.set(s.startsAt, s);
  }
  return { slots: Array.from(byStart.values()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), service, candidates };
}

/** The slot a patient chose, if it is still free (the same practitioner, or anyone when they chose "any"). */
export function pickSlot(slots: readonly PortalSlot[], startsAt: string, practitionerId: string | "any"): PortalSlot | null {
  return slots.find((s) => s.startsAt === startsAt && (practitionerId === "any" || s.practitionerId === practitionerId)) ?? null;
}

/** Each site's next free time for a type (the site list), within the next two weeks. */
export async function nextFreeBySite(ctx: RepoContext, tenantId: string, settings: BookingSettings, catalogue: BookingCatalogue, serviceId: string | null, now: Date): Promise<Map<string, string>> {
  const service = (serviceId && catalogue.services.find((s) => s.id === serviceId)) || catalogue.services[0];
  const out = new Map<string, string>();
  if (!service) return out;
  const from = ukToday(now);
  for (const site of catalogue.sites) {
    const { slots } = await findSlots(ctx, tenantId, settings, catalogue, { siteId: site.id, serviceId: service.id, practitionerId: "any", fromDate: from, days: 14, now, limit: 1 });
    if (slots[0]) out.set(site.id, slots[0].startsAt);
  }
  return out;
}
