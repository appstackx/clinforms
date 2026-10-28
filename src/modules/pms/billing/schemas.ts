/**
 * Billing inputs (zod v4) – SOURCE OF TRUTH for what the billing repositories (src/server/repos/pms/billing/*)
 * accept. Pure, browser-safe (the forms validate with the same schemas).
 *
 * Conventions as the shared record (core/schemas.ts): camelCase, dates "YYYY-MM-DD", whole pence, optional text
 * undefined = unchanged and "" / null = clear. Free text that could hold clinical detail (line descriptions, notes,
 * reasons, diagnosis codes) is encrypted by the repositories.
 */
import { z } from "zod";
import { IsoDateSchema, MoneyPenceSchema, OptionalDateSchema, PmsIdSchema, optionalText } from "../core/schemas";
import { DOCUMENT_PREFIX_PATTERN, MAX_DOCUMENT_SEQ } from "./numbers";
import { VAT_CODES, normaliseVatNumber } from "./vat";

/* ------------------------------------------------------------------------------------------------
 * Enumerations
 * ----------------------------------------------------------------------------------------------*/

/** Stored status. "Paid", "part paid", "overdue" and "credited" follow from the amounts (./status.ts). */
export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);

/** Who the invoice is addressed to: the patient, or the case's payer account (insurer, MLC, solicitor, employer…). */
export const BILL_TO = ["patient", "payer"] as const;
export const BillToSchema = z.enum(BILL_TO);

/**
 * service – a treatment, assessment or class (an appointment, from the diary or entered by hand);
 * item – anything else (a product, a report fee);
 * excess – the insurance excess the patient pays (on the patient's invoice);
 * excess_deduction – the same excess taken off the insurer's invoice (the only negative line).
 */
export const LINE_KINDS = ["service", "item", "excess", "excess_deduction"] as const;
export const LineKindSchema = z.enum(LINE_KINDS);

export const VatCodeSchema = z.enum(VAT_CODES);

/** What happened to the appointment a line bills (did-not-attend and late cancellation fees are charged at the clinic's percentage). */
export const VISIT_STATUSES = ["attended", "did_not_attend", "late_cancellation"] as const;
export const VisitStatusSchema = z.enum(VISIT_STATUSES);

export const PAYMENT_METHODS = ["card", "cash", "bank_transfer", "cheque", "online", "other"] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);

/** A payment received, or money paid back (a refund). */
export const PAYMENT_KINDS = ["payment", "refund"] as const;
export const PaymentKindSchema = z.enum(PAYMENT_KINDS);

export const PAYMENT_STATUSES = ["recorded", "reversed"] as const;

/** Who paid: the patient, or a payer account. */
export const PAYER_KINDS = ["patient", "account"] as const;
export const PayerKindSchema = z.enum(PAYER_KINDS);

export const PAYMENT_LINK_STATUSES = ["active", "paid", "deactivated"] as const;

export const EXPORT_CHANNELS = ["csv", "healthcode"] as const;
export const ExportChannelSchema = z.enum(EXPORT_CHANNELS);

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ----------------------------------------------------------------------------------------------*/

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(DOCUMENT_PREFIX_PATTERN, "1–4 capital letters (invoice numbers stay within 10 characters)");

const firstNumber = z.number().int("Whole numbers only").min(1).max(MAX_DOCUMENT_SEQ);

/** The clinic's bank account: name on the account, sort code (NN-NN-NN) and 8-digit account number. */
export const BankDetailsSchema = z.object({
  accountName: z.string().trim().min(1, "Enter the name on the account").max(80, "At most 80 characters"),
  sortCode: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\d{6}$/.test(v), "Enter a sort code of 6 digits (NN-NN-NN)")
    .transform((v) => `${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`),
  accountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => /^\d{8}$/.test(v), "Enter an account number of 8 digits"),
});

