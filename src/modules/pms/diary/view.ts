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
  /** Open the booking form for this patient (the patient record's "Book" button). */
  bookForPatientId: string | null;
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
    bookForPatientId: id("patient"),
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
  if (p.bookForPatientId) q.set("patient", p.bookForPatientId);
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
  /** The type's own price (pence); a payer's price list may differ. */
  pricePence: number | null;
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
   * Second line of the column header: the room the practitioner works in that day (practitioner columns), or the
   * practitioners in the room (room columns). Null when none.
   */
  detail: string | null;
  /** Share of the working time taken by appointments that keep their slot (0–100); null without a rota. */
  bookedPercent: number | null;
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
  /** A first appointment (the appointment type's category is "initial" or "assessment"): "+" before the type. */
  initial: boolean;
  /**
   * A logged double-booking (Khuram's decision A): the same practitioner's other appointments overlapping this one.
   * Both blocks show the clash marker. Empty for blocked time and in room-only clashes (rooms are never shared).
   */
  doubleBookedWith: DoubleBooking[];
}

/** The other appointment of a double-booked practitioner, as the marker and the drawer name it. */
export interface DoubleBooking {
  id: string;
  /** null for members who may not see patients. */
  patientName: string | null;
  /** "09:00–09:45" (UK). */
  timeLabel: string;
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
  /** Week view: what the week holds (appointments that keep their slot, share of working time booked, DNAs). */
  summary: { appointments: number; bookedPercent: number | null; dna: number } | null;
  /** The signed-in member's practitioner row, when they have one ("My diary"). */
  myPractitionerId: string | null;
  /** Slots held for waiting patients (open offers, until answered or the hold ends) – drawn so nobody books over them. */
  holds: DiaryHold[];
  /** Days the site is closed (Set-up → Sites and hours): the day view shows "Closed – <reason>". */
  closures: { date: string; reason: string | null }[];
}

/** A slot offered to a waiting patient and held for them (M9b). */
export interface DiaryHold {
  /** The offer's id. */
  id: string;
  waitingListId: string;
  columnKey: string;
  startsAt: string;
  endsAt: string;
  startsOn: string;
  timeLabel: string;
  /** "14:20" – when the hold ends by itself. */
  holdUntilLabel: string;
  holdUntil: string;
  /** Only for roles that may see patients. */
  patientName: string | null;
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
  /** Treatment was started (undoing "Completed" goes back to "In treatment"). */
  treatmentStarted: boolean;
  /** The practitioner's other appointments at the same time (a logged double-booking). */
  doubleBookedWith: DoubleBooking[];
  /** Cancelling now would be a late cancellation (the fee is ticked by default). */
  lateIfCancelledNow: boolean;
  /** A first appointment (the type's category is "initial" or "assessment"). */
  initial: boolean;
  /** The appointment type's price (pence) from the case's price list, else the type's own price. */
  pricePence: number | null;
  /** "Self-pay", or the payer account ("Bluewell Health (fictional) – excess £20.00"); null without a case. */
  payerLabel: string | null;
  /** The text of the patient's medical alerts (decrypted; roles that may see patients only). */
  alertText: string | null;
  /** Who booked it: a member's name, "the patient online" or "data import"; null when unknown. */
  bookedBy: string | null;
  bookedAt: string | null;
  /** Reception asked for a booking confirmation (sent by the messages module, when it is switched on). */
  confirmationRequested: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * The booking dialog's live check (before booking): is the time free, which dates of a series are free
 * ----------------------------------------------------------------------------------------------*/

export interface BookingCheckOccurrence {
  date: string;
  /** "Tue 03/11/2026" */
  dateLabel: string;
  status: "free" | "clash" | "unavailable" | "gap";
  /** "Free", "Clashes with Grace Kim 11:00", "Priya Shah – annual leave", "Outside working hours". */
  note: string;
  /** Only the patient's own other appointment is in the way (two practitioners can see them together). */
  patientOnly: boolean;
  /**
   * Everything in the way may be booked over with "diary.override" (the practitioner's other appointments, the
   * patient's own) – never a room or blocked time. Whether THIS member may is the dialog's `can.override`.
   */
  overridable: boolean;
  /** Outside the practitioner's rota (bookable, with a warning). */
  outsideHours: boolean;
}

export interface BookingCheck {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  /** The first date (the booking itself). */
  first: BookingCheckOccurrence;
  /** "Priya Shah already has Emily Turner, 11:00–11:45, in Room 1." */
  clashText: string | null;
  /** The next free slot of this length with this practitioner, from the time asked for. */
  nextFree: { date: string; time: string; label: string } | null;
  occurrences: BookingCheckOccurrence[];
}

/* ------------------------------------------------------------------------------------------------
 * The printable day sheet (paper fallback): names, times, rooms – never notes or contact details; dates of birth only
 * when the clinic switched "Show date of birth on the printed day sheet" on (diary settings, default off)
 * ----------------------------------------------------------------------------------------------*/

export interface DaySheetRow {
  id: string;
  /** The patient's record carries medical alerts (the text is never printed). */
  hasAlerts: boolean;
  /** "DD/MM/YYYY" – only when the clinic's diary setting prints dates of birth (default off); else null. */
  dateOfBirth: string | null;
  /** "Self-pay" or the payer account's name; null without a case. */
  payerLabel: string | null;
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
  /** The clinic prints dates of birth on the day sheet (diary setting, default off). */
  showsDateOfBirth: boolean;
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
  /** The latest open offer (the slot held for the patient until holdUntilLabel, while held). */
  offer: WaitingListOpenOffer | null;
  createdAt: string;
}

/** An entry's open offer as the waiting list shows it. */
export interface WaitingListOpenOffer {
  id: string;
  dateLabel: string;
  timeLabel: string;
  practitionerName: string | null;
  /** True while the hold has not ended. */
  held: boolean;
  /** "16:00" (today) or "Thu 29/10 16:00"; null when the offer holds nothing. */
  holdUntilLabel: string | null;
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
  held: boolean;
  holdUntilLabel: string | null;
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
