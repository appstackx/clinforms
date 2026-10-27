/**
 * The diary screen's data (serialisable, sent from the server page to the client components) and its address
 * (URL parameters). Pure. Only what the grid needs leaves the server: a patient's name and number, never the
 * date of birth, contact details or notes (the appointment dialog fetches those when it opens).
 */
import type { AppointmentSource, AppointmentStatus, BlockKind, CancelReason, DiaryItemKind, OfferStatus, TimeOfDay, WaitingPriority, WaitingStatus } from "./rules";
import { addDays, isIsoDay, mondayOf } from "./time";

export type DiaryView = "day" | "week";
export type DiaryBy = "practitioner" | "room";

export interface DiaryParams {
  date: string;
  view: DiaryView;
  by: DiaryBy;
  siteId: string | null;
  /** Week view: the practitioner or room shown. */
  resourceId: string | null;
  showCancelled: boolean;
  /** An item to highlight (quick search, links from the patient record). */
  focusId: string | null;
  /** Open the booking form for this waiting-list entry. */
  bookFromWaitingId: string | null;
}

export function parseDiaryParams(searchParams: Record<string, string | string[] | undefined>, today: string): DiaryParams {
  const one = (k: string) => {
    const v = searchParams[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.length <= 64 ? s : null;
  };
  const id = (k: string) => {
    const v = one(k);
    return v && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v) ? v : null;
  };
  const date = one("date");
  return {
    date: date && isIsoDay(date) && date >= "2000-01-01" && date <= "2099-12-31" ? date : today,
    view: one("view") === "week" ? "week" : "day",
    by: one("by") === "room" ? "room" : "practitioner",
    siteId: id("site"),
    resourceId: id("resource"),
    showCancelled: one("cancelled") === "1",
    focusId: id("focus"),
    bookFromWaitingId: id("book"),
  };
}

/** The diary's address for a set of parameters (only what differs from the defaults). */
export function diaryHref(base: string, p: Partial<DiaryParams> & { date: string }): string {
  const q = new URLSearchParams();
  q.set("date", p.date);
  if (p.view === "week") q.set("view", "week");
  if (p.by === "room") q.set("by", "room");
  if (p.siteId) q.set("site", p.siteId);
  if (p.resourceId) q.set("resource", p.resourceId);
  if (p.showCancelled) q.set("cancelled", "1");
  if (p.focusId) q.set("focus", p.focusId);
  if (p.bookFromWaitingId) q.set("book", p.bookFromWaitingId);
  return `${base}?${q.toString()}`;
}

/** The date one step back or forward (a day, or a week in week view). */
export function stepDate(p: Pick<DiaryParams, "date" | "view">, direction: -1 | 1): string {
  return p.view === "week" ? addDays(mondayOf(p.date), 7 * direction) : addDays(p.date, direction);
}

export interface DiaryOption {
  id: string;
  name: string;
}

export interface DiaryPractitionerOption extends DiaryOption {
  colour: string | null;
  defaultSiteId: string | null;
}

export interface DiaryRoomOption extends DiaryOption {
  siteId: string;
}

export interface DiaryServiceOption extends DiaryOption {
  durationMinutes: number;
  colour: string | null;
}

export interface DiarySiteOption extends DiaryOption {
  code: string | null;
}

/** One column of the grid: a practitioner or a room on a date (day view), or a date of one resource (week view). */
export interface DiaryColumn {
  key: string;
  date: string;
  label: string;
  sublabel: string | null;
  siteId: string;
  practitionerId: string | null;
  roomId: string | null;
  /** Working windows in this column (local minutes) – the grid shades the hours outside them. */
  windows: { startMinute: number; endMinute: number; siteId: string }[];
  /**
   * Free slots of `slotMinutes` inside the windows (nothing of the practitioner – at any site – or of the room in
   * the way, none in the past). Empty in a column without a rota.
   */
  freeSlots: DiaryFreeSlot[];
}

