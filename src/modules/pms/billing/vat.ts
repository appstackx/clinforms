/**
 * Money and VAT rules for invoice and credit note lines. Pure (browser-safe): the invoice form shows the same
 * figures the repository stores.
 *
 * - Money is whole pence (integers). Rates are basis points (2000 = 20 %).
 * - VAT codes: "exempt" (most treatment by registered health professionals – VAT Notice 701/57), "standard",
 *   "reduced", "zero", and "none" for a clinic that is not VAT-registered (it may not charge VAT at all).
 * - Prices may include VAT (the clinic's setting – usual for self-pay patients) or exclude it.
 * - VAT is worked out and rounded per line (half away from zero), then the lines are added up; HMRC accepts
 *   line-level rounding when it is applied consistently.
 */

export const VAT_CODES = ["exempt", "standard", "reduced", "zero", "none"] as const;
export type VatCode = (typeof VAT_CODES)[number];

/** UK rates in basis points (as at October 2026). Stored on every line, so a later change never rewrites history. */
export const VAT_RATES_BP: Readonly<Record<VatCode, number>> = {
  exempt: 0,
  standard: 2000,
  reduced: 500,
  zero: 0,
  none: 0,
};

export function isVatCode(value: unknown): value is VatCode {
  return typeof value === "string" && (VAT_CODES as readonly string[]).includes(value);
}

/** Rounds half away from zero (2.5 → 3, -2.5 → -3) – the same for credits as for charges. */
export function roundHalfAway(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}

export interface LineAmountInput {
  unitPricePence: number;
  quantity: number;
  /** Taken off the line before VAT (whole pence, never more than the line). */
  discountPence?: number;
  vatRateBp: number;
  /** True: the unit price already includes VAT (VAT is the fraction rate / (1 + rate) of it). */
  pricesIncludeVat: boolean;
}

export interface LineAmounts {
  /** unit × quantity − discount: what the price list says the line costs. */
  chargedPence: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
}

/** The net, VAT and total of one line. */
export function lineAmounts(input: LineAmountInput): LineAmounts {
  const { unitPricePence, quantity, vatRateBp, pricesIncludeVat } = input;
  const discount = input.discountPence ?? 0;
  if (![unitPricePence, quantity, discount, vatRateBp].every(Number.isInteger)) throw new Error("Line amounts must be whole numbers.");
  if (quantity < 1) throw new Error("Quantity must be at least 1.");
  if (vatRateBp < 0 || vatRateBp > 10_000) throw new Error("VAT rate out of range.");
  const charged = unitPricePence * quantity - discount;
  if (vatRateBp === 0) return { chargedPence: charged, netPence: charged, vatPence: 0, totalPence: charged };
  if (pricesIncludeVat) {
    const vat = roundHalfAway((charged * vatRateBp) / (10_000 + vatRateBp));
    return { chargedPence: charged, netPence: charged - vat, vatPence: vat, totalPence: charged };
  }
  const vat = roundHalfAway((charged * vatRateBp) / 10_000);
  return { chargedPence: charged, netPence: charged, vatPence: vat, totalPence: charged + vat };
}

export interface Totals {
  netPence: number;
  vatPence: number;
  totalPence: number;
}

export function sumTotals(lines: readonly Totals[]): Totals {
  return lines.reduce((acc, l) => ({ netPence: acc.netPence + l.netPence, vatPence: acc.vatPence + l.vatPence, totalPence: acc.totalPence + l.totalPence }), {
    netPence: 0,
    vatPence: 0,
    totalPence: 0,
  });
}

/** VAT per rate for the invoice's VAT summary (HMRC: the total VAT and, for each rate, the net and VAT). */
export function vatSummary(lines: readonly (Totals & { vatCode: VatCode; vatRateBp: number })[]): { vatCode: VatCode; vatRateBp: number; netPence: number; vatPence: number }[] {
  const by = new Map<string, { vatCode: VatCode; vatRateBp: number; netPence: number; vatPence: number }>();
  for (const l of lines) {
    const key = `${l.vatCode}:${l.vatRateBp}`;
    const cur = by.get(key) ?? { vatCode: l.vatCode, vatRateBp: l.vatRateBp, netPence: 0, vatPence: 0 };
    cur.netPence += l.netPence;
    cur.vatPence += l.vatPence;
    by.set(key, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.vatRateBp - a.vatRateBp || a.vatCode.localeCompare(b.vatCode));
}

/**
 * The share of a line's net and VAT that a credit of `creditTotalPence` (part of the line's total) carries, so a
 * credit note reverses VAT in the same proportion as the line charged it.
 */
export function creditShare(line: Totals, creditTotalPence: number): Totals {
  if (!Number.isInteger(creditTotalPence) || creditTotalPence <= 0) throw new Error("A credit must be a positive whole number of pence.");
  if (creditTotalPence > line.totalPence) throw new Error("A credit cannot be more than the line.");
  if (creditTotalPence === line.totalPence) return { netPence: line.netPence, vatPence: line.vatPence, totalPence: line.totalPence };
  const vat = line.totalPence === 0 ? 0 : roundHalfAway((line.vatPence * creditTotalPence) / line.totalPence);
  return { netPence: creditTotalPence - vat, vatPence: vat, totalPence: creditTotalPence };
}

/** "20%", "5%", "Exempt", "No VAT". */
export function vatLabel(code: VatCode, rateBp: number): string {
  if (code === "exempt") return "Exempt";
  if (code === "none") return "No VAT";
  const pct = rateBp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** A UK VAT registration number: GB + 9 digits (or 12 for a branch), spaces allowed; returns "GB123456789" or null. */
export function normaliseVatNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return /^GB(\d{9}|\d{12})$/.test(compact) ? compact : null;
}
