/**
 * What an invoice's amounts mean for people: its state, balance and due date. Pure.
 */
import type { InvoiceStatus } from "./types";

export type InvoiceState = "draft" | "cancelled" | "unpaid" | "part_paid" | "overdue" | "paid" | "credited" | "void" | "refund_due";

export interface InvoiceAmounts {
  status: InvoiceStatus;
  totalPence: number;
  paidPence: number;
  creditedPence: number;
  dueOn: string | null;
  /** Set when an issued invoice was voided. */
  voidedAt?: string | null;
}

/** total − paid − credited. Negative: more was paid or credited than charged (money is owed back). */
export function balanceOf(a: Pick<InvoiceAmounts, "totalPence" | "paidPence" | "creditedPence">): number {
  return a.totalPence - a.paidPence - a.creditedPence;
}

/** today = "YYYY-MM-DD" (UK). */
export function invoiceState(a: InvoiceAmounts, today: string): InvoiceState {
  if (a.status === "draft") return "draft";
  if (a.status === "cancelled") return "cancelled";
  const balance = balanceOf(a);
  if (a.voidedAt && balance >= 0) return "void";
  if (balance < 0) return "refund_due";
  if (balance === 0) return a.creditedPence >= a.totalPence && a.totalPence > 0 ? "credited" : "paid";
  if (a.dueOn && a.dueOn < today) return "overdue";
  return a.paidPence > 0 || a.creditedPence > 0 ? "part_paid" : "unpaid";
}

export const INVOICE_STATE_LABELS: Readonly<Record<InvoiceState, string>> = {
  draft: "Draft",
  cancelled: "Cancelled",
  unpaid: "Issued",
  part_paid: "Part-paid",
  overdue: "Overdue",
  paid: "Paid",
  credited: "Credited",
  void: "Void",
  refund_due: "Refund due",
};

/** Tone for a state badge (never the only signal – the label is always shown). */
export const INVOICE_STATE_TONES: Readonly<Record<InvoiceState, "neutral" | "info" | "warning" | "danger" | "success">> = {
  draft: "neutral",
  cancelled: "neutral",
  unpaid: "info",
  part_paid: "info",
  overdue: "danger",
  paid: "success",
  credited: "neutral",
  void: "neutral",
  refund_due: "warning",
};

/** "YYYY-MM-DD" + n days. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The due date from the invoice date and the terms for who is billed. */
export function dueDate(issuedOn: string, billTo: "patient" | "payer", terms: { selfPayTermsDays: number; accountTermsDays: number }): string {
  return addDaysIso(issuedOn, billTo === "patient" ? terms.selfPayTermsDays : terms.accountTermsDays);
}
