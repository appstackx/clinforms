/**
 * Insurance excess: the first part of an insured case's treatment the patient pays themselves (the case's
 * excess_pence). When the insurer is billed, the part of the excess not billed yet goes on a separate invoice to
 * the patient and is taken off the insurer's invoice as an "excess deduction" line – so the insurer's invoice
 * shows the full treatment and what the insurer owes. Pure.
 */

export interface ExcessInput {
  /** The insurer invoice's total before the deduction. */
  payerTotalPence: number;
  /** The case's excess (null / 0 = none). */
  excessPence: number | null;
  /** Excess already billed to the patient on this case (on issued or draft invoices, less credits). */
  excessAlreadyBilledPence: number;
}

export interface ExcessSplit {
  /** Billed to the patient now. */
  patientPence: number;
  /** What the insurer's invoice comes to after the deduction. */
  payerPence: number;
  /** Excess still to bill on later invoices of the case. */
  remainingAfterPence: number;
}

export function splitExcess(input: ExcessInput): ExcessSplit {
  const total = Math.max(0, input.payerTotalPence);
  const excess = Math.max(0, input.excessPence ?? 0);
  const left = Math.max(0, excess - Math.max(0, input.excessAlreadyBilledPence));
  const patient = Math.min(left, total);
  return { patientPence: patient, payerPence: total - patient, remainingAfterPence: left - patient };
}

export const EXCESS_LINE_TEXT = "Insurance excess (paid by the patient)";
export const EXCESS_DEDUCTION_TEXT = "Less: insurance excess billed to the patient";
