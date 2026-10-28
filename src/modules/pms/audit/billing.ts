/**
 * Audit actions of the billing module and their plain-English labels (owned by the billing builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Details hold ids,
 * counts, amounts, methods and statuses only – never names, descriptions or reasons.
 */
export const BILLING_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.billing_settings.update": "Billing settings updated",
  "pms.service_vat.set": "VAT rate of an appointment type set",
  "pms.invoice.create": "Invoice drafted",
  "pms.invoice.excess_split": "Insurance excess billed to the patient",
  "pms.invoice.update": "Draft invoice changed",
  "pms.invoice.cancel": "Draft invoice cancelled",
  "pms.invoice.issue": "Invoice issued",
  "pms.invoice.export": "Invoices exported for insurer billing",
  "pms.credit_note.create": "Credit note issued",
  "pms.payment.record": "Payment recorded",
  "pms.refund.record": "Refund recorded",
  "pms.payment.allocate": "Payment allocated to invoices",
  "pms.payment.unallocate": "Payment taken off an invoice",
  "pms.payment.reverse": "Payment reversed",
  "pms.payment_link.create": "Card payment link created",
  "pms.payment_link.status": "Card payment link updated",
  "pms.invoice.void": "Invoice voided",
  "pms.invoice.write_off": "Amount written off an invoice",
  "pms.invoice.transfer": "Unpaid part of an invoice moved to the patient",
  "pms.invoice.csv_export": "Invoice list exported (CSV)",
  "pms.saved_card.add": "Card saved (test mode)",
  "pms.saved_card.remove": "Saved card removed",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const BILLING_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_invoice: "Invoice",
  pms_credit_note: "Credit note",
  pms_payment: "Payment",
  pms_billing_settings: "Billing settings",
  pms_patient: "Patient",
};
