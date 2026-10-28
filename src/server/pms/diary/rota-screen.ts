/**
 * Data of the "Rota and waiting list" page (design round 2): one practitioner's weekly pattern (per weekday: site,
 * room, hours and the break between two entries), their exceptions (blocked time in the coming eight weeks, with
 * the bookings it covers), and the freed slot the waiting list can fill (the soonest cancelled appointment at the
 * site whose time is still free) with the entries that suit it. diary.view (the rota is changed with diary.manage).
 * Server only.
 */
import "server-only";
import { BLOCK_KIND_LABELS, DIARY_COPY } from "../../../modules/pms/diary/copy";
import { occupiesDiary, slotSuits, spansOverlap, type BlockKind } from "../../../modules/pms/diary/rules";
import { formatHhmm, formatLondonTime, londonDate, londonParts, londonRange } from "../../../modules/pms/diary/time";
import type { DiaryRead } from "../../../modules/pms/diary/types";
import type { RotaRow } from "../../../modules/pms/diary/view";
import { nowIso } from "../../repos/context";
import { listDiary } from "../../repos/pms/diary/appointments";
import { getService } from "../../repos/pms/directory";
import { getPatientSummaries } from "../../repos/pms/patients";
import { scopeList, type DiaryCaller } from "./caller";
import { loadRotas } from "./reads";
import { patientDisplayName } from "./view";

export interface RotaDayPattern {
  weekday: number;
  working: boolean;
  siteId: string | null;
  roomId: string | null;
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
  /** Entries that do not fit the simple pattern (every 2+ weeks, two sites on one day): shown, kept as they are. */
  irregular: boolean;
}

export interface RotaException {
  id: string;
  date: string;
  label: string;
  /** Appointments still booked in that time. */
  bookingsToMove: number;
}

export interface FreedSlot {
  appointmentId: string;
  date: string;
  time: string;
  endTime: string;
  practitionerId: string;
  practitionerName: string | null;
  siteId: string;
  roomId: string | null;
  /** Whose cancellation freed it ("Hannah Wright's late cancellation"). */
  reason: string;
  /** Waiting-list entries this slot suits. */
  matches: string[];
}

export interface RotaScreen {
  practitionerId: string | null;
  days: RotaDayPattern[];
  rows: RotaRow[];
  exceptions: RotaException[];
}

