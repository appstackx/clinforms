/**
 * Invoicing from appointments. The diary module owns appointments; billing sees them as BillableVisits through a
 * source (src/server/pms/billing/visit-source.ts) and turns each into an invoice line here. Pure.
 *
 * - attended → the full price; did not attend / late cancellation → the clinic's percentage of the price
 *   (0 % = not charged, so no line);
 * - the price comes from the case's price list (payer list → the clinic's default list → the appointment type's
 *   own price, see priceFor in src/server/repos/pms/price-lists.ts);
 * - an appointment is billed once: billing keeps the lock (one active invoice line per appointment).
 */
import type { InvoiceLineInput } from "./schemas";
import type { VisitStatus } from "./types";
import { roundHalfAway, type VatCode } from "./vat";

export interface BillableVisit {
  appointmentId: string;
  patientId: string;
  caseId: string | null;
  serviceId: string;
  practitionerId: string | null;
  siteId: string | null;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" (Europe/London), for display. */
  startTime: string | null;
  status: VisitStatus;
  /** The treatment authorisation the appointment was booked under (the diary counted its session when completed). */
  authorisationId?: string | null;
  /** A fee the diary set by hand for a missed or late-cancelled visit (whole pence) – it replaces the percentage. */
  feePence?: number | null;
}

export interface VisitPricing {
  listPricePence: number;
  billingCode: string | null;
  serviceName: string;
  vatCode: VatCode;
}

export interface ChargeRules {
  dnaChargePercent: number;
  lateCancelChargePercent: number;
}

export const VISIT_STATUS_LABELS: Readonly<Record<VisitStatus, string>> = {
  attended: "Attended",
  did_not_attend: "Did not attend",
  late_cancellation: "Late cancellation",
};

/** The price charged for a visit (null when the clinic does not charge for it). A fee set in the diary wins. */
export function visitCharge(status: VisitStatus, listPricePence: number, rules: ChargeRules, feePence?: number | null): number | null {
  if (status === "attended") return listPricePence;
  if (typeof feePence === "number") return feePence > 0 ? feePence : null;
  const pct = status === "did_not_attend" ? rules.dnaChargePercent : rules.lateCancelChargePercent;
  if (pct <= 0) return null;
  return roundHalfAway((listPricePence * pct) / 100);
}

/** The invoice line for a visit, or null when it is not charged. */
export function visitLine(visit: BillableVisit, pricing: VisitPricing, rules: ChargeRules): InvoiceLineInput | null {
  const unit = visitCharge(visit.status, pricing.listPricePence, rules, visit.feePence);
  if (unit === null) return null;
  const description = visit.status === "attended" ? pricing.serviceName : `${VISIT_STATUS_LABELS[visit.status]} – ${pricing.serviceName}`;
  return {
    kind: "service",
    serviceId: visit.serviceId,
    appointmentId: visit.appointmentId,
    visitStatus: visit.status,
    practitionerId: visit.practitionerId,
    serviceOn: visit.date,
    description,
    billingCode: pricing.billingCode,
    quantity: 1,
    unitPricePence: unit,
    discountPence: 0,
    vatCode: pricing.vatCode,
  };
}

/** The diary's statuses as billing names them (attended is "Completed" on screen). */
export const DIARY_TO_VISIT_STATUS: Readonly<Record<string, VisitStatus>> = {
  attended: "attended",
  dna: "did_not_attend",
  late_cancelled: "late_cancellation",
};

/** On screen (the diary says "Completed" for attended – Khuram's decision B). */
export const VISIT_OUTCOME_LABELS: Readonly<Record<VisitStatus, string>> = {
  attended: "Completed",
  did_not_attend: "Did not attend (DNA)",
  late_cancellation: "Late cancellation",
};

/**
 * The insurance excess each visit carries, in date order: the case's excess not billed yet is taken from the
 * first visits until it is used up (a £60 excess over £75 visits: −£60, then nothing; over £20 visits: −£20 each
 * for three visits). Pure; the same split the insurer's invoice shows per line.
 */
export function excessPerVisit(charges: readonly { key: string; totalPence: number }[], excessLeftPence: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = Math.max(0, excessLeftPence);
  for (const c of charges) {
    const take = Math.min(left, Math.max(0, c.totalPence));
    out.set(c.key, take);
    left -= take;
  }
  return out;
}
