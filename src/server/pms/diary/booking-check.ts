/**
 * The booking dialog's live check, before anything is booked: is the chosen time free for the practitioner, the
 * room and the patient; if not, what is in the way (in plain words, with proper names) and the next free slot of the
 * same length with that practitioner; for a recurring booking, which dates are free and which would be skipped
 * (and why – another appointment, leave, a meeting). Reads only; the booking itself checks again in the database.
 * diary.book; names of other patients only for roles that may see patients. Server only.
 */
import "server-only";
import { z } from "zod";
import { PMS_ID_PATTERN } from "../../../modules/pms/core/ids";
import { PmsIdSchema } from "../../../modules/pms/core/schemas";
import { formatUkDate } from "../../../modules/pms/core/text";
import { BLOCK_KIND_LABELS, DIARY_COPY } from "../../../modules/pms/diary/copy";
import { findClashes, isOverridableClash, MAX_APPOINTMENT_MINUTES, OCCUPYING_STATUSES, recurringDates, withinWorkingHours, type BlockKind, type DiaryClash, type DiaryItemKind } from "../../../modules/pms/diary/rules";
import { IsoDateSchema } from "../../../modules/pms/core/schemas";
import { RepeatSchema, TimeSchema } from "../../../modules/pms/diary/schemas";
import { addMinutesIso, formatHhmm, isoWeekday, weekdayName, formatLondonTime, londonDate, londonParts, londonToUtc, parseHhmm } from "../../../modules/pms/diary/time";
import type { DiaryRead } from "../../../modules/pms/diary/types";
import type { BookingCheck, BookingCheckOccurrence } from "../../../modules/pms/diary/view";
import { availabilityWindows } from "../../repos/pms/diary/availability";
import { findFreeSlots } from "../../repos/pms/diary/slots";
import { getPractitioner, getRoom, getService } from "../../repos/pms/directory";
import { getPatientSummaries } from "../../repos/pms/patients";
import { inScope, scopeList, type DiaryCaller } from "./caller";
import { patientDisplayName } from "./view";

export const BookingCheckSchema = z.object({
  patientId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  serviceId: PmsIdSchema,
  practitionerId: PmsIdSchema,
  siteId: PmsIdSchema,
  roomId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  date: IsoDateSchema,
  startTime: TimeSchema,
  durationMinutes: z.number().int().min(5).max(MAX_APPOINTMENT_MINUTES).optional(),
  repeat: z.union([RepeatSchema, z.null()]).optional(),
});
export type BookingCheckRequest = z.input<typeof BookingCheckSchema>;

interface Occupant {
  id: string;
  kind: DiaryItemKind;
  status: string;
  startsAt: string;
  endsAt: string;
  practitionerId: string | null;
  roomId: string | null;
  patientId: string | null;
  blockKind: string | null;
  title: string | null;
}

/** "Tue 03/11/2026" (the booking dialog's dates). */
export function weekdayDate(date: string): string {
  return `${weekdayName(isoWeekday(date)).slice(0, 3)} ${formatUkDate(date)}`;
}

