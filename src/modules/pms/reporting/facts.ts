/**
 * What the reports read from other parts of the clinic system ("facts"). Pure types – the modules that own the
 * data (diary, billing) supply them through the reporting sources (src/server/pms/reporting/sources.ts); the
 * reports never read another module's tables directly, so a module can change its tables without breaking the
 * reports.
 *
 * Facts are AGGREGATES (counts and sums per month, site, room, practitioner…), not one row per appointment or
 * invoice: a year of a multi-site group is hundreds of thousands of appointments, far too many rows to move to
 * the app for every report. Ids are the clinic's own; amounts are whole pence; months "YYYY-MM" and dates
 * "YYYY-MM-DD" are UK calendar values (Europe/London).
 */
import type { PayerType } from "../core/types";

/**
 * What became of the appointments of a group:
 *   upcoming    – booked, still to come (starts at or after the report's "now")
 *   unrecorded  – booked, in the past, not marked yet
 *   attended    – the patient came
 *   dna         – did not attend, no notice
 *   late_cancel – cancelled inside the clinic's notice period (usually charged)
 *   cancelled   – cancelled in good time (the slot was freed: not in the attendance rates or utilisation)
 */
export const APPOINTMENT_OUTCOMES = ["upcoming", "unrecorded", "attended", "dna", "late_cancel", "cancelled"] as const;
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

/** Appointments of one month (and, from the diary's source, one UK date and service), site, room, practitioner and outcome. */
export interface AppointmentFact {
  month: string;
  /** The UK date ("YYYY-MM-DD") – weekly figures need it; facts without it count only in monthly figures. */
  date?: string;
  /** The appointment type (the service filter); absent = not known. */
  serviceId?: string | null;
  siteId: string | null;
  roomId: string | null;
  practitionerId: string | null;
  outcome: AppointmentOutcome;
  appointments: number;
  /** Booked minutes of those appointments. */
  minutes: number;
}

/**
 * A practitioner's available time in one month (or on one UK date) at one site, in minutes: the rota's windows
 * (inside the sites' opening hours, less closures) joined with the time actually booked, less blocked time (leave,
 * meetings…). A source that gives `bookedMinutes` has clipped the bookings itself (booked ≤ available: utilisation
 * never passes 100 %); without it the reports fall back on the appointments' own minutes.
 */
export interface AvailabilityFact {
  practitionerId: string;
  siteId: string | null;
  month: string;
  /** The UK date, when the source gives one. */
  date?: string;
  minutes: number;
  /** Minutes booked inside `minutes` (appointments that held their slot, overlaps once, blocked time out). */
  bookedMinutes?: number;
  /** Rota minutes taken away by blocked time (leave, meetings…) – shown, not used in the rate. */
  blockedMinutes?: number;
}

/**
 * Attended appointments of one UK date, site and practitioner, split by whether the appointment was the patient's
 * FIRST attended appointment ever (a new patient) or not (a returning patient's visit).
 */
export interface VisitFact {
  month: string;
  date: string;
  siteId: string | null;
  practitionerId: string | null;
  firstVisit: boolean;
  appointments: number;
}

/** Patients who attended in the period, split by whether their first attended appointment ever was in it. */
export interface AttendedPatientsFact {
  patients: number;
  newPatients: number;
}

export const REVENUE_KINDS = ["invoiced", "credited", "received"] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];

/**
 * Money of one month, site, practitioner, payer type and kind:
 *   invoiced – invoices issued in the month (void ones left out)
 *   credited – credit notes issued in the month
 *   received – payments received in the month (refunds negative)
 */
export interface RevenueFact {
  month: string;
  /** The UK date (issue / payment date), when the source gives one. */
  date?: string;
  siteId: string | null;
  practitionerId: string | null;
  payerType: PayerType;
  kind: RevenueKind;
  /** Invoices, credit notes or payments. */
  count: number;
  amountPence: number;
}

/** What is still owed today on invoices of one payer, site and due date (outstanding > 0 only). */
export interface DebtFact {
  payerType: PayerType;
  /** The insurer / MLC / solicitor / employer account; null for self-pay patients. */
  payerReferrerId: string | null;
  siteId: string | null;
  /** The due date (the issue date when there is none). */
  dueOn: string;
  invoices: number;
  outstandingPence: number;
}
