/**
 * Account statements (an insurer's, MLC's, solicitor's or a patient's): every invoice, credit note, payment and
 * refund in a period with a running balance, and the balance brought forward. Pure.
 *
 * Signs: an invoice adds to what is owed; a credit note and a payment take it off; a refund adds it back. A
 * payment counts in full when it was received (whether or not it has been allocated yet), so the balance is what
 * the account really owes.
 */

export type StatementEntryKind = "invoice" | "credit_note" | "payment" | "refund";

export interface StatementEntry {
  kind: StatementEntryKind;
  id: string;
  /** "YYYY-MM-DD" */
  on: string;
  /** Document number or payment reference. */
  reference: string;
  /** Short plain description (no clinical detail). */
  description: string;
  /** Always positive; the kind gives the sign. */
  amountPence: number;
}

export interface StatementRow extends StatementEntry {
  debitPence: number;
  creditPence: number;
  balancePence: number;
}

export interface Statement {
  from: string;
  until: string;
  openingPence: number;
  rows: StatementRow[];
  closingPence: number;
  totals: { debitPence: number; creditPence: number };
}

const ORDER: Record<StatementEntryKind, number> = { invoice: 0, credit_note: 1, refund: 2, payment: 3 };

export function signedAmount(e: Pick<StatementEntry, "kind" | "amountPence">): number {
  return e.kind === "invoice" || e.kind === "refund" ? e.amountPence : -e.amountPence;
}

/** from/until "YYYY-MM-DD", both included. Entries may come in any order and from any date. */
export function buildStatement(entries: readonly StatementEntry[], from: string, until: string): Statement {
  const sorted = entries.slice().sort((a, b) => a.on.localeCompare(b.on) || ORDER[a.kind] - ORDER[b.kind] || a.reference.localeCompare(b.reference) || a.id.localeCompare(b.id));
  let opening = 0;
  for (const e of sorted) if (e.on < from) opening += signedAmount(e);
  let balance = opening;
  const rows: StatementRow[] = [];
  let debit = 0;
  let credit = 0;
  for (const e of sorted) {
    if (e.on < from || e.on > until) continue;
    const signed = signedAmount(e);
    balance += signed;
    const row: StatementRow = { ...e, debitPence: signed > 0 ? signed : 0, creditPence: signed < 0 ? -signed : 0, balancePence: balance };
    debit += row.debitPence;
    credit += row.creditPence;
    rows.push(row);
  }
  return { from, until, openingPence: opening, rows, closingPence: balance, totals: { debitPence: debit, creditPence: credit } };
}
