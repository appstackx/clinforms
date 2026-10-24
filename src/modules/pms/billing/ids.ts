/**
 * Record id prefixes of the billing module (contract §4: "<prefix>_<ULID>", never reused by another module).
 * Pure.
 */
export const BILLING_ID_PREFIXES = {
  invoice: "inv",
  invoiceLine: "invl",
  creditNote: "crn",
  creditNoteLine: "crnl",
  payment: "pay",
  allocation: "pyal",
  paymentLink: "plnk",
  export: "ebex",
} as const;

export type BillingIdKind = keyof typeof BILLING_ID_PREFIXES;
