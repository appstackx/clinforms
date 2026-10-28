/**
 * The diary screen's data (DiaryViewData) for one site and date: the day view with one column per practitioner
 * or per room, or the week view (Monday–Sunday) of one practitioner or one room. Per column: the rota windows
 * (shading), the items (appointments and blocked time) and the free slots. Only what the grid needs about a
 * patient leaves the server (name, number, whether the record has alerts – the name only for roles that may
 * see patients); nothing is decrypted. Site scope: the site switcher lists the member's sites only, a site
 * outside them is never shown, and a practitioner's week shows only items at the member's sites. Server only.
 */
import "server-only";
import { DIARY_COPY } from "../../../modules/pms/diary/copy";
import { freeSlots, gridHours, localSpan, occupiesDiary, type BusySpan, type RotaWindow } from "../../../modules/pms/diary/rules";
import { formatDayShort, formatHhmm, formatLondonTime, londonRange, weekDates } from "../../../modules/pms/diary/time";
import type { DiaryItem, DiaryRead } from "../../../modules/pms/diary/types";
import type { DiaryCard, DiaryColumn, DiaryFreeSlot, DiaryParams, DiaryViewData } from "../../../modules/pms/diary/view";
import { nowIso } from "../../repos/context";
import { listDiary } from "../../repos/pms/diary/appointments";
import { availabilityWindows } from "../../repos/pms/diary/availability";
import { countWaitingList, getWaitingListEntry } from "../../repos/pms/diary/waiting-list";
import { listPractitioners, listRooms, listServices, listSites } from "../../repos/pms/directory";
import { getPatientSummaries } from "../../repos/pms/patients";
import { inScope, scopeList, type DiaryCaller } from "./caller";

export function patientDisplayName(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

export interface DiaryViewOptions {
  /** The signed-in member's practitioner row ("my diary" when nothing is chosen). */
  practitionerId?: string | null;
  /** Length of the free slots shown (default 30, 5–240). */
  slotMinutes?: number;
}

const windowView = (w: RotaWindow) => ({ startMinute: w.startMinute, endMinute: w.endMinute, siteId: w.siteId });

/** A first appointment: "+" before the type in the diary. */
export function isInitialCategory(category: string | null | undefined): boolean {
  return category === "initial" || category === "assessment";
}

const distinct = (values: (string | null | undefined)[]): string[] => Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)));