const settingsShape = {
  invoicePrefix: prefix.optional(),
  creditNotePrefix: prefix.optional(),
  /** Numbering starts here (or after the highest number used, if higher) – e.g. to carry on from an earlier system. */
  firstInvoiceNumber: firstNumber.optional(),
  firstCreditNoteNumber: firstNumber.optional(),
  /** Days until payment is due: patients (0 = on the day) and payer accounts. */
  selfPayTermsDays: z.number().int().min(0).max(90).optional(),
  accountTermsDays: z.number().int().min(0).max(180).optional(),
  vatRegistered: z.boolean().optional(),
  vatNumber: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (typeof v !== "string") return v;
      if (v.trim() === "") return null;
      const n = normaliseVatNumber(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Enter a UK VAT number: GB and 9 digits" });
        return z.NEVER;
      }
      return n;
    }),
  /** Prices in the price lists include VAT (usual for self-pay). */
  pricesIncludeVat: z.boolean().optional(),
  /** Charge for a did-not-attend / a late cancellation, as a percentage of the appointment's price. */
  dnaChargePercent: z.number().int().min(0).max(100).optional(),
  lateCancelChargePercent: z.number().int().min(0).max(100).optional(),
  /** Printed on invoices and statements (bank details, how to pay). Not clinical. */
  paymentInstructions: optionalText(600),
  /** Offer card payment links on invoices (only when a payment provider is set up for the deployment). */
  paymentLinksEnabled: z.boolean().optional(),
  /** Bank details printed on invoices and statements; null = none. */
  bankDetails: z.union([BankDetailsSchema, z.null()]).optional(),
};

export const BillingSettingsInputSchema = z.object(settingsShape).superRefine((v, ctx) => {
  if (v.invoicePrefix && v.creditNotePrefix && v.invoicePrefix === v.creditNotePrefix) {
    ctx.addIssue({ code: "custom", path: ["creditNotePrefix"], message: "Use a different prefix from invoices" });
  }
});
export type BillingSettingsInput = z.input<typeof BillingSettingsInputSchema>;

export const ServiceVatInputSchema = z.object({ serviceId: PmsIdSchema, vatCode: VatCodeSchema });
export type ServiceVatInput = z.input<typeof ServiceVatInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Invoices
 * ----------------------------------------------------------------------------------------------*/

export const MAX_INVOICE_LINES = 40;

export const BillingCodeSchema = z
  .union([z.string().trim().toUpperCase().regex(/^[A-Z0-9.-]{1,20}$/, "Letters, digits, '.' and '-'"), z.null()])
  .optional()
  .transform((v) => (v === "" ? null : v));

export const InvoiceLineInputSchema = z
  .object({
    kind: LineKindSchema.optional(),
    serviceId: z.union([PmsIdSchema, z.null()]).optional(),
    /** The diary appointment this line bills (one active line per appointment). */
    appointmentId: z.union([PmsIdSchema, z.null()]).optional(),
    visitStatus: z.union([VisitStatusSchema, z.null()]).optional(),
    practitionerId: z.union([PmsIdSchema, z.null()]).optional(),
    /** Date of the treatment (service lines). */
    serviceOn: OptionalDateSchema,
    /** Shown on the invoice; defaults to the appointment type's name. Encrypted (may describe treatment). */
    description: optionalText(200),
    /** The payer's own code for the service (insurer e-billing). */
    billingCode: BillingCodeSchema,
    quantity: z.number().int().min(1).max(99).optional(),
    unitPricePence: z.number().int("Whole pence only").min(-100_000_000).max(100_000_000),
    discountPence: MoneyPenceSchema.optional(),
    /** Ignored (always "none") when the clinic is not VAT-registered; default: the appointment type's VAT code. */
    vatCode: VatCodeSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const kind = v.kind ?? "service";
    if (kind === "service" && !v.serviceId) ctx.addIssue({ code: "custom", path: ["serviceId"], message: "Choose the appointment type" });
    if (kind === "service" && !v.serviceOn) ctx.addIssue({ code: "custom", path: ["serviceOn"], message: "Enter the date of the appointment" });
    if (kind !== "service" && (v.appointmentId || v.visitStatus)) ctx.addIssue({ code: "custom", path: ["appointmentId"], message: "Only treatment lines bill an appointment" });
    if (kind !== "excess_deduction" && v.unitPricePence < 0) ctx.addIssue({ code: "custom", path: ["unitPricePence"], message: "A price cannot be negative" });
    if (kind === "excess_deduction" && v.unitPricePence > 0) ctx.addIssue({ code: "custom", path: ["unitPricePence"], message: "An excess deduction is negative" });
    if ((kind === "excess" || kind === "excess_deduction") && v.vatCode && v.vatCode !== "exempt" && v.vatCode !== "none") {
      ctx.addIssue({ code: "custom", path: ["vatCode"], message: "An insurance excess carries no VAT" });
    }
    const gross = Math.abs(v.unitPricePence) * (v.quantity ?? 1);
    if ((v.discountPence ?? 0) > gross) ctx.addIssue({ code: "custom", path: ["discountPence"], message: "The discount is more than the line" });
  });
