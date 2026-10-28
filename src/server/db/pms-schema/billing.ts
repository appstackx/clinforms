/**
 * Tables of the billing module (migrations 0130–0131 / 20261024000130–…131): billing settings, VAT per appointment
 * type, invoices and their lines, credit notes and their lines, payments and refunds, their allocations to
 * invoices, card payment links (test mode) and the e-billing export log. Conventions: docs/clinic-system/contract.md
 * §4 and docs/clinic-system/billing.md.
 *
 * - Every table has tenant_id; record tables PRIMARY KEY (tenant_id, id), foreign keys that include tenant_id.
 * - Money in whole pence; calendar dates TEXT "YYYY-MM-DD" on both dialects; timestamps ISO TEXT / timestamptz.
 * - _enc columns: AES-GCM with AAD "<tenant>:<table>.<column>:<id>" (line descriptions, notes, reasons,
 *   diagnosis codes, the bill-to snapshot).
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

export interface PmsBillingSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  invoice_prefix: WithDefault<string>;
  credit_note_prefix: WithDefault<string>;
  first_invoice_number: WithDefault<number>;
  first_credit_note_number: WithDefault<number>;
  self_pay_terms_days: WithDefault<number>;
  account_terms_days: WithDefault<number>;
  vat_registered: WithDefault<number>;
  vat_number: string | null;
  prices_include_vat: WithDefault<number>;
  dna_charge_percent: WithDefault<number>;
  late_cancel_charge_percent: WithDefault<number>;
  payment_instructions: string | null;
  payment_links_enabled: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsServiceVatTable {
  tenant_id: string;
  service_id: string;
  /** "exempt" | "standard" | "reduced" | "zero" */
  vat_code: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsInvoicesTable {
  tenant_id: string;
  id: string;
  rev: number;
  /** "draft" | "issued" | "cancelled" */
  status: WithDefault<string>;
  number_prefix: string | null;
  number_seq: number | null;
  patient_id: string;
  case_id: string | null;
  /** "patient" | "payer" */
  bill_to: string;
  payer_type: string;
  payer_referrer_id: string | null;
  authorisation_id: string | null;
  related_invoice_id: string | null;
  issued_on: IsoDate | null;
  due_on: IsoDate | null;
  first_service_on: IsoDate | null;
  last_service_on: IsoDate | null;
  net_pence: number;
  vat_pence: number;
  total_pence: number;
  paid_pence: WithDefault<number>;
  credited_pence: WithDefault<number>;
  prices_include_vat: number;
  auth_sessions: WithDefault<number>;
  auth_value_pence: WithDefault<number>;
  bill_to_enc: string | null;
  diagnosis_enc: string | null;
  notes_enc: string | null;
  exported_at: IsoTimestamp | null;
  /** Random token of the latest draft edit (the batch's later statements check it applied). */
  edit_token: string | null;
  import_ref: string | null;
  created_by: string | null;
  issued_by: string | null;
  issued_at: IsoTimestamp | null;
  cancelled_at: IsoTimestamp | null;
  /** 0133: the site of the visits it bills (site scope); null = no site. */
  site_id: string | null;
  /** 0134: when an issued invoice was voided (a full credit note of kind "void"). */
  voided_at: IsoTimestamp | null;
  /** 0138: the patient contribution per visit the split used (NULL = the excess per case, or no split). */
  per_visit_contribution_pence: number | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsInvoiceLinesTable {
  tenant_id: string;
  id: string;
  invoice_id: string;
  line_no: number;
  kind: string;
  service_id: string | null;
  appointment_id: string | null;
  visit_status: string | null;
  practitioner_id: string | null;
  service_on: IsoDate | null;
  description_enc: string | null;
  billing_code: string | null;
  quantity: number;
  unit_price_pence: number;
  discount_pence: WithDefault<number>;
  vat_code: string;
  vat_rate_bp: number;
  net_pence: number;
  vat_pence: number;
  total_pence: number;
  credited_pence: WithDefault<number>;
  /** 1 while the line holds its appointment (a draft or issued invoice, not fully credited). */
  billing_lock: WithDefault<number>;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsCreditNotesTable {
  tenant_id: string;
  id: string;
  invoice_id: string;
  number_prefix: string;
  number_seq: number;
  issued_on: IsoDate;
  net_pence: number;
  vat_pence: number;
  total_pence: number;
  reason_enc: string | null;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  /** 0132: "credit" | "write_off" | "void" | "transfer". */
  kind: WithDefault<string>;
}

export interface PmsCreditNoteLinesTable {
  tenant_id: string;
  id: string;
  credit_note_id: string;
  invoice_line_id: string;
  net_pence: number;
  vat_pence: number;
  total_pence: number;
  /** What was left to credit on the invoice line after this one (the database refuses a negative). */
  line_remaining_after: number;
  created_at: IsoTimestamp;
}

export interface PmsPaymentsTable {
  tenant_id: string;
  id: string;
  kind: WithDefault<string>;
  status: WithDefault<string>;
  payer_kind: string;
  patient_id: string | null;
  payer_referrer_id: string | null;
  received_on: IsoDate;
  method: string;
  amount_pence: number;
  allocated_pence: WithDefault<number>;
  reference: string | null;
  notes_enc: string | null;
  provider: WithDefault<string>;
  provider_ref: string | null;
  reversed_at: IsoTimestamp | null;
  reversed_by: string | null;
  reverse_reason_enc: string | null;
  import_ref: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  /** 0135: the site the payment was taken at; null = none (e.g. a remittance). */
  site_id: string | null;
}

export interface PmsPaymentAllocationsTable {
  tenant_id: string;
  id: string;
  payment_id: string;
  invoice_id: string;
  /** Positive for a payment, negative for a refund. */
  amount_pence: number;
  /** The invoice's balance after this allocation (the database refuses one past zero). */
  invoice_balance_after: number;
  reversed: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsPaymentLinksTable {
  tenant_id: string;
  id: string;
  invoice_id: string;
  provider: string;
  mode: string;
  provider_link_id: string;
  url: string;
  amount_pence: number;
  status: WithDefault<string>;
  last_checked_at: IsoTimestamp | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsInvoiceExportsTable {
  tenant_id: string;
  id: string;
  invoice_id: string;
  channel: string;
  batch_ref: string;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** 0136: a patient's saved card – TEST MODE ONLY; provider references and receipt details, never a card number. */
export interface PmsSavedCardsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  provider: string;
  mode: string;
  customer_ref: string;
  method_ref: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  /** "active" | "removed" */
  status: WithDefault<string>;
  created_by: string | null;
  removed_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0137: how a payer account bills the patient's part of an insured visit ("per_case" | "per_visit"). */
export interface PmsPayerBillingTermsTable {
  tenant_id: string;
  referrer_id: string;
  rev: number;
  contribution_mode: string;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0137: a case's own override of its payer account's mode (NULL = as the payer account). */
export interface PmsCaseBillingTermsTable {
  tenant_id: string;
  case_id: string;
  rev: number;
  contribution_mode: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface BillingTables {
  pms_billing_settings: PmsBillingSettingsTable;
  pms_service_vat: PmsServiceVatTable;
  pms_invoices: PmsInvoicesTable;
  pms_invoice_lines: PmsInvoiceLinesTable;
  pms_credit_notes: PmsCreditNotesTable;
  pms_credit_note_lines: PmsCreditNoteLinesTable;
  pms_payments: PmsPaymentsTable;
  pms_payment_allocations: PmsPaymentAllocationsTable;
  pms_payment_links: PmsPaymentLinksTable;
  pms_invoice_exports: PmsInvoiceExportsTable;
  pms_saved_cards: PmsSavedCardsTable;
  pms_payer_billing_terms: PmsPayerBillingTermsTable;
  pms_case_billing_terms: PmsCaseBillingTermsTable;
}

/** Foreign-key order (parents first). */
export const BILLING_TABLES = [
  "pms_billing_settings",
  "pms_service_vat",
  "pms_invoices",
  "pms_invoice_lines",
  "pms_credit_notes",
  "pms_credit_note_lines",
  "pms_payments",
  "pms_payment_allocations",
  "pms_payment_links",
  "pms_invoice_exports",
  "pms_saved_cards",
  "pms_payer_billing_terms",
  "pms_case_billing_terms",
] as const satisfies readonly (keyof BillingTables)[];

export const BILLING_PRIMARY_KEYS: { readonly [T in (typeof BILLING_TABLES)[number]]: readonly (keyof BillingTables[T] & string)[] } = {
  pms_billing_settings: ["tenant_id"],
  pms_service_vat: ["tenant_id", "service_id"],
  pms_invoices: ["tenant_id", "id"],
  pms_invoice_lines: ["tenant_id", "id"],
  pms_credit_notes: ["tenant_id", "id"],
  pms_credit_note_lines: ["tenant_id", "id"],
  pms_payments: ["tenant_id", "id"],
  pms_payment_allocations: ["tenant_id", "id"],
  pms_payment_links: ["tenant_id", "id"],
  pms_invoice_exports: ["tenant_id", "id"],
  pms_saved_cards: ["tenant_id", "id"],
  pms_payer_billing_terms: ["tenant_id", "referrer_id"],
  pms_case_billing_terms: ["tenant_id", "case_id"],
};

/** Timestamp columns beyond created_at/updated_at (TEXT in SQLite, timestamptz in Postgres) – the D1 → Postgres copy. */
export const BILLING_TIMESTAMP_COLUMNS: readonly string[] = ["issued_at", "cancelled_at", "exported_at", "reversed_at", "last_checked_at", "voided_at", "removed_at"];

/** Every billing table holds one clinic's data (offboarding exports them decrypted, then deletes them). */
export const BILLING_TENANT_TABLES: readonly (typeof BILLING_TABLES)[number][] = BILLING_TABLES;
