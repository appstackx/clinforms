/**
 * What the diary's repositories accept (zod v4) – the source of truth for the forms and the server actions. Pure.
 *
 * Times are UK wall-clock times ("HH:MM", 24-hour) on a UK calendar date; the repositories turn them into instants
 * (./time.ts, Europe/London incl. the clock changes). Free text (booking notes, cancellation notes, waiting-list
 * notes) is encrypted at rest by the repositories; the schemas only limit its size.
 */
import { z } from "zod";
import { ImportRefSchema, IsoDateSchema, OptionalDateSchema, OptionalMoneySchema, PmsIdSchema, optionalText } from "../core/schemas";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  BLOCK_KINDS,
  CANCEL_REASONS,
  DIARY_ITEM_KINDS,
  MAX_APPOINTMENT_MINUTES,
  MAX_ITEM_MINUTES,
  MAX_SERIES_INTERVAL_WEEKS,
  MAX_SERIES_OCCURRENCES,
  TIMES_OF_DAY,
  WAITING_PRIORITIES,
  WAITING_STATUSES,
} from "./rules";
import { isCanonicalIso, parseHhmm } from "./time";

/** "HH:MM", 24-hour, 00:00–23:59. */
export const TimeSchema = z.string().refine((v) => parseHhmm(v) !== null, "Enter a time as HH:MM (24-hour clock)");

/** An end time: "HH:MM" or "24:00" (midnight at the end of the day). */
export const EndTimeSchema = z.string().refine((v) => v.trim() === "24:00" || parseHhmm(v) !== null, "Enter a time as HH:MM (24-hour clock)");

/** Minutes of an end time ("24:00" → 1440). */
export function endMinuteOf(value: string): number {
  return value.trim() === "24:00" ? 1440 : (parseHhmm(value) ?? 0);
}

/** An optional link to another record: undefined = unchanged / not given, null or "" = none. */
export const optionalId = () => z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional());

export const ExpectedRevSchema = z.number().int("Whole number").min(1, "Revision must be 1 or more");

export const RepeatSchema = z.object({
  intervalWeeks: z.number().int().min(1, "At least every week").max(MAX_SERIES_INTERVAL_WEEKS, `At most every ${MAX_SERIES_INTERVAL_WEEKS} weeks`),
  occurrences: z.number().int().min(2, "At least 2 appointments").max(MAX_SERIES_OCCURRENCES, `At most ${MAX_SERIES_OCCURRENCES} appointments`),
});
export type RepeatInput = z.input<typeof RepeatSchema>;

/* ------------------------------------------------------------------------------------------------
 * Appointments
 * ----------------------------------------------------------------------------------------------*/

export const BookAppointmentSchema = z
  .object({
    patientId: PmsIdSchema,
    serviceId: PmsIdSchema,
    practitionerId: PmsIdSchema,
    siteId: PmsIdSchema,
    roomId: optionalId(),
    caseId: optionalId(),
    authorisationId: optionalId(),
    date: IsoDateSchema,
    startTime: TimeSchema,
    /** Default: the appointment type's length. */
    durationMinutes: z.number().int("Whole minutes").min(5, "At least 5 minutes").max(MAX_APPOINTMENT_MINUTES, `At most ${MAX_APPOINTMENT_MINUTES} minutes`).optional(),
    /** A booking note (shown in the diary – not a clinical note). */
    notes: optionalText(2000),
    repeat: z.union([RepeatSchema, z.null()]).optional(),
    source: z.enum(APPOINTMENT_SOURCES).optional(),
  })
  .refine((v) => !v.authorisationId || Boolean(v.caseId), { message: "Choose the case the authorisation belongs to", path: ["caseId"] });
export type BookAppointmentInput = z.input<typeof BookAppointmentSchema>;

