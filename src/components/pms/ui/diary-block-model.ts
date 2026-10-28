/**
 * Diary appointment blocks (design system v1): colours, hatching and the one-line collapse rule. Pure.
 *
 * - Blocks of 15 minutes or less collapse to one line (time, patient, status icon).
 * - Cancelled and late-cancelled blocks are hatched, so the slot reads as free; their patient name is crossed out.
 * - Blocked time (lunch, leave) is hatched grey and not bookable.
 */
import { APPOINTMENT_STATUS_STYLES, TONE_CLASSES, type StatusIcon } from "./status";

export type DiaryBlockStatus = "booked" | "arrived" | "in_treatment" | "completed" | "attended" | "dna" | "late_cancelled" | "cancelled" | "blocked";

export interface DiaryBlockStyle {
  /** Short tag on the block ("DNA", "Late cancel"). */
  tag: string;
  /** Full words for screen readers ("Did not attend"). */
  label: string;
  icon: StatusIcon;
  classes: string;
  hatched: boolean;
  strikeName: boolean;
}

export const COLLAPSE_MAX_MINUTES = 15;

/** Whether a block of this length shows on one line. */
export function isCollapsedBlock(minutes: number): boolean {
  return Number.isFinite(minutes) && minutes <= COLLAPSE_MAX_MINUTES;
}

/** "09:00" → minutes after midnight; null when not HH:MM. */
export function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Length of a block from its start and end ("09:00", "09:45" → 45); null when either is not a time. */
export function blockMinutes(start: string, end: string): number | null {
  const a = minutesOf(start);
  const b = minutesOf(end);
  return a === null || b === null ? null : b - a;
}

const tone = (t: keyof typeof TONE_CLASSES) => `${TONE_CLASSES[t].fill} ${TONE_CLASSES[t].text} ${TONE_CLASSES[t].border}`;

const STYLES: Readonly<Record<DiaryBlockStatus, DiaryBlockStyle>> = {
  booked: { tag: "Booked", label: "Booked", icon: "calendar", classes: tone("blue"), hatched: false, strikeName: false },
  arrived: { tag: "Arrived", label: "Arrived", icon: "user-check", classes: tone("amber"), hatched: false, strikeName: false },
  in_treatment: { tag: "In treatment", label: "In treatment", icon: "activity", classes: tone("teal"), hatched: false, strikeName: false },
  completed: { tag: "Completed", label: "Completed", icon: "check-circle", classes: tone("green"), hatched: false, strikeName: false },
  attended: { tag: "Attended", label: "Attended", icon: "check-circle", classes: tone("green"), hatched: false, strikeName: false },
  dna: { tag: "DNA", label: "Did not attend", icon: "user-x", classes: tone("red"), hatched: false, strikeName: false },
  late_cancelled: {
    tag: "Late cancel",
    label: APPOINTMENT_STATUS_STYLES.late_cancelled.label,
    icon: "calendar-x",
    classes: "bg-[repeating-linear-gradient(135deg,#FFF7ED_0_6px,#FFEDD5_6px_12px)] text-[#9A3412] border-[#FDBA74]",
    hatched: true,
    strikeName: true,
  },
  cancelled: {
    tag: "Cancelled",
    label: "Cancelled",
    icon: "x-circle",
    classes: "bg-[repeating-linear-gradient(135deg,#F8FAFC_0_6px,#EEF2F6_6px_12px)] text-[#475569] border-[#CBD5E1]",
    hatched: true,
    strikeName: true,
  },
  blocked: {
    tag: "Blocked",
    label: "Blocked – not bookable",
    icon: "ban",
    classes: "bg-[repeating-linear-gradient(135deg,#F1F5F9_0_6px,#E2E8F0_6px_12px)] text-[#334155] border-[#CBD5E1]",
    hatched: true,
    strikeName: false,
  },
};

export function diaryBlockStyle(status: DiaryBlockStatus): DiaryBlockStyle {
  return STYLES[status] ?? STYLES.booked;
}
