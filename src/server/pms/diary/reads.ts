/**
 * The diary's other reads, as the screens will call them (pages directly, client components through the routes
 * under src/app/app/clinic/diary/api): the printable day sheet, the patient record's Appointments tab, rotas,
 * the waiting list (and one entry with its offers and suitable free slots), free slots, the patient search and
 * what the booking form offers for a patient. Each checks the permission and the member's site scope and answers
 * DiaryRead<T>. Lists never decrypt; only one waiting-list entry's notes are decrypted. Server only.
 */
import "server-only";
import { PMS_ID_PATTERN } from "../../../modules/pms/core/ids";
import { formatUkDate, isIsoDate, ukToday } from "../../../modules/pms/core/text";
import { BLOCK_KIND_LABELS, CANCEL_REASON_LABELS, DIARY_COPY, PRIORITY_LABELS, STATUS_LABELS, TIME_OF_DAY_LABELS, WAITING_STATUS_LABELS } from "../../../modules/pms/diary/copy";
import { canMove, nextStatusesAt, type WaitingPriority } from "../../../modules/pms/diary/rules";
import { addDays, daysBetween, formatDayShort, formatHhmm, formatLondonTime, londonDate, londonDayRange, minutesBetween, weekdayName } from "../../../modules/pms/diary/time";
import type { DiaryItem, DiaryRead, WaitingListOffer, WaitingListSummary } from "../../../modules/pms/diary/types";
import type { DaySheet, DaySheetGroup, PatientAppointmentRow, PatientAppointmentsView, RotaRow, WaitingListEntryView, WaitingListOfferRow, WaitingListRow } from "../../../modules/pms/diary/view";
import { nowIso } from "../../repos/context";
import { listAuthorisations, listCasesForPatient } from "../../repos/pms/cases";
import { countPatientAppointmentsByStatus, listDiary, listPatientAppointments, nextAppointmentsFor } from "../../repos/pms/diary/appointments";
import { availabilityWindows, listAvailability } from "../../repos/pms/diary/availability";
import { findFreeSlots } from "../../repos/pms/diary/slots";
import { getWaitingListEntry, listWaitingList, listWaitingListOffers } from "../../repos/pms/diary/waiting-list";
import { getSite, listPractitioners, listRooms, listServices, listSites } from "../../repos/pms/directory";
import { getPatientSummaries, searchPatients } from "../../repos/pms/patients";
import { inScope, scopeList, type DiaryCaller } from "./caller";
import { patientVisibleInScope } from "../access";
import { payerLabelsForCases } from "./payers";
import { getDiarySettings } from "../../repos/pms/diary/settings";
import { patientDisplayName } from "./view";
import { pmsNow } from "../../../modules/pms/core/clock";

const FORBIDDEN = { ok: false as const, status: 403 as const, error: DIARY_COPY.notAllowed };
const notFound = (error: string = DIARY_COPY.recordGone) => ({ ok: false as const, status: 404 as const, error });

