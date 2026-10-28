/**
 * What the billing screens receive from the server (src/server/pms/billing/views.ts). Pure, browser-safe: names,
 * numbers, dates and amounts only – never a note, a reason or a description that could hold clinical detail, except
 * on the invoice detail and the print views, which show the invoice's own lines.
 */
import type { AgeBucket } from "./aging";
import type { InvoiceState } from "./status";
import type { BillTo, CreditNoteKind, PaymentKind, PaymentMethod, VisitStatus } from "./types";
import type { VatCode } from "./vat";

export interface BillingFiguresView {
  outstandingPence: number;
  outstandingCount: number;
  outstandingPatientsPence: number;
  outstandingAccountsPence: number;
  overduePence: number;
  overdueCount: number;
  takenTodayPence: number;
  takenTodayByMethod: { method: PaymentMethod; label: string; pence: number }[];
  drafts: number;
  /** Chargeable visits without an invoice (the "Attended, not invoiced" tab count). */
  uninvoicedVisits: number;
}

export interface InvoiceRowView {
  id: string;
  number: string | null;
  state: InvoiceState;
  billTo: BillTo;
  billToName: string;
  patientId: string;
  patientName: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalPence: number;
  balancePence: number;
}

export interface UninvoicedVisitView {
  appointmentId: string;
  patientId: string;
  patientName: string;
  date: string;
  startTime: string | null;
  status: VisitStatus;
  serviceName: string;
  practitionerName: string | null;
  /** "Self-pay", or the payer account's name. */
  payerLabel: string;
  /** Who gets the invoice: the patient, or the case's payer account. DNA and late-cancellation fees always go to the patient. */
  billTo: BillTo;
  /** The visit's charge (null: no price, or a 0 % fee). */
  chargePence: number | null;
  /** Of the charge: the patient's part (self-pay: all of it; insured: the excess) and the payer's part. */
  patientPence: number;
  payerPence: number;
  /** The insurance excess this visit carries (insured visits). */
  excessPence: number;
  /** A did-not-attend / late-cancellation fee can be waived. */
  waivable: boolean;
}

export interface InvoiceLineView {
  id: string;
  lineNo: number;
  kind: "service" | "item" | "excess" | "excess_deduction";
  serviceOn: string | null;
  description: string;
  practitionerName: string | null;
  practitionerRegistration: string | null;
  quantity: number;
  unitPricePence: number;
  totalPence: number;
  vatCode: VatCode;
  vatRateBp: number;
  vatPence: number;
  creditedPence: number;
  /** Insured invoices: the excess this line carries (the deduction spread over the lines in date order). */
  excessPence: number;
  appointmentId: string | null;
}

export interface InvoiceMoneyRow {
  id: string;
  on: string;
  /** "Payment – card", "Remittance BW-RA-7781 · bank transfer", "Credit note CN00004", "Write-off". */
  label: string;
  /** Signed: payments and credits are negative, refunds positive. */
  amountPence: number;
  kind: PaymentKind | CreditNoteKind;
  /** A payment allocation (owners/admins may take it off). */
  allocationId: string | null;
}

export interface InvoiceDetailView {
  id: string;
  rev: number;
  number: string | null;
  state: InvoiceState;
  status: "draft" | "issued" | "cancelled";
  billTo: BillTo;
  billToName: string;
  billToLines: string[];
  billToReferences: { label: string; value: string }[];
  patient: { id: string; name: string; number: number; dateOfBirth: string | null; email: string | null };
  payer: { id: string; name: string } | null;
  case: { id: string; title: string; membershipNumber: string | null } | null;
  authorisation: { code: string; sessionsUsed: number; sessionsAuthorised: number | null } | null;
  /** The other half of an insured visit's split (the patient's excess invoice, or the insurer's). */
  partner: { id: string; number: string | null; billToName: string; totalPence: number; balancePence: number; state: InvoiceState; isExcess: boolean } | null;
  siteName: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  netPence: number;
  vatPence: number;
  totalPence: number;
  paidPence: number;
  creditedPence: number;
  balancePence: number;
  lines: InvoiceLineView[];
  money: InvoiceMoneyRow[];
  paymentLinks: { id: string; url: string; amountPence: number; status: string; createdAt: string }[];
  notes: string | null;
  vatRegistered: boolean;
  /** Patient invoices with a balance: the take-payment dialog can open from here. */
  canTakePaymentHere: boolean;
}

export interface TakePaymentInvoiceView {
  id: string;
  number: string | null;
  description: string;
  issuedOn: string | null;
  balancePence: number;
}

export interface TakePaymentView {
  patient: { id: string; name: string; dateOfBirth: string | null; email: string | null };
  balancePence: number;
  invoices: TakePaymentInvoiceView[];
  savedCards: { id: string; label: string }[];
  /** Card on file and payment links need the payment provider (test mode). */
  providerReady: boolean;
  providerNote: string | null;
  linksEnabled: boolean;
  /** Where the dialog was opened from ("diary drawer · Owen Price, Fri 30/10 08:00"). */
  context: string | null;
}

export interface PatientAccountView {
  patientBalancePence: number;
  /** Owed by payer accounts on this patient's cases. */
  accountsBalancePence: number;
  creditOnAccountPence: number;
  overdueCount: number;
  savedCard: { id: string; label: string } | null;
  canSaveTestCard: boolean;
}

export interface RemittanceInvoiceView {
  id: string;
  number: string | null;
  issuedOn: string | null;
  patientName: string;
  balancePence: number;
}

export interface AgedDebtView {
  asOf: string;
  rows: { label: string; buckets: Record<AgeBucket, number>; totalPence: number }[];
  totals: Record<AgeBucket, number> & { totalPence: number };
  largest: { key: string; name: string; kind: "patient" | "account"; daysOverdue: number; amountPence: number; patientId: string | null; payerReferrerId: string | null }[];
  refundsDuePence: number;
}

export interface StatementRowView {
  on: string;
  details: string;
  chargePence: number | null;
  paymentPence: number | null;
  balancePence: number;
}

export interface StatementView {
  title: string;
  from: string;
  until: string;
  account: { name: string; lines: string[]; reference: string | null };
  openingPence: number;
  rows: StatementRowView[];
  closingPence: number;
  ages: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  howToPay: string[];
}

export interface PrintClinic {
  name: string;
  lines: string[];
  contact: string | null;
  vatNumber: string | null;
}