export const MoveAppointmentSchema = z.object({
  expectedRev: ExpectedRevSchema,
  date: IsoDateSchema,
  startTime: TimeSchema,
  /** Default: unchanged. */
  durationMinutes: z.number().int("Whole minutes").min(5, "At least 5 minutes").max(MAX_ITEM_MINUTES, "At most 24 hours").optional(),
  /** undefined = unchanged. */
  practitionerId: optionalId(),
  /** undefined = unchanged (or none when the site changes), null = no room. */
  roomId: optionalId(),
  siteId: PmsIdSchema.optional(),
});
export type MoveAppointmentInput = z.input<typeof MoveAppointmentSchema>;

export const AppointmentStatusChangeSchema = z.object({
  expectedRev: ExpectedRevSchema,
  status: z.enum(APPOINTMENT_STATUSES),
  cancelReason: z.enum(CANCEL_REASONS).optional(),
  /** Why it was cancelled, in the clinic's words (encrypted). */
  cancelNote: optionalText(500),
  /** A late cancellation or a missed appointment the clinic charges for (billing picks these up). */
  feeDue: z.boolean().optional(),
  feePence: OptionalMoneySchema,
});
export type AppointmentStatusChange = z.input<typeof AppointmentStatusChangeSchema>;

export const AppointmentDetailsPatchSchema = z.object({
  notes: optionalText(2000),
  caseId: optionalId(),
  authorisationId: optionalId(),
  serviceId: PmsIdSchema.optional(),
});
export type AppointmentDetailsPatch = z.input<typeof AppointmentDetailsPatchSchema>;

/* ------------------------------------------------------------------------------------------------
 * Blocked time
 * ----------------------------------------------------------------------------------------------*/

export const BlockInputSchema = z
  .object({
    siteId: PmsIdSchema,
    practitionerId: optionalId(),
    roomId: optionalId(),
    blockKind: z.enum(BLOCK_KINDS),
    /** Short label shown in the diary ("Team meeting"). Not for patient details. */
    title: optionalText(80),
    notes: optionalText(500),
    date: IsoDateSchema,
    startTime: TimeSchema,
    endTime: EndTimeSchema,
  })
  .refine((v) => Boolean(v.practitionerId) || Boolean(v.roomId), { message: "Choose a practitioner or a room", path: ["practitionerId"] })
  .refine((v) => endMinuteOf(v.endTime) > (parseHhmm(v.startTime) ?? 0), { message: "The end must be after the start", path: ["endTime"] });
export type BlockInput = z.input<typeof BlockInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Rotas (availability)
 * ----------------------------------------------------------------------------------------------*/

const availabilityShape = {
  practitionerId: PmsIdSchema,
  siteId: PmsIdSchema,
  roomId: optionalId(),
  weekday: z.number().int().min(1, "Choose a day").max(7, "Choose a day"),
  startTime: TimeSchema,
  endTime: EndTimeSchema,
  everyWeeks: z.number().int().min(1, "Every 1–4 weeks").max(4, "Every 1–4 weeks").optional(),
  validFrom: IsoDateSchema,
  validTo: OptionalDateSchema,
  onlineBookable: z.boolean().optional(),
  importRef: ImportRefSchema,
};

export const AvailabilityInputSchema = z
  .object(availabilityShape)
  .refine((v) => endMinuteOf(v.endTime) > (parseHhmm(v.startTime) ?? 0), { message: "The end must be after the start", path: ["endTime"] })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, { message: "The last day must be on or after the first", path: ["validTo"] });
export type AvailabilityInput = z.input<typeof AvailabilityInputSchema>;

export const AvailabilityPatchSchema = z
  .object({
    roomId: optionalId(),
    startTime: TimeSchema.optional(),
    endTime: EndTimeSchema.optional(),
    everyWeeks: availabilityShape.everyWeeks,
    validTo: OptionalDateSchema,
    onlineBookable: z.boolean().optional(),
  })
  .refine((v) => !v.startTime || !v.endTime || endMinuteOf(v.endTime) > (parseHhmm(v.startTime) ?? 0), { message: "The end must be after the start", path: ["endTime"] });
