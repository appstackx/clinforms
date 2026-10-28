/**
 * Spreading a payment over invoices (an insurer's remittance covering several invoices, a patient paying two at
 * once). Pure: the repository checks every amount again in SQL.
 */

export interface OpenInvoice {
  id: string;
  issuedOn: string;
  numberSeq: number | null;
  balancePence: number;
}

/** Oldest first (invoice date, then number), never more than an invoice's balance; the rest stays on account. */
export function autoAllocate(amountPence: number, invoices: readonly OpenInvoice[]): { invoiceId: string; amountPence: number }[] {
  if (!Number.isInteger(amountPence) || amountPence <= 0) return [];
  const open = invoices
    .filter((i) => i.balancePence > 0)
    .slice()
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || (a.numberSeq ?? 0) - (b.numberSeq ?? 0) || a.id.localeCompare(b.id));
  let left = amountPence;
  const out: { invoiceId: string; amountPence: number }[] = [];
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balancePence);
    out.push({ invoiceId: inv.id, amountPence: take });
    left -= take;
  }
  return out;
}

/** What is left of a payment after its allocations (never negative). */
export function unallocated(amountPence: number, allocations: readonly { amountPence: number }[]): number {
  return Math.max(0, amountPence - allocations.reduce((a, x) => a + Math.abs(x.amountPence), 0));
}
