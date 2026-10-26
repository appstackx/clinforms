/**
 * Diary records as the repositories return them (camelCase, decrypted only where the type says so). Pure types.
 */
import type { PmsSaveResult } from "../core/types";
import type {
  AppointmentSource,
  AppointmentStatus,
  BlockKind,
  CancelReason,
  DiaryClash,
  DiaryItemKind,
  RotaRule,
  TimeOfDay,
  WaitingPriority,
  WaitingStatus,
} from "./rules";

/** One item of the diary – an appointment or blocked time – as lists and the grid show it (nothing decrypted). */
export interface DiaryItem {
  tenantId: string;
  id: string;
  rev: number;
  kind: DiaryItemKind;
  siteId: string;
  practitionerId: string | null;
  roomId: string | null;
  patientId: string | null;
  caseId: string | null;
  serviceId: string | null;
  authorisationId: string | null;
  seriesId: string | null;
  /** ISO-8601 UTC instants. */
  startsAt: string;
  endsAt: string;
  /** UK calendar date of the start ("YYYY-MM-DD"). */
  startsOn: string;
  status: AppointmentStatus;
  blockKind: BlockKind | null;
  /** Short label of blocked time. */
  title: string | null;
  /** True when the item carries a booking note (the text itself needs getAppointment). */
  hasNotes: boolean;
  source: AppointmentSource;
  feeDue: boolean;
  feePence: number | null;
  /** A session of the linked authorisation was counted when the appointment was marked attended. */
  authSessionUsed: boolean;
  cancelReason: CancelReason | null;
  updatedAt: string;
}

/** The full item (getAppointment): notes decrypted, who changed the status and when. */
export interface Appointment extends DiaryItem {
  notes: string | null;
  cancelNote: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  statusAt: string | null;
  statusBy: string | null;
  importRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AppointmentSeries {
  tenantId: string;
  id: string;
  intervalWeeks: number;
  occurrences: number;
  createdAt: string;
}

/** A rota entry: when a practitioner works at a site (and in which room by default). */
export interface AvailabilityRule extends RotaRule {
  tenantId: string;
  id: string;
  rev: number;
  onlineBookable: boolean;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A patient waiting for an appointment (lists: nothing decrypted). */
export interface WaitingListSummary {
  tenantId: string;
  id: string;
  rev: number;
  patientId: string;
  caseId: string | null;
  serviceId: string | null;
  practitionerId: string | null;
  siteId: string | null;
  priority: WaitingPriority;
  preferredDays: number[];
  preferredTime: TimeOfDay;
  earliestOn: string | null;
  latestOn: string | null;
  status: WaitingStatus;
  hasNotes: boolean;
  bookedAppointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaitingListEntry extends WaitingListSummary {
  /** Decrypted. */
  notes: string | null;
  removedReason: string | null;
  createdBy: string | null;
}

export type DiaryWarning = "outside_hours" | "authorisation_short" | "authorisation_used_up";

/** Outcome of a booking (one appointment or a recurring series – all or nothing unless skipClashes). */
export type BookResult =
  | { ok: true; items: DiaryItem[]; seriesId: string | null; skippedDates: string[]; warnings: DiaryWarning[] }
  | { ok: false; reason: "clash"; clashes: (DiaryClash & { date: string })[] };

/** Outcome of a move or a status change: the revision check, or a clash with another item. */
export type DiarySaveResult =
  | { ok: true; item: DiaryItem; warnings: DiaryWarning[] }
  | Exclude<PmsSaveResult, { ok: true }>
  | { ok: false; reason: "clash"; clashes: DiaryClash[] };

/** What the diary's server actions answer (plain words; the forms show them). */
export type DiaryActionResult =
  | { ok: true; message: string; warnings: string[]; itemId?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** What is in the way, in plain words. */
      clashes?: string[];
      /** A recurring booking whose free dates could still be booked. */
      canSkipClashes?: boolean;
      /** Only the patient clashes (two practitioners seeing them together can be allowed). */
      patientOnly?: boolean;
      /** The screen was stale: refresh it. */
      conflict?: boolean;
    };