const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export async function checkBookingFor(caller: DiaryCaller, input: unknown): Promise<DiaryRead<BookingCheck>> {
  if (!caller.can("diary.book")) return { ok: false, status: 403, error: DIARY_COPY.notAllowed };
  const parsed = BookingCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 404, error: DIARY_COPY.checkFields };
  const q = parsed.data;
  if (!inScope(caller, q.siteId)) return { ok: false, status: 404, error: DIARY_COPY.notAtYourSites };
  const { ctx, tenantId } = caller;
  const [service, practitioner, room] = await Promise.all([getService(ctx, tenantId, q.serviceId), getPractitioner(ctx, tenantId, q.practitionerId), q.roomId ? getRoom(ctx, tenantId, q.roomId) : null]);
  if (!service || !practitioner) return { ok: false, status: 404, error: DIARY_COPY.recordGone };
  const duration = q.durationMinutes ?? service.durationMinutes;
  const startMinute = parseHhmm(q.startTime) ?? 0;
  const dates = q.repeat ? recurringDates(q.date, q.repeat.intervalWeeks, q.repeat.occurrences) : [q.date];
  const spans = dates.map((date) => {
    const r = londonToUtc(date, startMinute);
    return r.ok ? { date, startsAt: r.iso, endsAt: addMinutesIso(r.iso, duration) } : { date, startsAt: null, endsAt: null };
  });
  const real = spans.filter((s): s is { date: string; startsAt: string; endsAt: string } => s.startsAt !== null);

  // Everything that keeps its slot near these times, of this practitioner, this room or this patient.
  const occupants: Occupant[] = [];
  if (real.length > 0) {
    const from = real[0].startsAt;
    const to = real[real.length - 1].endsAt;
    const lookBack = new Date(Date.parse(from) - 24 * 3_600_000).toISOString();
    const rows = await ctx.db
      .selectFrom("pms_appointments")
      .select(["id", "kind", "status", "starts_at", "ends_at", "practitioner_id", "room_id", "patient_id", "block_kind", "title"])
      .where("tenant_id", "=", tenantId)
      .where("status", "in", OCCUPYING_STATUSES as unknown as string[])
      .where("starts_at", "<", to)
      .where("starts_at", ">", lookBack)
      .where("ends_at", ">", from)
      .where((eb) => {
        const ors = [eb("practitioner_id", "=", q.practitionerId)];
        if (q.roomId) ors.push(eb("room_id", "=", q.roomId));
        if (q.patientId) ors.push(eb("patient_id", "=", q.patientId));
        return eb.or(ors);
      })
      .limit(500)
      .execute();
    for (const r of rows) {
      occupants.push({ id: r.id, kind: r.kind as DiaryItemKind, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at, practitionerId: r.practitioner_id, roomId: r.room_id, patientId: r.patient_id, blockKind: r.block_kind, title: r.title });
    }
  }
  const byId = new Map(occupants.map((o) => [o.id, o]));
  const otherPatients = caller.can("patients.view") ? await getPatientSummaries(ctx, tenantId, occupants.map((o) => o.patientId).filter((id): id is string => id !== null)) : new Map<string, never>();
  const nameOfPatient = (id: string | null) => {
    const p = id ? otherPatients.get(id) : undefined;
    return p ? patientDisplayName(p) : "another patient";
  };
  const windows = await availabilityWindows(ctx, tenantId, dates, { practitionerIds: [q.practitionerId] });

  const describe = (c: DiaryClash): string => {
    const o = byId.get(c.withId);
    if (c.withKind === "block") {
      const what = o?.title?.trim() || (o?.blockKind ? BLOCK_KIND_LABELS[o.blockKind as BlockKind] : "blocked time");
      const who = c.resource === "room" ? (room?.name ?? "the room") : practitioner.displayName;
      return `${who} – ${lower1(what)}`;
    }
    if (c.resource === "patient") return `the patient's own appointment ${formatLondonTime(c.startsAt)}`;
    return `clashes with ${nameOfPatient(o?.patientId ?? null)} ${formatLondonTime(c.startsAt)}`;
  };

  const occurrence = (s: (typeof spans)[number]): BookingCheckOccurrence & { clashes: DiaryClash[] } => {
    const dateLabel = weekdayDate(s.date);
    if (!s.startsAt || !s.endsAt) return { date: s.date, dateLabel, status: "gap", note: "That time does not exist on this date (the clocks change)", patientOnly: false, overridable: false, outsideHours: false, clashes: [] };
    const clashes = findClashes({ startsAt: s.startsAt, endsAt: s.endsAt, practitionerId: q.practitionerId, roomId: q.roomId ?? null, patientId: q.patientId ?? null }, occupants);
    const outsideHours = !withinWorkingHours(windows, q.practitionerId, s.date, startMinute, startMinute + duration);
    if (clashes.length === 0) return { date: s.date, dateLabel, status: "free", note: outsideHours ? "Free – outside working hours" : "Free", patientOnly: false, overridable: false, outsideHours, clashes };
    const main = clashes.find((c) => c.resource !== "patient") ?? clashes[0];
    const patientOnly = clashes.every((c) => c.resource === "patient");
    const status = main.withKind === "block" ? "unavailable" : "clash";
    const text = describe(main);
    const overridable = clashes.every(isOverridableClash);
    return { date: s.date, dateLabel, status, note: text.charAt(0).toUpperCase() + text.slice(1), patientOnly, overridable, outsideHours, clashes };
  };
  const all = spans.map(occurrence);
  const first = all[0];

  let clashText: string | null = null;
  if (first.clashes.length > 0) {
    const c = first.clashes.find((x) => x.resource !== "patient") ?? first.clashes[0];
    const o = byId.get(c.withId);
    const span = `${formatLondonTime(c.startsAt)}–${formatLondonTime(c.endsAt)}`;
    if (c.withKind === "block") {
      const what = o?.title?.trim() || (o?.blockKind ? BLOCK_KIND_LABELS[o.blockKind as BlockKind] : "Blocked time");
      clashText = `${c.resource === "room" ? (room?.name ?? "The room") : practitioner.displayName} is not available ${span} (${lower1(what)}).`;
    } else if (c.resource === "patient") {
      clashText = `${q.patientId ? nameOfPatient(q.patientId) : "The patient"} already has another appointment ${span}.`;
    } else if (c.resource === "room") {
      clashText = `${room?.name ?? "The room"} is in use ${span} (${nameOfPatient(o?.patientId ?? null)}).`;
    } else {
      clashText = `${practitioner.displayName} already has ${nameOfPatient(o?.patientId ?? null)}, ${span}${o?.roomId && room && o.roomId === room.id ? `, in ${room.name}` : ""}.`;
    }
  }

  let nextFree: BookingCheck["nextFree"] = null;
  if (first.status !== "free") {
    const slots = await findFreeSlots(ctx, tenantId, {
      fromDate: q.date,
      days: 14,
      durationMinutes: duration,
      siteId: q.siteId,
      siteIds: scopeList(caller),
      practitionerIds: [q.practitionerId],
      patientId: q.patientId ?? undefined,
      limit: 60,
    });
    const after = slots.find((s) => s.date > q.date || (s.date === q.date && s.startMinute >= startMinute)) ?? null;
    if (after) {
      const time = formatHhmm(after.startMinute);
      nextFree = { date: after.date, time, label: after.date === q.date ? time : `${weekdayDate(after.date)} ${time}` };
    }
  }

  const strip = ({ clashes: _c, ...rest }: BookingCheckOccurrence & { clashes: DiaryClash[] }): BookingCheckOccurrence => rest;
  return {
    ok: true,
    data: {
      startTime: formatHhmm(startMinute),
      endTime: formatHhmm((startMinute + duration) % 1440),
      durationMinutes: duration,
      first: strip(first),
      clashText,
      nextFree,
      occurrences: all.map(strip),
    },
  };
}

/** The London date and minute of an instant (for callers that hold instants). */
export function londonSlot(iso: string): { date: string; minute: number } {
  return { date: londonDate(iso), minute: londonParts(iso).minute };
}

export const isDiaryId = (v: unknown): v is string => typeof v === "string" && PMS_ID_PATTERN.test(v);
