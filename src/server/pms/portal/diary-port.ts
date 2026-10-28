/**
 * How online booking talks to the diary (the portal's "diary port"). ONE appointment store: an online booking is a
 * diary appointment in pms_appointments, written by the diary's own repository, so the diary's clash rule (and its
 * database triggers) refuse an online booking over a reception booking and the reverse. The port is implemented by
 * the diary's adapter (src/server/pms/diary/portal-adapter.ts, wired at M7); tests may pass another.
 *
 *   freeSlots           – the diary's free slots (rota windows marked for online booking, minus every appointment
 *                         and blocked time of the practitioner or the window's room) – the SAME function the
 *                         diary's "next free slot" uses, so a time shown online is bookable by reception and back;
 *   book                – books the appointment (source "online", confirmation requested) with the portal's own
 *                         rows in the same atomic batch, then plans its messages (comms);
 *   cancel / move       – the diary's status change (cancelled, or late cancellation with the fee flag) and move;
 *   appointment(s)      – the patient's appointments as the portal shows them.
 */
import "server-only";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { BatchQuery } from "../../db/batch";
import type { RepoContext } from "../../repos/context";
import { diaryPortalAdapter } from "../diary/portal-adapter";

export interface PortalSlotQuery {
  /** First UK date ("YYYY-MM-DD") and how many days (1–28). */
  fromDate: string;
  days: number;
  siteId: string;
  practitionerIds: readonly string[];
  serviceId: string;
  stepMinutes: number;
  /** No slot before this instant (now + the clinic's minimum notice). */
  notBefore: string;
  /** No slot from this instant on (the horizon). */
  notAfter: string;
  limit: number;
  /** Leave out times this patient already has an appointment. */
  patientId?: string | null;
}

export interface PortalSlot {
  date: string;
  startMinute: number;
  startsAt: string;
  endsAt: string;
  practitionerId: string;
  siteId: string;
  roomId: string | null;
}

/** A diary appointment as the portal sees it (no notes, no clinical detail). */
export interface PortalAppointment {
  id: string;
  rev: number;
  patientId: string;
  siteId: string;
  practitionerId: string | null;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  /** The diary's status: booked, arrived, in_treatment, attended, dna, late_cancelled, cancelled. */
  status: string;
  source: string;
  feeDue: boolean;
}

export type PortalWriteResult = { ok: true; appointment: PortalAppointment } | { ok: false; reason: "clash" | "conflict" | "not_found" | "not_allowed" };

export interface PortalBookInput {
  patientId: string;
  siteId: string;
  practitionerId: string;
  roomId: string | null;
  serviceId: string;
  /** The slot's UK date and minute of the day. */
  date: string;
  startMinute: number;
  /** A booking note for reception (never clinical). */
  notes: string | null;
}

export interface PortalDiaryPort {
  /** Which practitioners have current rota hours marked for online booking at which sites. */
  onlineRota(ctx: RepoContext, tenantId: string, today: string): Promise<{ practitionerId: string; siteId: string }[]>;
  freeSlots(ctx: RepoContext, tenantId: string, q: PortalSlotQuery): Promise<PortalSlot[]>;
  book(ctx: RepoContext, tenantId: string, input: PortalBookInput, actor: PmsActor, alsoWrite: (appointmentId: string) => BatchQuery[]): Promise<PortalWriteResult>;
  cancel(ctx: RepoContext, tenantId: string, appointmentId: string, expectedRev: number, change: { late: boolean }, actor: PmsActor): Promise<PortalWriteResult>;
  move(ctx: RepoContext, tenantId: string, appointmentId: string, expectedRev: number, to: { date: string; startMinute: number; practitionerId: string; roomId: string | null }, actor: PmsActor): Promise<PortalWriteResult>;
  appointment(ctx: RepoContext, tenantId: string, id: string): Promise<PortalAppointment | null>;
  patientAppointments(ctx: RepoContext, tenantId: string, patientId: string, options: { fromIso?: string; limit?: number }): Promise<PortalAppointment[]>;
}

/** The diary (always – there is one appointment store). */
export function portalDiary(): PortalDiaryPort {
  return diaryPortalAdapter;
}