export type InvoiceLineInput = z.input<typeof InvoiceLineInputSchema>;
export type ParsedInvoiceLine = z.output<typeof InvoiceLineInputSchema>;

const draftShape = {
  patientId: PmsIdSchema,
  /** The site the invoice belongs to (site-limited members see only their sites' invoices). */
  siteId: z.union([PmsIdSchema, z.null()]).optional(),
  /** The case (episode of care) – required when the payer account is billed. */
  caseId: z.union([PmsIdSchema, z.null()]).optional(),
  billTo: BillToSchema.optional(),
  /** The treatment authorisation (insurer pre-authorisation) this invoice uses. */
  authorisationId: z.union([PmsIdSchema, z.null()]).optional(),
  /** Diagnosis / condition code for the payer (e.g. ICD-10). Encrypted. */
  diagnosisCode: optionalText(40),
  /** Note printed on the invoice. Encrypted. */
  notes: optionalText(2000),
  lines: z.array(InvoiceLineInputSchema).min(1, "Add at least one line").max(MAX_INVOICE_LINES, `At most ${MAX_INVOICE_LINES} lines`),
  importRef: optionalText(80),
};

export const InvoiceDraftInputSchema = z
  .object(draftShape)
  .superRefine((v, ctx) => {
    if ((v.billTo ?? "patient") === "payer" && !v.caseId) ctx.addIssue({ code: "custom", path: ["caseId"], message: "Choose the case whose payer is billed" });
    if (v.authorisationId && !v.caseId) ctx.addIssue({ code: "custom", path: ["authorisationId"], message: "An authorisation belongs to a case" });
    const appts = v.lines.map((l) => l.appointmentId).filter((a): a is string => typeof a === "string");
    if (new Set(appts).size !== appts.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "An appointment is on two lines" });
  });
export type InvoiceDraftInput = z.input<typeof InvoiceDraftInputSchema>;

/** Editing a draft: the whole draft again (lines replaced). */
export const InvoiceDraftPatchSchema = z.object({
  authorisationId: z.union([PmsIdSchema, z.null()]).optional(),
  diagnosisCode: optionalText(40),
  notes: optionalText(2000),
  lines: z.array(InvoiceLineInputSchema).min(1, "Add at least one line").max(MAX_INVOICE_LINES).optional(),
});
export type InvoiceDraftPatch = z.input<typeof InvoiceDraftPatchSchema>;

export const IssueInvoiceInputSchema = z.object({
  /** The invoice date (default today, never in the future). */
  issuedOn: OptionalDateSchema,
  /** Default: the invoice date plus the clinic's terms for the patient or the payer. */
  dueOn: OptionalDateSchema,
});
export type IssueInvoiceInput = z.input<typeof IssueInvoiceInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Credit notes
 * ----------------------------------------------------------------------------------------------*/

export const CreditNoteInputSchema = z
  .object({
    invoiceId: PmsIdSchema,
    /** Lines credited and how much of each (whole pence, VAT included). */
    lines: z
      .array(z.object({ invoiceLineId: PmsIdSchema, totalPence: z.number().int().min(1).max(100_000_000) }))
      .min(1, "Choose at least one line to credit")
      .max(MAX_INVOICE_LINES),
    /** Why (shown on the credit note). Encrypted. */
    reason: z.string().trim().min(3, "Say why the invoice is credited").max(500),
    issuedOn: OptionalDateSchema,
  })
  .refine((v) => new Set(v.lines.map((l) => l.invoiceLineId)).size === v.lines.length, { message: "A line is listed twice", path: ["lines"] });
