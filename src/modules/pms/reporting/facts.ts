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

/* ------------------------------------------------------------------------------------------------
 * PK06 – courses, gift cards, products and stock (billing's source; docs/clinic-system/courses-giftcards-products.md)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Courses still open on the "as at" date (sold on or before it, not cancelled by the end of it, not past their
 * expiry on it), grouped by the site of the invoice that sold them, expiry, sessions sold and used (uses dated on or
 * before the date and not reversed by its end) and the sale line's value net of credit notes issued by then.
 */
export interface CourseFact {
  siteId: string | null;
  /** null = no expiry. */
  expiresOn: string | null;
  sessionsTotal: number;
  sessionsUsed: number;
  /** The sale line's total (VAT included) less credit notes on it issued by the date, per course. */
  netPence: number;
  courses: number;
}

/** Courses sold (their invoice issued) on one UK date at one site – cancelled ones included (they were sold). */
export interface CourseSaleFact {
  date: string;
  siteId: string | null;
  courses: number;
  amountPence: number;
}

export const GIFT_CARD_FACT_KINDS = ["sale", "redeem", "refund", "expire", "adjust"] as const;
export type GiftCardFactKind = (typeof GIFT_CARD_FACT_KINDS)[number];

/**
 * Gift-card balance moves up to the end of the "as at" date, by the site of the invoice that sold the card, the
 * card's expiry, the kind of move and whether it was before the period ("before") or in it ("in"). A sale counts on
 * the card's sale date (the invoice's date); other moves on when they were recorded. Amounts are signed (a sale is
 * +, a spend −), so the sum of a card's moves is its balance.
 */
export interface GiftCardFact {
  siteId: string | null;
  expiresOn: string | null;
  kind: GiftCardFactKind;
  when: "before" | "in";
  moves: number;
  amountPence: number;
}

/**
 * Products sold on issued invoices (void ones left out) by issue date, or credited by credit notes (the void kind
 * and anything on a void invoice left out) by the credit note's date – per site and product. `quantity` of a
 * credit is the units given back (a line credited in full), 0 for a part credit.
 */
export interface ProductSaleFact {
  date: string;
  siteId: string | null;
  productId: string;
  kind: "sold" | "credited";
  lines: number;
  quantity: number;
  netPence: number;
  vatPence: number;
}

/** Stock on hand NOW of one product at one site (the sum of its moves; may be negative). */
export interface StockFact {
  siteId: string;
  productId: string;
  onHand: number;
}

/** A product as the reports name it (archived ones too: history points at them). */
export interface ReportProduct {
  id: string;
  name: string;
  sku: string | null;
  pricePence: number;
  lowStockAt: number | null;
  active: boolean;
}
