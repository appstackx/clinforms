/**
 * Billing records as the repositories return them (decrypted, camelCase). Pure types – browser-safe.
 */
import type { PayerType } from "../core/types";
import type {
  BILL_TO,
  EXPORT_CHANNELS,
  INVOICE_STATUSES,
  LINE_KINDS,
  PAYER_KINDS,
  PAYMENT_KINDS,
  PAYMENT_LINK_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  VISIT_STATUSES,
} from "./schemas";
import type { VatCode } from "./vat";

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type BillTo = (typeof BILL_TO)[number];
export type LineKind = (typeof LINE_KINDS)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PayerKind = (typeof PAYER_KINDS)[number];
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];
export type ExportChannel = (typeof EXPORT_CHANNELS)[number];

export interface BillingSettings {
  tenantId: string;
  rev: number;
  invoicePrefix: string;
  creditNotePrefix: string;
  firstInvoiceNumber: number;
  firstCreditNoteNumber: number;
  selfPayTermsDays: number;
  accountTermsDays: number;
  vatRegistered: boolean;
  vatNumber: string | null;
  pricesIncludeVat: boolean;
  dnaChargePercent: number;
  lateCancelChargePercent: number;
  paymentInstructions: string | null;
  paymentLinksEnabled: boolean;
  /** Per appointment type: its VAT code (default "exempt"). */
  serviceVat: Record<string, VatCode>;
  updatedAt: string | null;
}

/** What lists show: amounts and ids, no free text. */
export interface InvoiceSummary {
  tenantId: string;
  id: string;
  rev: number;
  status: InvoiceStatus;
  /** "RIV00042", or null for a draft. */
  number: string | null;
  numberSeq: number | null;
  patientId: string;
  caseId: string | null;
  billTo: BillTo;
  payerType: PayerType;
  payerReferrerId: string | null;
  authorisationId: string | null;
  relatedInvoiceId: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  /** Earliest and latest treatment dates on the invoice. */
  firstServiceOn: string | null;
  lastServiceOn: string | null;
  netPence: number;
  vatPence: number;
  totalPence: number;
  paidPence: number;
  creditedPence: number;
  /** total − paid − credited (negative: money is owed back). */
  balancePence: number;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: string;
  lineNo: number;
  kind: LineKind;
  serviceId: string | null;
  appointmentId: string | null;
  visitStatus: VisitStatus | null;
  practitionerId: string | null;
  serviceOn: string | null;
  /** Decrypted. */
  description: string | null;
  billingCode: string | null;
  quantity: number;
  unitPricePence: number;
  discountPence: number;
  vatCode: VatCode;
  vatRateBp: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
  /** Credited so far on credit notes. */
  creditedPence: number;
}

/** What the invoice is addressed to, frozen when it is issued (the patient's or payer's details at the time). */
export interface BillToSnapshot {
  name: string;
  attention: string | null;
  address: string[] | null;
  postcode: string | null;
  email: string | null;
  /** Patient name and number, membership number, claim reference, authorisation code – as printed. */
  references: { label: string; value: string }[];
}

export interface Invoice extends InvoiceSummary {
  lines: InvoiceLine[];
  /** Decrypted. */
  diagnosisCode: string | null;
  /** Decrypted. */
  notes: string | null;
  /** Decrypted; null until issued. */
  billToSnapshot: BillToSnapshot | null;
  pricesIncludeVat: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  authSessions: number;
  authValuePence: number;
  importRef: string | null;
  createdBy: string | null;
}

export interface CreditNote {
  tenantId: string;
  id: string;
  number: string;
  numberSeq: number;
  invoiceId: string;
  issuedOn: string;
  netPence: number;
  vatPence: number;
  totalPence: number;
  /** Decrypted only in getCreditNote. */
  reason: string | null;
  lines: { id: string; invoiceLineId: string; netPence: number; vatPence: number; totalPence: number }[];
  createdBy: string | null;
  createdAt: string;
}

export interface Payment {
  tenantId: string;
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  payerKind: PayerKind;
  patientId: string | null;
  payerReferrerId: string | null;
  receivedOn: string;
  method: PaymentMethod;
  amountPence: number;
  /** Allocated to invoices (always ≤ amount). */
  allocatedPence: number;
  reference: string | null;
  /** Decrypted only in getPayment. */
  notes: string | null;
  provider: string;
  providerRef: string | null;
  reversedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Allocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  /** Positive for a payment, negative for a refund. */
  amountPence: number;
  createdAt: string;
}

export interface PaymentLink {
  id: string;
  invoiceId: string;
  provider: string;
  mode: "test";
  url: string;
  amountPence: number;
  status: PaymentLinkStatus;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface InvoiceExport {
  id: string;
  invoiceId: string;
  channel: ExportChannel;
  batchRef: string;
  createdAt: string;
  createdBy: string | null;
}
