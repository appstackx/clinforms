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

/** The price charged for a visit (null when the clinic does not charge for it). */
export function visitCharge(status: VisitStatus, listPricePence: number, rules: ChargeRules): number | null {
  if (status === "attended") return listPricePence;
  const pct = status === "did_not_attend" ? rules.dnaChargePercent : rules.lateCancelChargePercent;
  if (pct <= 0) return null;
  return roundHalfAway((listPricePence * pct) / 100);
}

/** The invoice line for a visit, or null when it is not charged. */
export function visitLine(visit: BillableVisit, pricing: VisitPricing, rules: ChargeRules): InvoiceLineInput | null {
  const unit = visitCharge(visit.status, pricing.listPricePence, rules);
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