export interface DiaryFreeSlot {
  startMinute: number;
  endMinute: number;
  startsAt: string;
  practitionerId: string;
  roomId: string | null;
}

/** An item as the grid draws it. */
export interface DiaryCard {
  id: string;
  rev: number;
  kind: DiaryItemKind;
  status: AppointmentStatus;
  columnKey: string;
  startsAt: string;
  endsAt: string;
  startsOn: string;
  timeLabel: string;
  siteId: string;
  siteCode: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  roomId: string | null;
  roomName: string | null;
  patientId: string | null;
  patientName: string | null;
  patientNumber: number | null;
  hasAlerts: boolean;
  serviceId: string | null;
  serviceName: string | null;
  caseId: string | null;
  authorisationId: string | null;
  seriesId: string | null;
  blockKind: BlockKind | null;
  title: string | null;
  hasNotes: boolean;
  feeDue: boolean;
  source: AppointmentSource;
}

export interface DiaryBookingPreset {
  waitingListId: string | null;
  patientId: string;
  patientName: string;
  serviceId: string | null;
  practitionerId: string | null;
  siteId: string | null;
  caseId: string | null;
}

export interface DiaryViewData {
  params: DiaryParams;
  today: string;
  /** Monday … of the week shown (week view) or the one date (day view). */
  dates: string[];
  sites: DiarySiteOption[];
  site: DiarySiteOption | null;
  practitioners: DiaryPractitionerOption[];
  rooms: DiaryRoomOption[];
  services: DiaryServiceOption[];
  columns: DiaryColumn[];
  cards: DiaryCard[];
  /** Grid hours (local minutes). */
  hours: { start: number; end: number };
  truncated: boolean;
  /** Length of the free slots shown (minutes). */
  slotMinutes: number;
  waitingCount: number;
  bookingPreset: DiaryBookingPreset | null;
}

