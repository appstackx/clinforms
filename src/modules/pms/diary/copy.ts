/**
 * The diary's words (UK English, plain, neutral). Labels never rely on colour alone: every status has a text label
 * and a short tag shown on the appointment itself. Pure.
 */
import type { AppointmentStatus, BlockKind, CancelReason, ClashResource, TimeOfDay, WaitingPriority, WaitingStatus } from "./rules";
import type { DiaryWarning } from "./types";

export const STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  booked: "Booked",
  arrived: "Arrived",
  attended: "Attended",
  dna: "Did not attend",
  late_cancelled: "Late cancellation",
  cancelled: "Cancelled",
};

/** Short tags on the appointment card (with the full label for screen readers). */
export const STATUS_TAGS: Readonly<Record<AppointmentStatus, string>> = {
  booked: "Booked",
  arrived: "Arrived",
  attended: "Attended",
  dna: "DNA",
  late_cancelled: "Late cancel",
  cancelled: "Cancelled",
};

/** The button that moves an appointment to a status. */
export const STATUS_ACTIONS: Readonly<Record<AppointmentStatus, string>> = {
  booked: "Mark as booked",
  arrived: "Mark arrived",
  attended: "Mark attended",
  dna: "Did not attend",
  late_cancelled: "Late cancellation",
  cancelled: "Cancel appointment",
};

export const BLOCK_KIND_LABELS: Readonly<Record<BlockKind, string>> = {
  leave: "Leave",
  meeting: "Meeting",
  training: "Training",
  admin: "Admin time",
  closed: "Closed",
  other: "Unavailable",
};

export const CANCEL_REASON_LABELS: Readonly<Record<CancelReason, string>> = {
  patient: "Patient cancelled",
  clinic: "Clinic cancelled",
  practitioner_unavailable: "Practitioner unavailable",
  illness: "Illness",
  weather: "Weather or travel",
  other: "Other reason",
};

export const PRIORITY_LABELS: Readonly<Record<WaitingPriority, string>> = {
  urgent: "Urgent",
  soon: "Soon",
  routine: "Routine",
};

export const WAITING_STATUS_LABELS: Readonly<Record<WaitingStatus, string>> = {
  waiting: "Waiting",
  offered: "Offered a slot",
  booked: "Booked",
  removed: "Removed",
};

export const TIME_OF_DAY_LABELS: Readonly<Record<TimeOfDay, string>> = {
  any: "Any time",
  morning: "Mornings",
  afternoon: "Afternoons",
  evening: "Evenings",
};

export const CLASH_LABELS: Readonly<Record<ClashResource, string>> = {
  practitioner: "The practitioner is already booked",
  room: "The room is already in use",
  patient: "The patient already has an appointment",
};

export const WARNING_LABELS: Readonly<Record<DiaryWarning, string>> = {
  outside_hours: "Booked outside the practitioner's working hours.",
  authorisation_short: "The authorisation has fewer sessions left than were booked.",
  authorisation_used_up: "The authorisation has no sessions left, so this session was not counted against it.",
};

export const DIARY_COPY = {
  gap: "That time does not exist on this date (the clocks go forward an hour).",
  conflict: "Someone else changed this appointment a moment ago. The diary has been refreshed – check it and try again.",
  notFound: "This appointment no longer exists.",
  changedElsewhere: "Someone else changed this a moment ago. The page has been refreshed – check it and try again.",
  recordGone: "This no longer exists.",
  notAllowed: "You do not have permission to do that.",
  notAtYourSites: "That site is not one of yours.",
  checkFields: "Check the highlighted fields.",
  emptyDay: "Nothing booked yet.",
  noPractitioners: "No practitioners work at this site yet. Add them in the clinic's set-up first.",
  noSites: "The clinic has no sites yet. Add a site in the clinic's set-up first.",
  bookingNoteHint: "Shown in the diary to reception and practitioners. Not a clinical note.",
} as const;
