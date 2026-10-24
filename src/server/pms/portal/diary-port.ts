/**
 * How online booking talks to the diary. The diary module (built on its own branch) owns appointments, rotas and
 * blocked time; until it is connected, online bookings STAND ALONE: the slot engine sees only other online
 * bookings, and staff see online bookings on the Online booking page and the patient's record.
 *
 * Connecting the diary (integration step, one file): implement this interface with the diary's repositories and
 * pass it to setPortalDiary() at start-up (or replace `standaloneDiary` below):
 *   busy      – the diary's appointments and blocked time of these practitioners, each including its buffer;
 *   working   – the practitioners' rota as windows (null = no rota: the online hours alone decide);
 *   onBooked  – write the diary appointment for a new online booking (then setBookingAppointment() links it);
 *   onCancelled – cancel the linked diary appointment;
 *   patientAppointments – the patient's upcoming diary appointments not booked online (the portal lists them).
 * The database still refuses overlapping ONLINE bookings on its own; the diary must refuse an overlap with them
 * the same way (its own trigger) – see docs/clinic-system/portal.md.
 */
import "server-only";
import type { BusyInterval, WorkingWindow } from "../../../modules/pms/portal/slots";
import type { OnlineBooking } from "../../../modules/pms/portal/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { RepoContext } from "../../repos/context";

export interface DiaryAppointmentView {
  id: string;
  startsAt: string;
  endsAt: string;
  siteId: string;
  practitionerId: string;
  serviceId: string | null;
  status: string;
}

export interface PortalDiaryPort {
  readonly mode: "standalone" | "diary";
  busy(ctx: RepoContext, tenantId: string, practitionerIds: string[], fromIso: string, toIso: string): Promise<BusyInterval[]>;
  working(ctx: RepoContext, tenantId: string, practitionerIds: string[], fromIso: string, toIso: string): Promise<WorkingWindow[] | null>;
  onBooked?(ctx: RepoContext, tenantId: string, booking: OnlineBooking, actor: PmsActor): Promise<void>;
  onCancelled?(ctx: RepoContext, tenantId: string, booking: OnlineBooking, actor: PmsActor): Promise<void>;
  patientAppointments?(ctx: RepoContext, tenantId: string, patientId: string, fromIso: string): Promise<DiaryAppointmentView[]>;
}

export const standaloneDiary: PortalDiaryPort = {
  mode: "standalone",
  busy: async () => [],
  working: async () => null,
};

let current: PortalDiaryPort = standaloneDiary;

export function portalDiary(): PortalDiaryPort {
  return current;
}

/** Connects the diary (integration) – or a stand-in in tests. Returns the previous port. */
export function setPortalDiary(port: PortalDiaryPort): PortalDiaryPort {
  const previous = current;
  current = port;
  return previous;
}