export type CreditNoteInput = z.input<typeof CreditNoteInputSchema>;

/** What a credit note is for (migration 0132). Every kind is a numbered credit note. */
export const CREDIT_NOTE_KINDS = ["credit", "write_off", "void", "transfer"] as const;
export const CreditNoteKindSchema = z.enum(CREDIT_NOTE_KINDS);

/** Why an amount is written off (the remittance screen's choices). Stored, encrypted, as the credit note's reason. */
export const WRITE_OFF_REASONS = ["above_agreed_rate", "not_covered", "small_balance", "bad_debt", "goodwill", "other"] as const;
export const WriteOffReasonSchema = z.enum(WRITE_OFF_REASONS);

export const WriteOffInputSchema = z.object({
  invoiceId: PmsIdSchema,
  amountPence: z.number().int("Whole pence only").min(1, "Enter an amount").max(100_000_000),
  reason: WriteOffReasonSchema,
  /** A few words more (encrypted with the reason). */
  note: optionalText(300),
  issuedOn: OptionalDateSchema,
});
export type WriteOffInput = z.input<typeof WriteOffInputSchema>;

export const VoidInvoiceInputSchema = z.object({ reason: z.string().trim().min(3, "Say why the invoice is void").max(300) });
export type VoidInvoiceInput = z.input<typeof VoidInvoiceInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Payments and allocations
 * ----------------------------------------------------------------------------------------------*/

export const AllocationInputSchema = z.object({ invoiceId: PmsIdSchema, amountPence: z.number().int().min(1).max(100_000_000) });
export type AllocationInput = z.input<typeof AllocationInputSchema>;

/** More allocations for a recorded payment. */
export const AllocationsInputSchema = z
  .object({ allocations: z.array(AllocationInputSchema).min(1, "Choose at least one invoice").max(500) })
  .refine((v) => new Set(v.allocations.map((a) => a.invoiceId)).size === v.allocations.length, { message: "An invoice is listed twice", path: ["allocations"] });

export const PaymentInputSchema = z
  .object({
    kind: PaymentKindSchema.optional(),
    payerKind: PayerKindSchema,
    patientId: z.union([PmsIdSchema, z.null()]).optional(),
    payerReferrerId: z.union([PmsIdSchema, z.null()]).optional(),
    receivedOn: IsoDateSchema,
    method: PaymentMethodSchema,
    amountPence: z.number().int().min(1, "Enter an amount").max(100_000_000),
    /** Remittance, bank or card terminal reference. Not clinical. */
    reference: optionalText(80),
    /** Encrypted. */
    notes: optionalText(1000),
    /** Spread over invoices now (the rest stays on account). */
    allocations: z.array(AllocationInputSchema).max(100).optional(),
    /** The site it was taken at (null: not at a site, e.g. a remittance by bank transfer). */
    siteId: z.union([PmsIdSchema, z.null()]).optional(),
    importRef: optionalText(80),
  })
  .superRefine((v, ctx) => {
    if (v.payerKind === "patient" && !v.patientId) ctx.addIssue({ code: "custom", path: ["patientId"], message: "Choose the patient" });
    if (v.payerKind === "account" && !v.payerReferrerId) ctx.addIssue({ code: "custom", path: ["payerReferrerId"], message: "Choose the payer account" });
    if (v.payerKind === "patient" && v.payerReferrerId) ctx.addIssue({ code: "custom", path: ["payerReferrerId"], message: "A patient's payment has no payer account" });
    const sum = (v.allocations ?? []).reduce((a, x) => a + x.amountPence, 0);
    if (sum > v.amountPence) ctx.addIssue({ code: "custom", path: ["allocations"], message: "More is allocated than was received" });
    const ids = (v.allocations ?? []).map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["allocations"], message: "An invoice is listed twice" });
  });
export type PaymentInput = z.input<typeof PaymentInputSchema>;

export const ReversePaymentInputSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(300) });

/* ------------------------------------------------------------------------------------------------
 * Take payment (the dialog) and insurer remittances
 * ----------------------------------------------------------------------------------------------*/

