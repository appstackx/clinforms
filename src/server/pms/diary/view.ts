/**
 * Loads the diary screen (day or week, by practitioner or by room) for the signed-in member's clinic: the
 * columns, the working windows that shade them, and the items with the little the grid shows about a patient
 * (name, number, whether the record has alerts). Server only.
 */
import "server-only";
import { gridHours, localSpan } from "../../../modules/pms/diary/rules";
import { formatDayShort, formatHhmm, formatLondonTime, londonRange, weekDates } from "../../../modules/pms/diary/time";
import type { DiaryItem } from "../../../modules/pms/diary/types";
import type { DiaryCard, DiaryColumn, DiaryParams, DiaryViewData } from "../../../modules/pms/diary/view";
import type { RepoContext } from "../../repos/context";
import { listDiary } from "../../repos/pms/diary/appointments";
import { availabilityWindows } from "../../repos/pms/diary/availability";
import { countWaitingList, getWaitingListEntry } from "../../repos/pms/diary/waiting-list";
import { listPractitioners, listRooms, listServices, listSites } from "../../repos/pms/directory";
import { getPatientSummaries } from "../../repos/pms/patients";

function displayName(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

export async function loadDiaryView(ctx: RepoContext, tenantId: string, params: DiaryParams, today: string, options: { practitionerId?: string | null } = {}): Promise<DiaryViewData> {
  const [sites, practitioners, rooms, services, waitingCount] = await Promise.all([
    listSites(ctx, tenantId),
    listPractitioners(ctx, tenantId, { bookableOnly: true }),
    listRooms(ctx, tenantId),
    listServices(ctx, tenantId),
    countWaitingList(ctx, tenantId),
  ]);
  const site = sites.find((s) => s.id === params.siteId) ?? (options.practitionerId ? sites.find((s) => s.id === practitioners.find((p) => p.id === options.practitionerId)?.defaultSiteId) : undefined) ?? sites[0] ?? null;
  const siteRooms = site ? rooms.filter((r) => r.siteId === site.id) : [];
  const dates = params.view === "week" ? weekDates(params.date) : [params.date];
  const range = londonRange(dates[0], dates.length);
  const siteCode = new Map(sites.map((s) => [s.id, s.code]));
  const practitionerName = new Map(practitioners.map((p) => [p.id, p.displayName]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  let columns: DiaryColumn[] = [];
  let items: DiaryItem[] = [];
  let truncated = false;
  let resourceId = params.resourceId;
  if (site) {
    if (params.view === "day") {
      const { items: found, truncated: cut } = await listDiary(ctx, tenantId, { ...range, siteId: site.id, includeCancelled: params.showCancelled });
      items = found;
      truncated = cut;
      const windows = await availabilityWindows(ctx, tenantId, dates, { siteId: site.id });
      if (params.by === "practitioner") {
        const ids = new Set<string>([
          ...practitioners.filter((p) => p.defaultSiteId === site.id).map((p) => p.id),
          ...windows.map((w) => w.practitionerId),
          ...items.map((i) => i.practitionerId).filter((id): id is string => id !== null),
        ]);
        columns = practitioners
          .filter((p) => ids.has(p.id))
          .map((p) => ({
            key: `p:${p.id}`,
            date: params.date,
            label: p.displayName,
            sublabel: windows.some((w) => w.practitionerId === p.id) ? windows.filter((w) => w.practitionerId === p.id).map((w) => `${formatHhmm(w.startMinute)}–${formatHhmm(w.endMinute)}`).join(", ") : "Not on the rota",
            siteId: site.id,
            practitionerId: p.id,
            roomId: null,
            windows: windows.filter((w) => w.practitionerId === p.id).map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute, siteId: w.siteId })),
          }));
      } else {
        columns = siteRooms.map((r) => ({
          key: `r:${r.id}`,
          date: params.date,
          label: r.name,
          sublabel: null,
          siteId: site.id,
          practitionerId: null,
          roomId: r.id,
          windows: windows.filter((w) => w.roomId === r.id).map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute, siteId: w.siteId })),
        }));
        if (items.some((i) => i.roomId === null)) {
          columns.push({ key: "r:none", date: params.date, label: "No room", sublabel: null, siteId: site.id, practitionerId: null, roomId: null, windows: [] });
        }
      }
    } else {
      // Week view: one practitioner (at every site – they cannot be in two places) or one room of the site.
      if (params.by === "practitioner") {
        const chosen = practitioners.find((p) => p.id === resourceId) ?? practitioners.find((p) => p.id === options.practitionerId) ?? practitioners.find((p) => p.defaultSiteId === site.id) ?? practitioners[0];
        resourceId = chosen?.id ?? null;
        if (chosen) {
          const [{ items: found, truncated: cut }, windows] = await Promise.all([
            listDiary(ctx, tenantId, { ...range, practitionerIds: [chosen.id], includeCancelled: params.showCancelled }),
            availabilityWindows(ctx, tenantId, dates, { practitionerIds: [chosen.id] }),
          ]);
          items = found;
          truncated = cut;
          columns = dates.map((date) => ({
            key: `d:${date}`,
            date,
            label: formatDayShort(date),
            sublabel: null,
            siteId: windows.find((w) => w.date === date)?.siteId ?? chosen.defaultSiteId ?? site.id,
            practitionerId: chosen.id,
            roomId: null,
            windows: windows.filter((w) => w.date === date).map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute, siteId: w.siteId })),
          }));
        }
      } else {
        const chosen = siteRooms.find((r) => r.id === resourceId) ?? siteRooms[0];
        resourceId = chosen?.id ?? null;
        if (chosen) {
          const [{ items: found, truncated: cut }, windows] = await Promise.all([
            listDiary(ctx, tenantId, { ...range, roomIds: [chosen.id], includeCancelled: params.showCancelled }),
            availabilityWindows(ctx, tenantId, dates, { siteId: site.id }),
          ]);
          items = found;
          truncated = cut;
          columns = dates.map((date) => ({
            key: `d:${date}`,
            date,
            label: formatDayShort(date),
            sublabel: null,
            siteId: site.id,
            practitionerId: null,
            roomId: chosen.id,
            windows: windows.filter((w) => w.date === date && w.roomId === chosen.id).map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute, siteId: w.siteId })),
          }));
        }
      }
      // Weekend days with nothing on them are left out.
      columns = columns.filter((c, i) => i < 5 || c.windows.length > 0 || items.some((it) => it.startsOn === c.date));
    }
  }

  const patients = await getPatientSummaries(
    ctx,
    tenantId,
    items.map((i) => i.patientId).filter((id): id is string => id !== null),
  );
  const columnKey = (i: DiaryItem): string =>
    params.view === "week" ? `d:${i.startsOn}` : params.by === "practitioner" ? `p:${i.practitionerId ?? ""}` : `r:${i.roomId ?? "none"}`;
  const keys = new Set(columns.map((c) => c.key));
  const cards: DiaryCard[] = items
    .filter((i) => keys.has(columnKey(i)))
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
        patientName: p ? displayName(p) : null,
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
      };
    });
  const hours = gridHours(
    columns.flatMap((c) => c.windows),
    cards.map((c) => localSpan(c, c.startsOn)),
  );

  let bookingPreset: DiaryViewData["bookingPreset"] = null;
  if (params.bookFromWaitingId) {
    const entry = await getWaitingListEntry(ctx, tenantId, params.bookFromWaitingId);
    if (entry && (entry.status === "waiting" || entry.status === "offered")) {
      const p = (await getPatientSummaries(ctx, tenantId, [entry.patientId])).get(entry.patientId);
      if (p) {
        bookingPreset = { waitingListId: entry.id, patientId: p.id, patientName: `${displayName(p)} (No. ${p.patientNumber})`, serviceId: entry.serviceId, practitionerId: entry.practitionerId, siteId: entry.siteId, caseId: entry.caseId };
      }
    }
  }

  return {
    params: { ...params, siteId: site?.id ?? null, resourceId },
    today,
    dates,
    sites: sites.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    site: site ? { id: site.id, name: site.name, code: site.code } : null,
    practitioners: practitioners.map((p) => ({ id: p.id, name: p.displayName, colour: p.colour, defaultSiteId: p.defaultSiteId })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, siteId: r.siteId })),
    services: services.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, colour: s.colour })),
    columns,
    cards,
    hours,
    truncated,
    waitingCount,
    bookingPreset,
  };
}