/** The appointment dialog's data (GET …/diary/api/appointments/[id]): notes decrypted, the patient identified. */
export interface AppointmentDetailsView {
  id: string;
  rev: number;
  kind: DiaryItemKind;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  startsOn: string;
  /** "09:00" (UK) and the length, for the move form. */
  startTime: string;
  durationMinutes: number;
  siteId: string;
  siteName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  roomId: string | null;
  roomName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  blockKind: BlockKind | null;
  title: string | null;
  notes: string | null;
  cancelNote: string | null;
  cancelReason: string | null;
  feeDue: boolean;
  feePence: number | null;
  source: AppointmentSource;
  authSessionUsed: boolean;
  patient: { id: string; name: string; number: number; dateOfBirth: string | null; phone: string | null; hasAlerts: boolean } | null;
  caseId: string | null;
  caseTitle: string | null;
  authorisation: { id: string; code: string; sessionsAuthorised: number | null; sessionsUsed: number; expiresOn: string | null } | null;
  /** The patient's open cases and their active authorisations (to change the link). */
  cases: { id: string; title: string }[];
  authorisations: { id: string; caseId: string; code: string; sessionsLeft: number | null }[];
  seriesId: string | null;
  /** Booked appointments of the series from this one on. */
  seriesLater: number;
  nextStatuses: AppointmentStatus[];
  canMove: boolean;
  /** Cancelling now would be a late cancellation (the fee is ticked by default). */
  lateIfCancelledNow: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * The printable day sheet (paper fallback): names, times, rooms – never notes, dates of birth or contacts
 * ----------------------------------------------------------------------------------------------*/

export interface DaySheetRow {
  id: string;
  kind: DiaryItemKind;
  startTime: string;
  endTime: string;
  roomName: string | null;
  patientName: string | null;
  patientNumber: number | null;
  serviceName: string | null;
  status: AppointmentStatus;
  statusLabel: string;
  /** Blocked time: "Leave", "Meeting" … and its short label. */
  blockLabel: string | null;
  title: string | null;
}

export interface DaySheetGroup {
  practitionerId: string | null;
  /** "Rooms" for blocked rooms without a practitioner. */
  practitionerName: string;
  /** Working hours on the day ("09:00–13:00, 14:00–17:30") or null. */
  hours: string | null;
  rows: DaySheetRow[];
}

export interface DaySheet {
  date: string;
  dateLabel: string;
  site: { id: string; name: string; code: string | null; address: string[] | null; postcode: string | null; phone: string | null };
  /** When the sheet was made (UK time "DD/MM/YYYY HH:MM") – a printed sheet goes out of date. */
  printedAt: string;
  groups: DaySheetGroup[];
  /** Cancelled appointments are left out unless asked for. */
  includesCancelled: boolean;
  truncated: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * The patient record's Appointments tab
 * ----------------------------------------------------------------------------------------------*/

export interface PatientAppointmentRow {
  id: string;
  rev: number;
  status: AppointmentStatus;
  statusLabel: string;
  startsAt: string;
  startsOn: string;
  /** "Mon 26/10/2026" */
  dateLabel: string;
  /** "09:00–09:30" */
  timeLabel: string;
  durationMinutes: number;
  siteId: string;
  siteName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  roomName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  caseId: string | null;
  seriesId: string | null;
  feeDue: boolean;
  feePence: number | null;
  cancelReason: CancelReason | null;
  cancelReasonLabel: string | null;
  source: AppointmentSource;
  hasNotes: boolean;
  canMove: boolean;
  nextStatuses: AppointmentStatus[];
}

export interface PatientAppointmentsView {
  patientId: string;
  /** From now on, soonest first. */
  upcoming: PatientAppointmentRow[];
  /** Before now, newest first. */
  past: PatientAppointmentRow[];
  /** All of the patient's appointments (at the member's sites) per status. */
  counts: Record<AppointmentStatus, number>;
  /** Pass as `before` for the next (older) page; null = no more. */
  nextBefore: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Waiting list and rotas
 * ----------------------------------------------------------------------------------------------*/

export interface WaitingListRow {
  id: string;
  rev: number;
  status: WaitingStatus;
  statusLabel: string;
  priority: WaitingPriority;
  priorityLabel: string;
  patientId: string;
  patientName: string | null;
  patientNumber: number | null;
  serviceId: string | null;
  serviceName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  siteId: string | null;
  siteName: string | null;
  preferredDays: number[];
  preferredTime: TimeOfDay;
  /** "Tue, Thu · Mornings" or "Any day · Any time". */
  preferenceLabel: string;
  earliestOn: string | null;
  latestOn: string | null;
  /** Whole days since the entry was added. */
  waitingDays: number;
  hasNotes: boolean;
  openOffers: number;
  createdAt: string;
}

export interface WaitingListOfferRow {
  id: string;
  status: OfferStatus;
  statusLabel: string;
  dateLabel: string;
  timeLabel: string;
  siteName: string | null;
  practitionerName: string | null;
  roomName: string | null;
  appointmentId: string | null;
  createdAt: string;
}

export interface WaitingListEntryView {
  row: WaitingListRow;
  caseId: string | null;
  /** Decrypted. */
  notes: string | null;
  removedReason: string | null;
  offers: WaitingListOfferRow[];
  /** Free slots that suit the entry (site, practitioner, type, days, time of day, dates) – to offer one. */
  suggestions: { date: string; dateLabel: string; time: string; practitionerId: string; practitionerName: string | null; siteId: string; roomId: string | null }[];
}

export interface RotaRow {
  id: string;
  rev: number;
  practitionerId: string;
  practitionerName: string | null;
  siteId: string;
  siteName: string | null;
  roomId: string | null;
  roomName: string | null;
  weekday: number;
  weekdayName: string;
  startTime: string;
  endTime: string;
  everyWeeks: number;
  validFrom: string;
  validTo: string | null;
  onlineBookable: boolean;
}