async function names(caller: DiaryCaller) {
  const { ctx, tenantId } = caller;
  const [sites, practitioners, rooms, services] = await Promise.all([
    listSites(ctx, tenantId, { includeInactive: true }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
    listRooms(ctx, tenantId, { includeInactive: true }),
    listServices(ctx, tenantId, { includeInactive: true }),
  ]);
  return {
    site: new Map(sites.map((s) => [s.id, s.name])),
    practitioner: new Map(practitioners.map((p) => [p.id, p.displayName])),
    room: new Map(rooms.map((r) => [r.id, r.name])),
    service: new Map(services.map((s) => [s.id, s.name])),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Printable day sheet (K2-DIARY-017)
 * ----------------------------------------------------------------------------------------------*/

/**
 * One site's day on paper, one group per practitioner (optionally just one): times, rooms, patient names and
 * numbers, appointment types, statuses, blocked time. Never notes or contact details; dates of birth only when the
 * clinic switched the diary setting "Show date of birth on the printed day sheet" on (default off).
 */
export async function loadDaySheet(caller: DiaryCaller, q: { siteId: string; date: string; practitionerId?: string | null; includeCancelled?: boolean }): Promise<DiaryRead<DaySheet>> {
  if (!caller.can("diary.view")) return FORBIDDEN;
  if (!PMS_ID_PATTERN.test(q.siteId) || !isIsoDate(q.date) || !inScope(caller, q.siteId)) return notFound(DIARY_COPY.notAtYourSites);
  if (q.practitionerId && !PMS_ID_PATTERN.test(q.practitionerId)) return notFound();
  const { ctx, tenantId } = caller;
  const site = await getSite(ctx, tenantId, q.siteId);
  if (!site) return notFound(DIARY_COPY.notAtYourSites);
  const range = londonDayRange(q.date);
  const [diary, windows, n] = await Promise.all([
    listDiary(ctx, tenantId, { ...range, siteId: site.id, practitionerIds: q.practitionerId ? [q.practitionerId] : undefined, includeCancelled: q.includeCancelled === true }),
    availabilityWindows(ctx, tenantId, [q.date], { siteId: site.id, practitionerIds: q.practitionerId ? [q.practitionerId] : undefined }),
    names(caller),
  ]);
  const showNames = caller.can("patients.view");
  const showDob = showNames && (await getDiarySettings(ctx, tenantId)).showDobOnDaySheet;
  const patients = showNames ? await getPatientSummaries(ctx, tenantId, diary.items.map((i) => i.patientId).filter((id): id is string => id !== null)) : new Map<string, never>();
  const payers = showNames ? await payerLabelsForCases(ctx, tenantId, diary.items.map((i) => i.caseId).filter((id): id is string => id !== null)) : new Map<string, string>();
  const groups = new Map<string, DaySheetGroup>();
  const groupFor = (practitionerId: string | null): DaySheetGroup => {
    const key = practitionerId ?? "";
    let g = groups.get(key);
    if (!g) {
      const mine = windows.filter((w) => w.practitionerId === practitionerId);
      g = {
        practitionerId,
        practitionerName: practitionerId ? (n.practitioner.get(practitionerId) ?? "Practitioner") : "Rooms",
        hours: mine.length ? mine.map((w) => `${formatHhmm(w.startMinute)}–${formatHhmm(w.endMinute)}`).join(", ") : null,
        rows: [],
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const w of windows) groupFor(w.practitionerId);
  for (const i of diary.items) {
    const p = i.patientId ? patients.get(i.patientId) : undefined;
    groupFor(i.practitionerId).rows.push({
      id: i.id,
      hasAlerts: p?.hasAlerts ?? false,
      dateOfBirth: showDob && p?.dateOfBirth ? formatUkDate(p.dateOfBirth) : null,
      payerLabel: i.caseId ? (payers.get(i.caseId) ?? null) : null,
      kind: i.kind,
      startTime: formatLondonTime(i.startsAt),
      endTime: formatLondonTime(i.endsAt),
      roomName: i.roomId ? (n.room.get(i.roomId) ?? null) : null,
      patientName: p ? patientDisplayName(p) : null,
      patientNumber: p?.patientNumber ?? null,
      serviceName: i.serviceId ? (n.service.get(i.serviceId) ?? null) : null,
      status: i.status,
      statusLabel: i.kind === "block" ? "Blocked" : STATUS_LABELS[i.status],
      blockLabel: i.blockKind ? BLOCK_KIND_LABELS[i.blockKind] : null,
      title: i.title,
    });
  }
  const ordered = Array.from(groups.values()).sort((a, b) => (a.practitionerId === null ? 1 : b.practitionerId === null ? -1 : a.practitionerName.localeCompare(b.practitionerName)));
  const now = nowIso(ctx);
  return {
    ok: true,
    data: {
      date: q.date,
      dateLabel: formatDayShort(q.date),
      site: { id: site.id, name: site.name, code: site.code, address: site.address, postcode: site.postcode, phone: site.phone },
      printedAt: `${formatUkDate(londonDate(now))} ${formatLondonTime(now)}`,
      groups: ordered,
      includesCancelled: q.includeCancelled === true,
      showsDateOfBirth: showDob,
      truncated: diary.truncated,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The patient record's Appointments tab
 * ----------------------------------------------------------------------------------------------*/

function patientRow(i: DiaryItem, n: Awaited<ReturnType<typeof names>>): PatientAppointmentRow {
  return {
    id: i.id,
    rev: i.rev,
    status: i.status,
    statusLabel: STATUS_LABELS[i.status],
    startsAt: i.startsAt,
    startsOn: i.startsOn,
    dateLabel: formatDayShort(i.startsOn),
    timeLabel: `${formatLondonTime(i.startsAt)}–${formatLondonTime(i.endsAt)}`,
    durationMinutes: minutesBetween(i.startsAt, i.endsAt),
    siteId: i.siteId,
    siteName: n.site.get(i.siteId) ?? null,
    practitionerId: i.practitionerId,
    practitionerName: i.practitionerId ? (n.practitioner.get(i.practitionerId) ?? null) : null,
    roomName: i.roomId ? (n.room.get(i.roomId) ?? null) : null,
    serviceId: i.serviceId,
    serviceName: i.serviceId ? (n.service.get(i.serviceId) ?? null) : null,
    caseId: i.caseId,
    seriesId: i.seriesId,
    feeDue: i.feeDue,
    feePence: i.feePence,
    cancelReason: i.cancelReason,
    cancelReasonLabel: i.cancelReason ? CANCEL_REASON_LABELS[i.cancelReason] : null,
    source: i.source,
    hasNotes: i.hasNotes,
    canMove: canMove(i.status),
    nextStatuses: Array.from(nextStatusesAt(i.kind, i.status, i.startsAt, pmsNow())),
  };
}

/** A patient's appointments at the member's sites: upcoming (soonest first) and past (newest first, paged). */
export async function loadPatientAppointments(caller: DiaryCaller, patientId: string, options: { before?: string; pageSize?: number } = {}): Promise<DiaryRead<PatientAppointmentsView>> {
  if (!caller.can("diary.view") || !caller.can("patients.view")) return FORBIDDEN;
  if (!PMS_ID_PATTERN.test(patientId)) return notFound();
  const before = options.before && !Number.isNaN(Date.parse(options.before)) ? new Date(Date.parse(options.before)).toISOString() : undefined;
  const { ctx, tenantId } = caller;
  const siteIds = scopeList(caller);
  const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageSize ?? 100)));
  const [items, counts, n] = await Promise.all([
    listPatientAppointments(ctx, tenantId, patientId, { siteIds, before, limit: pageSize + 1 }),
    countPatientAppointmentsByStatus(ctx, tenantId, patientId, { siteIds }),
    names(caller),
  ]);
  const page = items.slice(0, pageSize);
  const now = nowIso(ctx);
  const rows = page.map((i) => patientRow(i, n));
  return {
    ok: true,
    data: {
      patientId,
      upcoming: rows.filter((r) => r.startsAt >= now).reverse(),
      past: rows.filter((r) => r.startsAt < now),
      counts,
      nextBefore: items.length > pageSize ? page[page.length - 1].startsAt : null,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Rotas
 * ----------------------------------------------------------------------------------------------*/

/** Rota entries (current and future, or all with includeEnded) at the member's sites. */
export async function loadRotas(caller: DiaryCaller, q: { siteId?: string; practitionerId?: string; includeEnded?: boolean } = {}): Promise<DiaryRead<RotaRow[]>> {
  if (!caller.can("diary.view")) return FORBIDDEN;
  if ((q.siteId && (!PMS_ID_PATTERN.test(q.siteId) || !inScope(caller, q.siteId))) || (q.practitionerId && !PMS_ID_PATTERN.test(q.practitionerId))) return notFound(DIARY_COPY.notAtYourSites);
  const { ctx, tenantId } = caller;
  const [rules, n] = await Promise.all([
    listAvailability(ctx, tenantId, { siteId: q.siteId, practitionerId: q.practitionerId, includeEnded: q.includeEnded, today: ukToday(ctx.now ? ctx.now() : pmsNow()) }),
    names(caller),
  ]);
  return {
    ok: true,
    data: rules
      .filter((r) => inScope(caller, r.siteId))
      .map((r) => ({
        id: r.id,
        rev: r.rev,
        practitionerId: r.practitionerId,
        practitionerName: n.practitioner.get(r.practitionerId) ?? null,
        siteId: r.siteId,
        siteName: n.site.get(r.siteId) ?? null,
        roomId: r.roomId,
        roomName: r.roomId ? (n.room.get(r.roomId) ?? null) : null,
        weekday: r.weekday,
        weekdayName: weekdayName(r.weekday),
        startTime: formatHhmm(r.startMinute),
        endTime: formatHhmm(r.endMinute),
        everyWeeks: r.everyWeeks,
        validFrom: r.validFrom,
        validTo: r.validTo,
        onlineBookable: r.onlineBookable,
      })),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Waiting list
 * ----------------------------------------------------------------------------------------------*/

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function preferenceLabel(e: Pick<WaitingListSummary, "preferredDays" | "preferredTime">): string {
  const days = e.preferredDays.length ? e.preferredDays.map((d) => SHORT_DAYS[d - 1]).join(", ") : "Any day";
  return `${days} · ${TIME_OF_DAY_LABELS[e.preferredTime]}`;
}

/** When a hold ends, in words: "16:00" today, else "Thu 29/10 16:00". */
function holdLabel(caller: DiaryCaller, iso: string | null): string | null {
  if (!iso) return null;
  const today = ukToday(caller.ctx.now ? caller.ctx.now() : pmsNow());
  const day = londonDate(iso);
  return day === today ? formatLondonTime(iso) : `${formatDayShort(day)} ${formatLondonTime(iso)}`;
}

function isHeld(caller: DiaryCaller, o: WaitingListOffer): boolean {
  return o.status === "open" && o.holdUntil !== null && o.holdUntil > nowIso(caller.ctx);
}

function openOfferOf(caller: DiaryCaller, offers: readonly WaitingListOffer[] | undefined, n: Awaited<ReturnType<typeof names>>): WaitingListRow["offer"] {
  const o = offers?.find((x) => x.status === "open");
  if (!o) return null;
  const held = isHeld(caller, o);
  return {
    id: o.id,
    dateLabel: formatDayShort(londonDate(o.startsAt)),
    timeLabel: `${formatLondonTime(o.startsAt)}–${formatLondonTime(o.endsAt)}`,
    practitionerName: n.practitioner.get(o.practitionerId) ?? null,
    held,
    holdUntilLabel: held ? holdLabel(caller, o.holdUntil) : null,
  };
}

async function waitingRows(caller: DiaryCaller, entries: WaitingListSummary[], openOffers: Map<string, WaitingListOffer[]>): Promise<WaitingListRow[]> {
  const n = await names(caller);
  const showNames = caller.can("patients.view");
  const patients = showNames ? await getPatientSummaries(caller.ctx, caller.tenantId, entries.map((e) => e.patientId)) : new Map<string, never>();
  const today = ukToday(caller.ctx.now ? caller.ctx.now() : pmsNow());
  return entries.map((e) => {
    const p = patients.get(e.patientId);
    return {
      id: e.id,
      rev: e.rev,
      status: e.status,
      statusLabel: WAITING_STATUS_LABELS[e.status],
      priority: e.priority,
      priorityLabel: PRIORITY_LABELS[e.priority as WaitingPriority],
      patientId: e.patientId,
      patientName: p ? patientDisplayName(p) : null,
      patientNumber: p?.patientNumber ?? null,
      serviceId: e.serviceId,
      serviceName: e.serviceId ? (n.service.get(e.serviceId) ?? null) : null,
      practitionerId: e.practitionerId,
      practitionerName: e.practitionerId ? (n.practitioner.get(e.practitionerId) ?? null) : null,
      siteId: e.siteId,
      siteName: e.siteId ? (n.site.get(e.siteId) ?? null) : null,
      preferredDays: e.preferredDays,
      preferredTime: e.preferredTime,
      preferenceLabel: preferenceLabel(e),
      earliestOn: e.earliestOn,
      latestOn: e.latestOn,
      waitingDays: Math.max(0, daysBetween(londonDate(e.createdAt), today)),
      hasNotes: e.hasNotes,
      openOffers: (openOffers.get(e.id) ?? []).filter((o) => o.status === "open").length,
      offer: openOfferOf(caller, openOffers.get(e.id), n),
      createdAt: e.createdAt,
    };
  });
}

/** The waiting list (open entries by default), most urgent first, for the member's sites (and "any site"). */
export async function loadWaitingList(caller: DiaryCaller, q: { status?: "open" | "waiting" | "offered" | "booked" | "removed"; siteId?: string; practitionerId?: string; patientId?: string } = {}): Promise<DiaryRead<WaitingListRow[]>> {
  if (!caller.can("diary.view")) return FORBIDDEN;
  for (const id of [q.siteId, q.practitionerId, q.patientId]) if (id !== undefined && !PMS_ID_PATTERN.test(id)) return notFound();
  if (q.siteId && !inScope(caller, q.siteId)) return notFound(DIARY_COPY.notAtYourSites);
  const entries = await listWaitingList(caller.ctx, caller.tenantId, { status: q.status, siteId: q.siteId, siteIds: scopeList(caller), practitionerId: q.practitionerId, patientId: q.patientId });
  const offers = new Map<string, WaitingListOffer[]>();
  const offered = entries.filter((e) => e.status === "offered");
  for (const e of offered.slice(0, 100)) offers.set(e.id, await listWaitingListOffers(caller.ctx, caller.tenantId, e.id));
  return { ok: true, data: await waitingRows(caller, entries, offers) };
}

function offerRow(caller: DiaryCaller, o: WaitingListOffer, n: Awaited<ReturnType<typeof names>>): WaitingListOfferRow {
  const held = isHeld(caller, o);
  return {
    held,
    holdUntilLabel: held ? holdLabel(caller, o.holdUntil) : null,
    id: o.id,
    status: o.status,
    statusLabel: { open: "Offered", accepted: "Booked", declined: "Declined", withdrawn: "Withdrawn" }[o.status],
    dateLabel: formatDayShort(londonDate(o.startsAt)),
    timeLabel: `${formatLondonTime(o.startsAt)}–${formatLondonTime(o.endsAt)}`,
    siteName: n.site.get(o.siteId) ?? null,
    practitionerName: n.practitioner.get(o.practitionerId) ?? null,
    roomName: o.roomId ? (n.room.get(o.roomId) ?? null) : null,
    appointmentId: o.appointmentId,
    createdAt: o.createdAt,
  };
}

/** One entry: notes decrypted, its offers, and free slots that suit it (the next 4 weeks, at most 12). */
export async function loadWaitingListEntry(caller: DiaryCaller, id: string): Promise<DiaryRead<WaitingListEntryView>> {
  if (!caller.can("diary.view")) return FORBIDDEN;
  if (!PMS_ID_PATTERN.test(id)) return notFound();
  const { ctx, tenantId } = caller;
  const entry = await getWaitingListEntry(ctx, tenantId, id);
  if (!entry || (entry.siteId !== null && !inScope(caller, entry.siteId))) return notFound("This waiting-list entry no longer exists.");
  const [offers, n] = await Promise.all([listWaitingListOffers(ctx, tenantId, id), names(caller)]);
  const [row] = await waitingRows(caller, [entry], new Map([[id, offers]]));
  let suggestions: WaitingListEntryView["suggestions"] = [];
  if ((entry.status === "waiting" || entry.status === "offered") && entry.serviceId && caller.can("diary.book")) {
    const today = ukToday(ctx.now ? ctx.now() : pmsNow());
    const from = entry.earliestOn && entry.earliestOn > today ? entry.earliestOn : today;
    const slots = await findFreeSlots(ctx, tenantId, {
      fromDate: from,
      days: 28,
      serviceId: entry.serviceId,
      siteId: entry.siteId ?? undefined,
      siteIds: scopeList(caller),
      practitionerIds: entry.practitionerId ? [entry.practitionerId] : undefined,
      preferences: { preferredDays: entry.preferredDays, preferredTime: entry.preferredTime, earliestOn: entry.earliestOn, latestOn: entry.latestOn },
      patientId: entry.patientId,
      limit: 12,
    });
    suggestions = slots.map((s) => ({ date: s.date, dateLabel: formatDayShort(s.date), time: formatHhmm(s.startMinute), practitionerId: s.practitionerId, practitionerName: n.practitioner.get(s.practitionerId) ?? null, siteId: s.siteId, roomId: s.roomId }));
  }
  return { ok: true, data: { row, caseId: entry.caseId, notes: entry.notes, removedReason: entry.removedReason, offers: offers.map((o) => offerRow(caller, o, n)), suggestions } };
}

/* ------------------------------------------------------------------------------------------------
 * Free slots, patient search, booking options (the booking form)
 * ----------------------------------------------------------------------------------------------*/

export interface DiarySlotsQuery {
  serviceId: string;
  siteId?: string;
  practitionerId?: string;
  fromDate?: string;
  days?: number;
  limit?: number;
}

/** The next free slots of an appointment type inside the rota (at the member's sites), from today at the earliest. */
export async function loadFreeSlots(caller: DiaryCaller, q: DiarySlotsQuery): Promise<DiaryRead<{ date: string; time: string; practitionerId: string; practitionerName: string | null; siteId: string; roomId: string | null }[]>> {
  if (!caller.can("diary.view")) return FORBIDDEN;
  for (const id of [q.serviceId, q.siteId, q.practitionerId]) if (id !== undefined && !PMS_ID_PATTERN.test(id)) return notFound();
  if (q.siteId && !inScope(caller, q.siteId)) return notFound(DIARY_COPY.notAtYourSites);
  const { ctx, tenantId } = caller;
  const today = ukToday(ctx.now ? ctx.now() : pmsNow());
  const from = q.fromDate && isIsoDate(q.fromDate) && q.fromDate >= today && q.fromDate <= addDays(today, 366) ? q.fromDate : today;
  const [slots, n] = await Promise.all([
    findFreeSlots(ctx, tenantId, { fromDate: from, days: Math.min(28, Math.max(1, q.days ?? 21)), serviceId: q.serviceId, siteId: q.siteId, siteIds: scopeList(caller), practitionerIds: q.practitionerId ? [q.practitionerId] : undefined, limit: Math.min(50, Math.max(1, q.limit ?? 12)) }),
    names(caller),
  ]);
  return { ok: true, data: slots.map((s) => ({ date: s.date, time: formatHhmm(s.startMinute), practitionerId: s.practitionerId, practitionerName: n.practitioner.get(s.practitionerId) ?? null, siteId: s.siteId, roomId: s.roomId })) };
}

export interface DiaryPatientHit {
  id: string;
  name: string;
  number: number;
  dateOfBirth: string | null;
  postcode: string | null;
  /** Mobile number (what reception checks on the phone). */
  phone: string | null;
  /** "DD/MM/YYYY" of the last attended appointment, or null. */
  lastSeen: string | null;
  hasAlerts: boolean;
  next: { id: string; date: string; time: string; siteId: string; practitionerId: string | null } | null;
}

/** Quick patient search for the diary (name, number, phone, date of birth): 10 active patients, nothing decrypted. */
export async function searchDiaryPatients(caller: DiaryCaller, query: unknown): Promise<DiaryRead<DiaryPatientHit[]>> {
  if (!caller.can("patients.view")) return FORBIDDEN;
  const q = (typeof query === "string" ? query : "").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, data: [] };
  const { ctx, tenantId } = caller;
  const found = await searchPatients(ctx, tenantId, { q, limit: 10, siteIds: caller.siteIds });
  const next = caller.can("diary.view") ? await nextAppointmentsFor(ctx, tenantId, found.map((p) => p.id), nowIso(ctx), { siteIds: scopeList(caller) }) : new Map<string, DiaryItem>();
  return {
    ok: true,
    data: found.map((p) => {
      const a = next.get(p.id);
      return {
        id: p.id,
        name: patientDisplayName(p),
        number: p.patientNumber,
        dateOfBirth: p.dateOfBirth ? formatUkDate(p.dateOfBirth) : null,
        postcode: p.postcode,
        phone: p.phoneMobile,
        lastSeen: p.lastSeenOn ? formatUkDate(p.lastSeenOn) : null,
        hasAlerts: p.hasAlerts,
        next: a ? { id: a.id, date: a.startsOn, time: formatLondonTime(a.startsAt), siteId: a.siteId, practitionerId: a.practitionerId } : null,
      };
    }),
  };
}

export interface DiaryBookingOptions {
  cases: { id: string; title: string; payerType: string; payerLabel: string; practitionerId: string | null; siteId: string | null }[];
  authorisations: { id: string; caseId: string; code: string; sessionsLeft: number | null; expiresOn: string | null }[];
}

/** What the booking form offers for a patient: open cases and active authorisations with the sessions left (in the member's sites). */
export async function loadBookingOptions(caller: DiaryCaller, patientId: string): Promise<DiaryRead<DiaryBookingOptions>> {
  if (!caller.can("diary.book") || !caller.can("patients.view")) return FORBIDDEN;
  if (!PMS_ID_PATTERN.test(patientId)) return { ok: true, data: { cases: [], authorisations: [] } };
  const { ctx, tenantId } = caller;
  // M10 L2: a patient outside the member's sites answers like no patient; cases at other sites are left out.
  if (caller.siteIds !== null && !(await patientVisibleInScope(ctx, tenantId, patientId, caller.siteIds))) return { ok: true, data: { cases: [], authorisations: [] } };
  const [allCases, allAuths] = await Promise.all([listCasesForPatient(ctx, tenantId, patientId), listAuthorisations(ctx, tenantId, { patientId })]);
  const cases = allCases.filter((c) => c.siteId === null || inScope(caller, c.siteId));
  const shownCases = new Set(cases.map((c) => c.id));
  const auths = allAuths.filter((a) => shownCases.has(a.caseId));
  const payers = await payerLabelsForCases(ctx, tenantId, cases.map((c) => c.id));
  return {
    ok: true,
    data: {
      cases: cases.filter((c) => c.status !== "closed").map((c) => ({ id: c.id, title: c.title, payerType: c.payerType, payerLabel: payers.get(c.id) ?? "Self-pay", practitionerId: c.practitionerId, siteId: c.siteId })),
      authorisations: auths
        .filter((a) => a.status === "active")
        .map((a) => ({ id: a.id, caseId: a.caseId, code: a.code, sessionsLeft: a.sessionsAuthorised === null ? null : Math.max(0, a.sessionsAuthorised - a.sessionsUsed), expiresOn: a.expiresOn })),
    },
  };
}
