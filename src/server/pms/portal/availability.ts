/**
 * What a patient can book online, and when: the bookable appointment types, sites and practitioners (from the
 * clinic directory and the online hours), and the free slots (src/modules/pms/portal/slots.ts) – online hours,
 * the diary's busy time and rota when the diary is connected (./diary-port.ts), and every other online booking.
 */
import "server-only";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import { ukToday } from "../../../modules/pms/core/text";
import { computeSlots, type BusyInterval, type Slot } from "../../../modules/pms/portal/slots";
import { addDays, londonToUtcMs } from "../../../modules/pms/portal/time";
import type { BookingHours, BookingSettings } from "../../../modules/pms/portal/types";
import type { RepoContext } from "../../repos/context";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";
import { listBusyBookings } from "../../repos/pms/portal/bookings";
import { hoursToRule, listBookingHours } from "../../repos/pms/portal/hours";
import { portalDiary } from "./diary-port";

export interface BookingCatalogue {
  services: Service[];
  sites: Site[];
  practitioners: Practitioner[];
  hours: BookingHours[];
  /** Practitioners offering online hours at each site. */
  practitionersBySite: Map<string, Practitioner[]>;
}

/** Appointment types marked bookable online, and the sites and practitioners that have online hours. */
export async function bookingCatalogue(ctx: RepoContext, tenantId: string): Promise<BookingCatalogue> {
  const [services, sites, practitioners, hours] = await Promise.all([
    listServices(ctx, tenantId, { onlineOnly: true }),
    listSites(ctx, tenantId),
    listPractitioners(ctx, tenantId),
    listBookingHours(ctx, tenantId),
  ]);
  const online = practitioners.filter((p) => p.active && p.bookable && p.onlineBookable);
  const onlineIds = new Set(online.map((p) => p.id));
  const usable = hours.filter((h) => onlineIds.has(h.practitionerId));
  const siteIds = new Set(usable.map((h) => h.siteId));
  const practitionersBySite = new Map<string, Practitioner[]>();
  for (const site of sites) {
    const ids = new Set(usable.filter((h) => h.siteId === site.id).map((h) => h.practitionerId));
    practitionersBySite.set(site.id, online.filter((p) => ids.has(p.id)));
  }
  return {
    services: services.filter((s) => s.active && s.onlineBookable),
    sites: sites.filter((s) => s.active && siteIds.has(s.id)),
    practitioners: online.filter((p) => usable.some((h) => h.practitionerId === p.id)),
    hours: usable,
    practitionersBySite,
  };
}

export interface SlotRequest {
  siteId: string;
  serviceId: string;
  practitionerId: string | "any";
  fromDate: string;
  days: number;
  now: Date;
  /** A booking being moved: its own time does not block the new one. */
  ignoreBookingId?: string | null;
}

export interface SlotAnswer {
  slots: Slot[];
  service: Service | null;
  candidates: Practitioner[];
}

/** Free slots for a request (empty when the type, site or practitioner is not bookable online). */
export async function findSlots(ctx: RepoContext, tenantId: string, settings: BookingSettings, catalogue: BookingCatalogue, req: SlotRequest): Promise<SlotAnswer> {
  const service = catalogue.services.find((s) => s.id === req.serviceId) ?? null;
  const atSite = catalogue.practitionersBySite.get(req.siteId) ?? [];
  const candidates = req.practitionerId === "any" ? atSite : atSite.filter((p) => p.id === req.practitionerId);
  if (!service || candidates.length === 0 || !catalogue.sites.some((s) => s.id === req.siteId)) return { slots: [], service, candidates };
  const days = Math.max(1, Math.min(14, req.days));
  const fromMs = londonToUtcMs(req.fromDate, 0) ?? Date.parse(`${req.fromDate}T00:00:00.000Z`);
  const toMs = (londonToUtcMs(addDays(req.fromDate, days), 0) ?? fromMs + days * 86_400_000) + 3_600_000;
  const fromIso = new Date(fromMs - 12 * 3_600_000).toISOString(); // a long appointment that started earlier still blocks
  const toIso = new Date(toMs).toISOString();
  const ids = candidates.map((p) => p.id);
  const diary = portalDiary();
  const [online, diaryBusy, working] = await Promise.all([
    listBusyBookings(ctx, tenantId, ids, fromIso, toIso),
    diary.busy(ctx, tenantId, ids, fromIso, toIso),
    diary.working(ctx, tenantId, ids, fromIso, toIso),
  ]);
  const busy: BusyInterval[] = [
    ...online.filter((b) => b.id !== req.ignoreBookingId).map((b) => ({ practitionerId: b.practitionerId, startMs: Date.parse(b.startsAt), endMs: Date.parse(b.blocksUntil) })),
    ...diaryBusy,
  ];
  const slots = computeSlots({
    rules: catalogue.hours.filter((h) => h.siteId === req.siteId).map(hoursToRule),
    busy,
    working,
    siteId: req.siteId,
    practitionerIds: ids,
    durationMinutes: service.durationMinutes,
    bufferMinutes: service.bufferMinutes,
    stepMinutes: settings.slotStepMinutes,
    fromDate: req.fromDate,
    days,
    nowMs: req.now.getTime(),
    minNoticeMinutes: settings.minNoticeHours * 60,
    maxDaysAhead: settings.maxDaysAhead,
  });
  return { slots, service, candidates };
}

/** Today in the UK for a clock. */
export function todayFor(now: Date): string {
  return ukToday(now);
}