export type AvailabilityPatch = z.input<typeof AvailabilityPatchSchema>;

/* ------------------------------------------------------------------------------------------------
 * Waiting list
 * ----------------------------------------------------------------------------------------------*/

const waitingShape = {
  patientId: PmsIdSchema,
  caseId: optionalId(),
  serviceId: optionalId(),
  practitionerId: optionalId(),
  siteId: optionalId(),
  priority: z.enum(WAITING_PRIORITIES).optional(),
  /** ISO weekdays the patient can come (none = any day). */
  preferredDays: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .optional()
    .transform((v) => (v ? Array.from(new Set(v)).sort((a, b) => a - b) : v)),
  preferredTime: z.enum(TIMES_OF_DAY).optional(),
  earliestOn: OptionalDateSchema,
  latestOn: OptionalDateSchema,
  /** Encrypted. */
  notes: optionalText(1000),
};

export const WaitingListInputSchema = z
  .object(waitingShape)
  .refine((v) => !v.earliestOn || !v.latestOn || v.earliestOn <= v.latestOn, { message: "The latest date must be on or after the earliest", path: ["latestOn"] });
export type WaitingListInput = z.input<typeof WaitingListInputSchema>;

const { patientId: _patient, ...waitingPatchShape } = waitingShape;
void _patient;
export const WaitingListPatchSchema = z.object(waitingPatchShape).partial();
export type WaitingListPatch = z.input<typeof WaitingListPatchSchema>;

export const WaitingListStatusSchema = z.object({
  expectedRev: ExpectedRevSchema,
  status: z.enum(WAITING_STATUSES).refine((s) => s !== "booked", "An entry is marked booked by booking the appointment"),
  reason: optionalText(200),
});
export type WaitingListStatusChange = z.input<typeof WaitingListStatusSchema>;

/* ------------------------------------------------------------------------------------------------
 * Bulk loads (demo seed, data import): instants already known
 * ----------------------------------------------------------------------------------------------*/

const IsoInstantSchema = z.string().refine(isCanonicalIso, "An ISO-8601 UTC time with milliseconds");

export const BulkDiaryItemSchema = z
  .object({
    kind: z.enum(DIARY_ITEM_KINDS),
    siteId: PmsIdSchema,
    practitionerId: optionalId(),
    roomId: optionalId(),
    patientId: optionalId(),
    caseId: optionalId(),
    serviceId: optionalId(),
    authorisationId: optionalId(),
    seriesId: optionalId(),
    startsAt: IsoInstantSchema,
    endsAt: IsoInstantSchema,
    status: z.enum(APPOINTMENT_STATUSES),
    blockKind: z.union([z.enum(BLOCK_KINDS), z.null()]).optional(),
    title: optionalText(80),
    notes: optionalText(2000),
    source: z.enum(APPOINTMENT_SOURCES).optional(),
    feeDue: z.boolean().optional(),
    cancelReason: z.union([z.enum(CANCEL_REASONS), z.null()]).optional(),
    authSessionUsed: z.boolean().optional(),
    importRef: ImportRefSchema,
  })
  .refine((v) => v.endsAt > v.startsAt && Date.parse(v.endsAt) - Date.parse(v.startsAt) <= MAX_ITEM_MINUTES * 60_000, { message: "Ends after it starts, within 24 hours", path: ["endsAt"] })
  .refine((v) => Boolean(v.practitionerId) || Boolean(v.roomId), { message: "A practitioner or a room", path: ["practitionerId"] })
  .refine((v) => v.kind === "block" || (Boolean(v.patientId) && Boolean(v.serviceId) && Boolean(v.practitionerId)), { message: "An appointment needs a patient, a type and a practitioner", path: ["patientId"] });
export type BulkDiaryItem = z.input<typeof BulkDiaryItemSchema>;