export async function loadDiaryView(caller: DiaryCaller, params: DiaryParams, today: string, options: DiaryViewOptions = {}): Promise<DiaryRead<DiaryViewData>> {
  if (!caller.can("diary.view")) return { ok: false, status: 403, error: DIARY_COPY.notAllowed };
  const { ctx, tenantId } = caller;
  const slotMinutes = Math.min(240, Math.max(5, Math.floor(options.slotMinutes ?? 30)));
  const [allSites, practitioners, rooms, services] = await Promise.all([
    listSites(ctx, tenantId),
    listPractitioners(ctx, tenantId, { bookableOnly: true }),
    listRooms(ctx, tenantId),
    listServices(ctx, tenantId),
  ]);
  const sites = allSites.filter((s) => inScope(caller, s.id));
  const site =
    sites.find((s) => s.id === params.siteId) ??
    (options.practitionerId ? sites.find((s) => s.id === practitioners.find((p) => p.id === options.practitionerId)?.defaultSiteId) : undefined) ??
    sites[0] ??
    null;
  const siteRooms = site ? rooms.filter((r) => r.siteId === site.id) : [];
  const dates = params.view === "week" ? weekDates(params.date) : [params.date];
  const range = londonRange(dates[0], dates.length);
  const scoped = scopeList(caller);
  const siteCode = new Map(allSites.map((s) => [s.id, s.code]));
  const practitionerName = new Map(practitioners.map((p) => [p.id, p.displayName]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const serviceCategory = new Map(services.map((s) => [s.id, s.category as string]));

  let columns: Omit<DiaryColumn, "freeSlots" | "bookedPercent">[] = [];
  let items: DiaryItem[] = [];
  let windows: RotaWindow[] = [];
  let truncated = false;
  let resourceId = params.resourceId;
  if (site) {
    if (params.view === "day") {
      const [found, w] = await Promise.all([
        listDiary(ctx, tenantId, { ...range, siteId: site.id, includeCancelled: params.showCancelled }),
        availabilityWindows(ctx, tenantId, dates, { siteId: site.id }),
      ]);
      items = found.items;
      truncated = found.truncated;
      windows = w;
      if (params.by === "practitioner") {
        const ids = new Set<string>([
          ...practitioners.filter((p) => p.defaultSiteId === site.id).map((p) => p.id),
          ...windows.map((x) => x.practitionerId),
          ...items.map((i) => i.practitionerId).filter((id): id is string => id !== null),
        ]);
        columns = practitioners
          .filter((p) => ids.has(p.id))
          .map((p) => {
            const mine = windows.filter((x) => x.practitionerId === p.id);
            return {
              key: `p:${p.id}`,
              date: params.date,
              label: p.displayName,
              sublabel: mine.length ? mine.map((x) => `${formatHhmm(x.startMinute)}–${formatHhmm(x.endMinute)}`).join(", ") : "Not on the rota",
              siteId: site.id,
              practitionerId: p.id,
              roomId: null,
              windows: mine.map(windowView),
              detail: distinct(mine.map((x) => (x.roomId ? roomName.get(x.roomId) : null))).join(", ") || null,
            };
          });
      } else {
        columns = siteRooms.map((r) => ({
          key: `r:${r.id}`,
          date: params.date,
          label: r.name,
          sublabel: null,
          siteId: site.id,
          practitionerId: null,
          roomId: r.id,
          windows: windows.filter((x) => x.roomId === r.id).map(windowView),
          detail: distinct(windows.filter((x) => x.roomId === r.id).map((x) => practitionerName.get(x.practitionerId))).join(", ") || null,
        }));
        if (items.some((i) => i.roomId === null && i.kind === "appointment")) {
          columns.push({ key: "r:none", date: params.date, label: "No room", sublabel: null, siteId: site.id, practitionerId: null, roomId: null, windows: [], detail: null });
        }
      }
    } else if (params.by === "practitioner") {
      // Week of one practitioner, at every site of the member's (they cannot be in two places at once).
      const chosen = practitioners.find((p) => p.id === resourceId) ?? practitioners.find((p) => p.id === options.practitionerId) ?? practitioners.find((p) => p.defaultSiteId === site.id) ?? practitioners[0];
      resourceId = chosen?.id ?? null;
      if (chosen) {
        const [found, w] = await Promise.all([
          listDiary(ctx, tenantId, { ...range, practitionerIds: [chosen.id], siteIds: scoped, includeCancelled: params.showCancelled }),
          availabilityWindows(ctx, tenantId, dates, { practitionerIds: [chosen.id] }),
        ]);
        items = found.items;
        truncated = found.truncated;
        windows = w.filter((x) => inScope(caller, x.siteId));
        columns = dates.map((date) => ({
          key: `d:${date}`,
          date,
          label: formatDayShort(date),
          sublabel: null,
          siteId: windows.find((x) => x.date === date)?.siteId ?? (chosen.defaultSiteId && inScope(caller, chosen.defaultSiteId) ? chosen.defaultSiteId : site.id),
          practitionerId: chosen.id,
          roomId: null,
          windows: windows.filter((x) => x.date === date).map(windowView),
          detail: distinct(windows.filter((x) => x.date === date).map((x) => (x.roomId ? roomName.get(x.roomId) : null))).join(", ") || null,
        }));
      }
    } else {
      const chosen = siteRooms.find((r) => r.id === resourceId) ?? siteRooms[0];
      resourceId = chosen?.id ?? null;
      if (chosen) {
        const [found, w] = await Promise.all([
          listDiary(ctx, tenantId, { ...range, roomIds: [chosen.id], includeCancelled: params.showCancelled }),
          availabilityWindows(ctx, tenantId, dates, { siteId: site.id }),
        ]);
        items = found.items;
        truncated = found.truncated;
        windows = w.filter((x) => x.roomId === chosen.id);
        columns = dates.map((date) => ({
          key: `d:${date}`,
          date,
          label: formatDayShort(date),
          sublabel: null,
          siteId: site.id,
          practitionerId: null,
          roomId: chosen.id,
          windows: windows.filter((x) => x.date === date).map(windowView),
          detail: distinct(windows.filter((x) => x.date === date).map((x) => practitionerName.get(x.practitionerId))).join(", ") || null,
        }));
      }
    }
    if (params.view === "week") {
      // Weekend days with nothing on them are left out.
      columns = columns.filter((c, i) => i < 5 || c.windows.length > 0 || items.some((it) => it.startsOn === c.date));
    }
  }

  // Free slots: busy = everything of the windows' practitioners (at ANY site) and of the rooms concerned.
  const slotsByColumn = new Map<string, DiaryFreeSlot[]>();
  if (site && windows.length > 0) {
    const seen = new Set(items.map((i) => i.id));
    const busy: BusySpan[] = items.filter((i) => i.status !== "cancelled" && i.status !== "late_cancelled");
    const add = (more: DiaryItem[]) => {
      for (const i of more) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        busy.push(i);
      }
    };
    add((await listDiary(ctx, tenantId, { ...range, practitionerIds: Array.from(new Set(windows.map((w) => w.practitionerId))) })).items);
    const roomIds = Array.from(new Set(windows.map((w) => w.roomId).filter((r): r is string => r !== null)));
    if (roomIds.length > 0 && params.view === "week") add((await listDiary(ctx, tenantId, { ...range, roomIds })).items);
    const slots = freeSlots({ windows, busy, durationMinutes: slotMinutes, stepMinutes: slotMinutes, notBefore: nowIso(ctx), limit: 500 });
    for (const s of slots) {
      const key = params.view === "week" ? `d:${s.date}` : params.by === "practitioner" ? `p:${s.practitionerId}` : `r:${s.roomId ?? "none"}`;
      const list = slotsByColumn.get(key) ?? [];
      list.push({ startMinute: s.startMinute, endMinute: s.startMinute + slotMinutes, startsAt: s.startsAt, practitionerId: s.practitionerId, roomId: s.roomId });
      slotsByColumn.set(key, list);
    }
  }
  const fullColumns: DiaryColumn[] = columns.map((c) => ({ ...c, freeSlots: slotsByColumn.get(c.key) ?? [], bookedPercent: null }));

  const showNames = caller.can("patients.view");
  const patientIds = items.map((i) => i.patientId).filter((id): id is string => id !== null);
  const patients = showNames ? await getPatientSummaries(ctx, tenantId, patientIds) : new Map<string, never>();
  const columnKey = (i: DiaryItem): string => (params.view === "week" ? `d:${i.startsOn}` : params.by === "practitioner" ? `p:${i.practitionerId ?? ""}` : `r:${i.roomId ?? "none"}`);
  const keys = new Set(fullColumns.map((c) => c.key));
  const cards: DiaryCard[] = items
    // Room view: a practitioner's blocked time (no room) belongs to the practitioner view.
    .filter((i) => keys.has(columnKey(i)) && !(params.view === "day" && params.by === "room" && i.kind === "block" && i.roomId === null))
    .map((i) => {
      const p = i.patientId ? patients.get(i.patientId) : undefined;
      return {
        id: i.id,
        rev: i.rev,
        kind: i.kind,
        status: i.status,
        columnKey: columnKey(i),
        startsAt: i.startsAt,
        endsAt: i.endsAt,
        startsOn: i.startsOn,
        timeLabel: `${formatLondonTime(i.startsAt)}–${formatLondonTime(i.endsAt)}`,
        siteId: i.siteId,
        siteCode: siteCode.get(i.siteId) ?? null,
        practitionerId: i.practitionerId,
        practitionerName: i.practitionerId ? (practitionerName.get(i.practitionerId) ?? null) : null,
        roomId: i.roomId,
        roomName: i.roomId ? (roomName.get(i.roomId) ?? null) : null,
        patientId: i.patientId,
        patientName: p ? patientDisplayName(p) : null,
        patientNumber: p?.patientNumber ?? null,
        hasAlerts: p?.hasAlerts ?? false,
        serviceId: i.serviceId,
        serviceName: i.serviceId ? (serviceName.get(i.serviceId) ?? null) : null,
        caseId: i.caseId,
        authorisationId: i.authorisationId,
        seriesId: i.seriesId,
        blockKind: i.blockKind,
        title: i.title,
        hasNotes: i.hasNotes,
        feeDue: i.feeDue,
        source: i.source,
        initial: isInitialCategory(i.serviceId ? serviceCategory.get(i.serviceId) : null),
      };
    });
  // "% booked" per column: minutes of appointments that keep their slot against the working time of the column.
  const bookedMinutes = (c: DiaryColumn) =>
    cards.filter((x) => x.columnKey === c.key && x.kind === "appointment" && occupiesDiary(x.status)).reduce((sum, x) => sum + Math.max(0, (Date.parse(x.endsAt) - Date.parse(x.startsAt)) / 60_000), 0);
  const workMinutes = (c: DiaryColumn) => c.windows.reduce((sum, w) => sum + Math.max(0, w.endMinute - w.startMinute), 0);
  for (const c of fullColumns) {
    const work = workMinutes(c);
    c.bookedPercent = work > 0 ? Math.min(100, Math.round((bookedMinutes(c) / work) * 100)) : null;
  }
  let summary: DiaryViewData["summary"] = null;
  if (params.view === "week") {
    const work = fullColumns.reduce((sum, c) => sum + workMinutes(c), 0);
    const booked = fullColumns.reduce((sum, c) => sum + bookedMinutes(c), 0);
    summary = {
      appointments: cards.filter((x) => x.kind === "appointment" && occupiesDiary(x.status)).length,
      bookedPercent: work > 0 ? Math.min(100, Math.round((booked / work) * 100)) : null,
      dna: cards.filter((x) => x.kind === "appointment" && x.status === "dna").length,
    };
  }
  const hours = gridHours(
    fullColumns.flatMap((c) => c.windows),
    cards.map((c) => localSpan(c, c.startsOn)),
  );

  let bookingPreset: DiaryViewData["bookingPreset"] = null;
  if (params.bookFromWaitingId && caller.can("diary.book")) {
    const entry = await getWaitingListEntry(ctx, tenantId, params.bookFromWaitingId);
    if (entry && (entry.status === "waiting" || entry.status === "offered") && (entry.siteId === null || inScope(caller, entry.siteId))) {
      const p = (await getPatientSummaries(ctx, tenantId, [entry.patientId])).get(entry.patientId);
      if (p) {
        bookingPreset = { waitingListId: entry.id, patientId: p.id, patientName: `${patientDisplayName(p)} (No. ${p.patientNumber})`, serviceId: entry.serviceId, practitionerId: entry.practitionerId, siteId: entry.siteId, caseId: entry.caseId };
      }
    }
  }

  return {
    ok: true,
    data: {
      params: { ...params, siteId: site?.id ?? null, resourceId },
      today,
      dates,
      sites: sites.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      site: site ? { id: site.id, name: site.name, code: site.code } : null,
      practitioners: practitioners.map((p) => ({ id: p.id, name: p.displayName, colour: p.colour, defaultSiteId: p.defaultSiteId })),
      rooms: rooms.filter((r) => inScope(caller, r.siteId)).map((r) => ({ id: r.id, name: r.name, siteId: r.siteId })),
      services: services.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, colour: s.colour })),
      columns: fullColumns,
      cards,
      hours,
      truncated,
      slotMinutes,
      waitingCount: await countWaitingList(ctx, tenantId, { siteIds: scoped }),
      bookingPreset,
      summary,
      myPractitionerId: options.practitionerId ?? null,
    },
  };
}
