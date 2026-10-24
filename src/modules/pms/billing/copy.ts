/**
 * Plain UK-English labels for billing screens, PDFs and CSVs. Pure. Never a product or vendor name here
 * (the product name comes from src/lib/brand.ts in host code).
 */
import type { PayerType } from "../core/types";
import type { BillTo, LineKind, PaymentKind, PaymentMethod } from "./types";
import type { VatCode } from "./vat";

export const PAYER_TYPE_LABELS: Readonly<Record<PayerType, string>> = {
  self_pay: "Self-pay",
  insurer: "Insurer",
  mlc: "Medico-legal company",
  solicitor: "Solicitor",
  employer: "Employer",
  other: "Other payer",
};

export const BILL_TO_LABELS: Readonly<Record<BillTo, string>> = {
  patient: "The patient",
  payer: "The case's payer account",
};

export const LINE_KIND_LABELS: Readonly<Record<LineKind, string>> = {
  service: "Treatment",
  item: "Other item",
  excess: "Insurance excess",
  excess_deduction: "Excess deduction",
};

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: "Card",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  online: "Online card payment",
  other: "Other",
};

export const PAYMENT_KIND_LABELS: Readonly<Record<PaymentKind, string>> = {
  payment: "Payment",
  refund: "Refund",
};

export const VAT_CODE_LABELS: Readonly<Record<VatCode, string>> = {
  exempt: "Exempt (health care by a registered professional)",
  standard: "Standard rate (20%)",
  reduced: "Reduced rate (5%)",
  zero: "Zero rate (0%)",
  none: "No VAT (clinic not VAT-registered)",
};

export const BILLING_COPY = {
  testModeNotice: "Test mode – card payment links use the payment provider's test environment. No real card is charged.",
  linksNotConfigured: "Card payment links are not set up for this system. Record card payments by hand.",
  noVisitSource: "Appointments from the diary are listed here once the diary is connected. Meanwhile, add treatments by hand.",
  demoInvoiceFooter: "Demonstration clinic – fictional patient and invoice. Do not pay.",
} as const;