/** The take-payment dialog's methods (design round 3). Card on file and payment links go through the provider (TEST MODE ONLY). */
export const TAKE_PAYMENT_METHODS = ["card_on_file", "card_now", "cash", "bank_transfer", "payment_link"] as const;
export const TakePaymentMethodSchema = z.enum(TAKE_PAYMENT_METHODS);
export type TakePaymentMethod = (typeof TAKE_PAYMENT_METHODS)[number];

export const TakePaymentInputSchema = z
  .object({
    patientId: PmsIdSchema,
    method: TakePaymentMethodSchema,
    amountPence: z.number().int("Whole pence only").min(1, "Enter an amount").max(100_000_000),
    /** Oldest first unless changed; the rest stays on the patient's account. */
    allocations: z.array(AllocationInputSchema).max(40).optional(),
    /** Card on file: which saved card. */
    savedCardId: z.union([PmsIdSchema, z.null()]).optional(),
    /** Cash: what the patient handed over (for the change). */
    tenderedPence: z.number().int().min(0).max(100_000_000).optional(),
    /** Bank transfer / card terminal reference. Not clinical. */
    reference: optionalText(80),
    siteId: z.union([PmsIdSchema, z.null()]).optional(),
  })
  .superRefine((v, ctx) => {
    const sum = (v.allocations ?? []).reduce((a, x) => a + x.amountPence, 0);
    if (sum > v.amountPence) ctx.addIssue({ code: "custom", path: ["allocations"], message: "More is allocated than is being taken" });
    const ids = (v.allocations ?? []).map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["allocations"], message: "An invoice is listed twice" });
    if (v.method === "card_on_file" && !v.savedCardId) ctx.addIssue({ code: "custom", path: ["savedCardId"], message: "Choose the saved card" });
    if (v.method === "cash" && v.tenderedPence !== undefined && v.tenderedPence < v.amountPence) ctx.addIssue({ code: "custom", path: ["tenderedPence"], message: "Less cash was handed over than is being taken" });
  });
export type TakePaymentInput = z.input<typeof TakePaymentInputSchema>;

/** What happens to the part of an invoice an insurer did not pay. */
export const SHORTFALL_ACTIONS = ["leave", "write_off", "patient"] as const;
export const ShortfallActionSchema = z.enum(SHORTFALL_ACTIONS);
export type ShortfallAction = (typeof SHORTFALL_ACTIONS)[number];

export const RemittanceInputSchema = z
  .object({
    payerReferrerId: PmsIdSchema,
    amountPence: z.number().int("Whole pence only").min(1, "Enter the amount received").max(100_000_000),
    reference: z.string().trim().min(1, "Enter the remittance reference").max(80),
    receivedOn: IsoDateSchema,
    method: PaymentMethodSchema,
    rows: z
      .array(
        z.object({
          invoiceId: PmsIdSchema,
          /** Paid now against this invoice (0 = only a shortfall action). */
          paidPence: z.number().int().min(0).max(100_000_000),
          shortfall: ShortfallActionSchema,
          writeOffReason: WriteOffReasonSchema.optional(),
        }),
      )
      .min(1, "Choose at least one invoice")
      .max(40, "At most 40 invoices in one allocation – save and continue"),
  })
  .superRefine((v, ctx) => {
    const sum = v.rows.reduce((a, r) => a + r.paidPence, 0);
    if (sum > v.amountPence) ctx.addIssue({ code: "custom", path: ["rows"], message: "More is allocated than was received" });
    const ids = v.rows.map((r) => r.invoiceId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["rows"], message: "An invoice is listed twice" });
    v.rows.forEach((r, i) => {
      if (r.shortfall === "write_off" && !r.writeOffReason) ctx.addIssue({ code: "custom", path: ["rows", i, "writeOffReason"], message: "Choose why it is written off" });
    });
  });
export type RemittanceInput = z.input<typeof RemittanceInputSchema>;

/** Invoice the chosen chargeable visits (design round 3 "Invoice visits"). */
export const InvoiceVisitsInputSchema = z.object({
  appointmentIds: z.array(PmsIdSchema).min(1, "Choose at least one visit").max(200),
  /** Issue the drafts straight away (step 3), or keep them as drafts. */
  issue: z.boolean().optional(),
});
export type InvoiceVisitsInput = z.input<typeof InvoiceVisitsInputSchema>;