/** One practitioner's weekly pattern as the editor shows it. */
export async function loadRotaScreen(caller: DiaryCaller, practitionerId: string | null, today: string, asOf: string = today): Promise<DiaryRead<RotaScreen>> {
  if (!caller.can("diary.view")) return { ok: false, status: 403, error: DIARY_COPY.notAllowed };
  if (!practitionerId) return { ok: true, data: { practitionerId: null, days: [], rows: [], exceptions: [] } };
  const rotas = await loadRotas(caller, { practitionerId });
  if (!rotas.ok) return rotas;
  const rows = rotas.data;
  // The pattern in force on `asOf` (the editor's "From" date).
  const inForce = rows.filter((r) => r.validFrom <= asOf && (r.validTo === null || r.validTo >= asOf));
  const days: RotaDayPattern[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    // The entries in force today or next (the earliest start first).
    const mine = inForce.filter((r) => r.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (mine.length === 0) {
      days.push({ weekday, working: false, siteId: null, roomId: null, start: "09:00", end: "17:00", breakStart: null, breakEnd: null, irregular: false });
      continue;
    }
    const sameSite = mine.every((r) => r.siteId === mine[0].siteId);
    const irregular = mine.length > 2 || !sameSite || mine.some((r) => r.everyWeeks !== 1);
    days.push({
      weekday,
      working: true,
      siteId: mine[0].siteId,
      roomId: mine[0].roomId,
      start: mine[0].startTime,
      end: mine[mine.length - 1].endTime,
      breakStart: mine.length === 2 ? mine[0].endTime : null,
      breakEnd: mine.length === 2 ? mine[1].startTime : null,
      irregular,
    });
  }
  const range = londonRange(today, 56);
  const diary = await listDiary(caller.ctx, caller.tenantId, { ...range, practitionerIds: [practitionerId], siteIds: scopeList(caller) });
  const blocks = diary.items.filter((i) => i.kind === "block" && i.status === "booked");
  const exceptions = blocks.slice(0, 20).map((b) => {
    const label = `${b.title?.trim() || (b.blockKind ? BLOCK_KIND_LABELS[b.blockKind as BlockKind] : "Blocked")}, ${formatLondonTime(b.startsAt)}–${formatLondonTime(b.endsAt)}`;
    const bookingsToMove = diary.items.filter((i) => i.kind === "appointment" && occupiesDiary(i.status) && i.status === "booked" && spansOverlap(i, b)).length;
    return { id: b.id, date: b.startsOn, label, bookingsToMove };
  });
  return { ok: true, data: { practitionerId, days, rows, exceptions } };
}

/** The soonest freed slot at the site in the coming week, with the waiting-list entries that suit it. */
export async function loadFreedSlot(
  caller: DiaryCaller,
  siteId: string,
  entries: { id: string; practitionerId: string | null; serviceId: string | null; preferredDays: number[]; preferredTime: string; earliestOn: string | null; latestOn: string | null }[],
): Promise<FreedSlot | null> {
  if (!caller.can("diary.view")) return null;
  const { ctx, tenantId } = caller;
  const now = nowIso(ctx);
  const today = londonDate(now);
  const range = londonRange(today, 7);
  const diary = await listDiary(ctx, tenantId, { ...range, siteId, includeCancelled: true, appointmentsOnly: false });
  const occupying = diary.items.filter((i) => occupiesDiary(i.status));
  const freed = diary.items
    .filter((i) => i.kind === "appointment" && (i.status === "cancelled" || i.status === "late_cancelled") && i.practitionerId && i.startsAt > now)
    .filter((i) => !occupying.some((o) => (o.practitionerId === i.practitionerId || (i.roomId && o.roomId === i.roomId)) && spansOverlap(o, i)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!freed || !freed.practitionerId) return null;
  const names = await getPatientSummaries(ctx, tenantId, freed.patientId && caller.can("patients.view") ? [freed.patientId] : []);
  const who = freed.patientId ? names.get(freed.patientId) : undefined;
  const length = (Date.parse(freed.endsAt) - Date.parse(freed.startsAt)) / 60_000;
  const start = londonParts(freed.startsAt).minute;
  const matches: string[] = [];
  for (const e of entries) {
    if (e.practitionerId && e.practitionerId !== freed.practitionerId) continue;
    if (!slotSuits({ date: freed.startsOn, startMinute: start }, { preferredDays: e.preferredDays, preferredTime: e.preferredTime as "any", earliestOn: e.earliestOn, latestOn: e.latestOn })) continue;
    if (e.serviceId) {
      const s = await getService(ctx, tenantId, e.serviceId);
      if (s && s.durationMinutes > length) continue;
    }
    matches.push(e.id);
  }
  const { practitionerName } = await (async () => {
    const p = await ctx.db.selectFrom("pms_practitioners").select("display_name").where("tenant_id", "=", tenantId).where("id", "=", freed.practitionerId as string).executeTakeFirst();
    return { practitionerName: p?.display_name ?? null };
  })();
  return {
    appointmentId: freed.id,
    date: freed.startsOn,
    time: formatHhmm(start),
    endTime: formatLondonTime(freed.endsAt),
    practitionerId: freed.practitionerId,
    practitionerName,
    siteId: freed.siteId,
    roomId: freed.roomId,
    reason: `${who ? `${patientDisplayName(who)}'s ` : "A "}${freed.status === "late_cancelled" ? "late cancellation" : "cancellation"}`,
    matches,
  };
}
