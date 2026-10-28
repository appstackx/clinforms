/**
 * Aged debt (the debtors report): what is owed, by how long it is past its due date. Pure.
 *
 * Buckets: not yet due, 1–30, 31–60, 61–90 and over 90 days past the due date (an invoice with no due date counts
 * from its invoice date). Only issued invoices with money still owed are counted; money owed BACK (a negative
 * balance) is listed separately as "refunds due", never netted off another invoice.
 */
import { daysBetweenIso } from "./status";

export const AGE_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const AGE_BUCKET_LABELS: Readonly<Record<AgeBucket, string>> = {
  current: "Not yet due",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

export function ageBucket(dueOn: string | null, issuedOn: string, asOf: string): AgeBucket {
  const overdue = daysBetweenIso(dueOn ?? issuedOn, asOf);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "d1_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d90_plus";
}

export interface DebtInvoice {
  id: string;
  /** Who owes it: "patient:<id>" or "account:<referrer id>". */
  debtorKey: string;
  issuedOn: string;
  dueOn: string | null;
  balancePence: number;
}

export interface DebtorRow {
  debtorKey: string;
  invoices: number;
  buckets: Record<AgeBucket, number>;
  totalPence: number;
  oldestIssuedOn: string;
}

export interface AgedDebt {
  rows: DebtorRow[];
  totals: Record<AgeBucket, number> & { totalPence: number; invoices: number };
  refundsDue: { debtorKey: string; invoiceId: string; amountPence: number }[];
}

function emptyBuckets(): Record<AgeBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/** Groups outstanding invoices by debtor; rows sorted by the total owed, largest first. */
export function agedDebt(invoices: readonly DebtInvoice[], asOf: string): AgedDebt {
  const rows = new Map<string, DebtorRow>();
  const totals = { ...emptyBuckets(), totalPence: 0, invoices: 0 };
  const refundsDue: AgedDebt["refundsDue"] = [];
  for (const inv of invoices) {
    if (inv.balancePence < 0) {
      refundsDue.push({ debtorKey: inv.debtorKey, invoiceId: inv.id, amountPence: -inv.balancePence });
      continue;
    }
    if (inv.balancePence === 0) continue;
    const bucket = ageBucket(inv.dueOn, inv.issuedOn, asOf);
    const row = rows.get(inv.debtorKey) ?? { debtorKey: inv.debtorKey, invoices: 0, buckets: emptyBuckets(), totalPence: 0, oldestIssuedOn: inv.issuedOn };
    row.invoices += 1;
    row.buckets[bucket] += inv.balancePence;
    row.totalPence += inv.balancePence;
    if (inv.issuedOn < row.oldestIssuedOn) row.oldestIssuedOn = inv.issuedOn;
    rows.set(inv.debtorKey, row);
    totals[bucket] += inv.balancePence;
    totals.totalPence += inv.balancePence;
    totals.invoices += 1;
  }
  return {
    rows: Array.from(rows.values()).sort((a, b) => b.totalPence - a.totalPence || a.debtorKey.localeCompare(b.debtorKey)),
    totals,
    refundsDue,
  };
}
