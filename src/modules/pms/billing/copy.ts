/**
 * Plain UK-English labels for billing screens, PDFs and CSVs. Pure. Never a product or vendor name here
 * (the product name comes from src/lib/brand.ts in host code).
 */
import type { PayerType } from "../core/types";
import type { ShortfallAction, TakePaymentMethod } from "./schemas";
import type { BillTo, CreditNoteKind, LineKind, PaymentKind, PaymentMethod } from "./types";
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

export const CREDIT_NOTE_KIND_LABELS: Readonly<Record<CreditNoteKind, string>> = {
  credit: "Credit note",
  write_off: "Write-off",
  void: "Void",
  transfer: "Moved to the patient",
};

export const WRITE_OFF_REASON_LABELS: Readonly<Record<string, string>> = {
  above_agreed_rate: "Above insurer's agreed rate",
  not_covered: "Not covered by the policy",
  small_balance: "Small balance",
  bad_debt: "Cannot be collected",
  goodwill: "Goodwill",
  other: "Other",
};

export const SHORTFALL_ACTION_LABELS: Readonly<Record<ShortfallAction, string>> = {
  leave: "Leave outstanding",
  write_off: "Write off",
  patient: "Move to patient",
};

export const TAKE_PAYMENT_METHOD_LABELS: Readonly<Record<TakePaymentMethod, { label: string; hint: string }>> = {
  card_on_file: { label: "Card on file", hint: "Saved card (test mode)" },
  card_now: { label: "Card now", hint: "Front desk card reader" },
  cash: { label: "Cash", hint: "Work out change" },
  bank_transfer: { label: "Bank transfer", hint: "Record a transfer received" },
  payment_link: { label: "Payment link", hint: "Patient pays by text or email" },
};
