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

/* ------------------------------------------------------------------------------------------------
 * Two ways of billing the patient's part (Khuram's decision 28/10/2026), chosen per payer account with an
 * override per case; the amount is the case's excess_pence in both:
 *   per_case  – "Excess per case": one amount for the whole case, used up visit by visit in date order (default);
 *   per_visit – "Patient contribution per visit": the patient pays that amount on every visit, the payer the rest.
 * A visit the patient's part covers in full is billed to the patient alone – never a £0 line or invoice for the
 * payer.
 * ----------------------------------------------------------------------------------------------*/

export const CONTRIBUTION_MODES = ["per_case", "per_visit"] as const;
export type ContributionMode = (typeof CONTRIBUTION_MODES)[number];
export const DEFAULT_CONTRIBUTION_MODE: ContributionMode = "per_case";

export const CONTRIBUTION_MODE_LABELS: Readonly<Record<ContributionMode, string>> = {
  per_case: "Excess per case",
  per_visit: "Patient contribution per visit",
};

export const CONTRIBUTION_MODE_HINTS: Readonly<Record<ContributionMode, string>> = {
  per_case: "One amount for the whole case, used up visit by visit; the insurer pays the rest.",
  per_visit: "The patient pays a fixed amount on every visit; the insurer pays the rest.",
};

export function isContributionMode(v: unknown): v is ContributionMode {
  return typeof v === "string" && (CONTRIBUTION_MODES as readonly string[]).includes(v);
}

/** The mode a case bills with: its own override, else its payer account's, else the default. */
export function effectiveContributionMode(caseMode: ContributionMode | null | undefined, payerMode: ContributionMode | null | undefined): ContributionMode {
  return caseMode ?? payerMode ?? DEFAULT_CONTRIBUTION_MODE;
}

/**
 * The patient's part of each treatment line, lines in date order: per case, what is left of the excess is taken
 * from the first lines until used up; per visit, the contribution from every line (never more than the line).
 */
export function patientShares(lines: readonly { key: string; totalPence: number }[], mode: ContributionMode, amountPence: number | null, alreadyBilledPence = 0): Map<string, number> {
  const out = new Map<string, number>();
  const amount = Math.max(0, amountPence ?? 0);
  let left = Math.max(0, amount - Math.max(0, alreadyBilledPence));
  for (const l of lines) {
    const total = Math.max(0, l.totalPence);
    const take = mode === "per_visit" ? Math.min(amount, total) : Math.min(left, total);
    if (mode === "per_case") left -= take;
    out.set(l.key, take);
  }
  return out;
}

export const CONTRIBUTION_LINE_TEXT = "Patient contribution";
export const CONTRIBUTION_DEDUCTION_TEXT = "Less: patient contributions billed to the patient";

/** The patient's line for a visit their part covers in full (nothing is claimed from the payer for it). */
export function fullyCoveredText(description: string, mode: ContributionMode): string {
  const tail = mode === "per_visit" ? " – patient contribution covers the visit" : " – covered by the insurance excess";
  return `${description.slice(0, 200 - tail.length)}${tail}`;
}

/** The patient's line for the contribution on one visit (per visit mode). */
export function contributionLineText(description: string): string {
  const head = `${CONTRIBUTION_LINE_TEXT} – `;
  return `${head}${description.slice(0, 200 - head.length)}`;
}

/** The invoice detail's wording for each mode (amounts already formatted, e.g. "£20.00"). */
export function contributionWording(mode: ContributionMode) {
  const perVisit = mode === "per_visit";
  return {
    heading: perVisit ? "Insured visit – patient contribution per visit" : "Insured visit – split between patient and insurer",
    /** "Patient excess · INV00012" / "Patient contribution · INV00012". */
    patientPart: perVisit ? "Patient contribution" : "Patient excess",
    /** The items table's column on the insurer's invoice. */
    column: perVisit ? "Contribution" : "Excess",
    none: perVisit ? "No patient contribution on this invoice." : "No excess on this invoice.",
    explain(amount: string | null, insurer: string | null): string {
      const who = insurer ?? "the insurer";
      if (perVisit) return amount ? `${CONTRIBUTION_MODE_LABELS.per_visit}: the patient pays ${amount} on every visit and ${who} pays the rest.` : `${CONTRIBUTION_MODE_LABELS.per_visit}: the patient pays a fixed amount on every visit and ${who} pays the rest.`;
      return amount ? `${CONTRIBUTION_MODE_LABELS.per_case}: the patient pays the first ${amount} of the case's treatment, used up visit by visit, and ${who} pays the rest.` : `${CONTRIBUTION_MODE_LABELS.per_case}: the patient pays the case's excess first, visit by visit, and ${who} pays the rest.`;
    },
    fullyPatient(insurer: string | null, visits: number): string {
      const these = visits === 1 ? "this visit" : "these visits";
      return `Nothing claimed from ${insurer ?? "the insurer"}: the patient's ${perVisit ? "contribution" : "excess"} covers ${these} in full.`;
    },
  };
}
