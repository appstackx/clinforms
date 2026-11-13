/**
 * Tables of the billing module (migrations 0130–0139, 0212, the Healthcode groundwork 0220–0229 and courses, gift
 * cards and products 0231–0239, card payments 0226–0229 and 0239–0241): billing settings, VAT per appointment
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
  /** JSON {"accountName","sortCode","accountNumber"} (0139), NULL = none. */
  bank_details_json: string | null;
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

/** 0220 (Healthcode, HC06): a payer account's Healthcode identifier and the clinic's provider number with it. */
export interface PmsPayerHealthcodeTable {
  tenant_id: string;
  referrer_id: string;
  rev: number;
  /** The insurer's Healthcode identifier (e.g. "bup"). */
  insurer_code: string | null;
  /** The clinic's provider number with this insurer. */
  provider_number: string | null;
  /** 0/1; NULL = the default for the insurer's name (src/modules/pms/billing/healthcode.ts). */
  diagnosis_required: number | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0221 (Healthcode, HC07): the clinic's Healthcode Site ID and payee provider number. */
export interface PmsHealthcodeSettingsTable {
  tenant_id: string;
  rev: number;
  site_code: string | null;
  payee_provider_number: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0221 (Healthcode, HC07): a site's own Site ID and payee provider number (NULL = the clinic's). */
export interface PmsSiteHealthcodeTable {
  tenant_id: string;
  site_id: string;
  rev: number;
  site_code: string | null;
  payee_provider_number: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0222 (Healthcode, HC08): a practitioner's provider number with one insurer. */
export interface PmsPractitionerInsurerNumbersTable {
  tenant_id: string;
  practitioner_id: string;
  referrer_id: string;
  rev: number;
  provider_number: string;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0223 (Healthcode, HC09): a service's CCSD code. */
export interface PmsServiceCodesTable {
  tenant_id: string;
  service_id: string;
  rev: number;
  ccsd_code: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0223 (Healthcode, HC09): an insurer's own treatment code (ISC) for a service. */
export interface PmsServiceInsurerCodesTable {
  tenant_id: string;
  service_id: string;
  referrer_id: string;
  rev: number;
  isc_code: string;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0224 (Healthcode, HC10): a case's ICD-10 diagnosis code (encrypted). `id` IS the case id (one row per case). */
export interface PmsCaseDiagnosisTable {
  tenant_id: string;
  id: string;
  rev: number;
  diagnosis_enc: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0225 (Healthcode, HC13): an insurer invoice's bill status, set by hand (NULL = not set). */
export interface PmsInvoiceBillStatusTable {
  tenant_id: string;
  invoice_id: string;
  rev: number;
  /** "exported" | "validated" | "failed" | "collected" | "paid" | NULL */
  status: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0231 (courses, PK02): a course the clinic sells – sessions, the services it covers, price, days valid. */
export interface PmsCourseTypesTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  /** JSON array of pms_services ids the course covers. */
  service_ids_json: string;
  sessions: number;
  price_pence: number;
  /** "exempt" | "standard" | "reduced" | "zero" */
  vat_code: string;
  /** Days valid from the sale; NULL = no expiry. */
  valid_days: number | null;
  active: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0232 (courses, PK02): a course sold to a patient (made when the invoice selling it is issued). */
export interface PmsPatientCoursesTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  course_type_id: string;
  case_id: string | null;
  sale_invoice_id: string;
  sale_line_id: string;
  sessions_total: number;
  /** The services sold (JSON array), fixed at the sale; NULL = the course type's. */
  service_ids_json: string | null;
  sold_on: IsoDate;
  expires_on: IsoDate | null;
  /** "active" | "used_up" | "expired" | "cancelled" */
  status: WithDefault<string>;
  cancelled_at: IsoTimestamp | null;
  cancel_credit_note_id: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0233 (courses, PK02): a visit used from a course (one per appointment while not reversed). */
export interface PmsCourseUsesTable {
  tenant_id: string;
  id: string;
  patient_course_id: string;
  appointment_id: string;
  used_on: IsoDate;
  reversed_at: IsoTimestamp | null;
  reversed_by: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0238 (PK02): what an item line sells – a course (ref_id = the course type), a gift card or a product. */
export interface PmsInvoiceLineRefsTable {
  tenant_id: string;
  invoice_line_id: string;
  /** "course" | "gift_card" | "product" */
  ref_type: string;
  ref_id: string;
  /** Courses: the sessions, services and validity sold (JSON), taken with the draft. NULL = read the course type. */
  snapshot_json: string | null;
  created_at: IsoTimestamp;
}

/** 0234 (gift cards, PK04): a card sold on an invoice line; the code only as SHA-256 + last 4. */
export interface PmsGiftCardsTable {
  tenant_id: string;
  id: string;
  rev: number;
  code_sha256: string;
  code_last4: string;
  initial_pence: number;
  balance_pence: number;
  sold_on: IsoDate | null;
  expires_on: IsoDate | null;
  sale_invoice_id: string | null;
  sale_line_id: string | null;
  buyer_patient_id: string | null;
  recipient_name_enc: string | null;
  /** "pending" | "active" | "used" | "expired" | "cancelled" */
  status: string;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0235 (gift cards, PK04): every change to a card's balance (append-only). */
export interface PmsGiftCardMovesTable {
  tenant_id: string;
  id: string;
  gift_card_id: string;
  /** "sale" | "redeem" | "refund" | "expire" | "adjust" */
  kind: string;
  amount_pence: number;
  payment_id: string | null;
  balance_after: number;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** 0236 (products, PK05): what the clinic sells over the counter. */
export interface PmsProductsTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  sku: string | null;
  price_pence: number;
  /** "exempt" | "standard" | "reduced" | "zero" */
  vat_code: string;
  low_stock_at: number | null;
  active: WithDefault<number>;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0237 (stock, PK05): append-only stock changes per product and site. */
export interface PmsStockMovesTable {
  tenant_id: string;
  id: string;
  product_id: string;
  site_id: string;
  /** "received" | "sold" | "returned" | "adjusted" */
  kind: string;
  quantity: number;
  invoice_line_id: string | null;
  reason_enc: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
}

/** 0226 (card payments): one row per clinic – its connected payment account, switch, fee and missed-appointment policy. */
export interface PmsCardSettingsTable {
  tenant_id: string;
  rev: WithDefault<number>;
  enabled: WithDefault<number>;
  account_ref: string | null;
  /** "test" | "live" */
  account_mode: string | null;
  /** "none" | "pending" | "active" | "restricted" | "closed" */
  account_status: WithDefault<string>;
  card_capability: string | null;
  payouts_capability: string | null;
  requirements_due: WithDefault<number>;
  last_synced_at: IsoTimestamp | null;
  fee_bps: WithDefault<number>;
  fee_fixed_pence: WithDefault<number>;
  no_show_enabled: WithDefault<number>;
  no_show_policy: string | null;
  updated_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0227 (card payments): card readers at the desk, per site. */
export interface PmsCardReadersTable {
  tenant_id: string;
  id: string;
  site_id: string;
  account_ref: string;
  location_ref: string;
  reader_ref: string;
  label: string;
  device_type: string | null;
  simulated: WithDefault<number>;
  /** "active" | "removed" */
  status: WithDefault<string>;
  removed_at: IsoTimestamp | null;
  removed_by: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0228 (card payments): every payment, card set-up and refund made through the clinic's account. */
export interface PmsCardIntentsTable {
  tenant_id: string;
  id: string;
  /** "payment" | "setup" | "refund" */
  kind: string;
  /** "reader" | "saved_card" | "portal" | "membership" | "save_card" | "refund" */
  purpose: string;
  /** "open" | "processing" | "succeeded" | "failed" | "canceled" */
  status: WithDefault<string>;
  intent_ref: string | null;
  checkout_ref: string | null;
  parent_ref: string | null;
  invoice_id: string | null;
  patient_id: string | null;
  mandate_id: string | null;
  reader_id: string | null;
  membership_id: string | null;
  period: string | null;
  amount_pence: number;
  fee_pence: WithDefault<number>;
  payment_id: string | null;
  failure_code: string | null;
  attempts: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0229 (card payments): webhook events handled, one row per event id. */
export interface PmsCardEventsTable {
  tenant_id: string;
  id: string;
  type: string;
  object_ref: string | null;
  outcome: string;
  created_at: IsoTimestamp;
}

/** 0239 (card payments): a card on file and the patient's consent to it. */
export interface PmsCardMandatesTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  /** "pending" | "active" | "removed" | "failed" */
  status: WithDefault<string>;
  account_ref: string;
  customer_ref: string;
  method_ref: string | null;
  setup_ref: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  consent_wording: string;
  consent_version: string;
  /** "portal" | "desk" | "phone" */
  consent_channel: string;
  consent_recorded_by: string | null;
  consent_at: IsoTimestamp;
  allows_no_show: WithDefault<number>;
  removed_at: IsoTimestamp | null;
  removed_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0240 (memberships): plans with a monthly price. */
export interface PmsMembershipPlansTable {
  tenant_id: string;
  id: string;
  rev: WithDefault<number>;
  name: string;
  price_pence: number;
  /** "exempt" | "standard" | "reduced" | "zero" */
  vat_code: WithDefault<string>;
  active: WithDefault<number>;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** 0241 (memberships): a patient's membership, charged monthly to a saved card. */
export interface PmsMembershipsTable {
  tenant_id: string;
  id: string;
  rev: WithDefault<number>;
  patient_id: string;
  plan_id: string;
  mandate_id: string;
  site_id: string | null;
  /** "active" | "payment_failed" | "cancelled" */
  status: WithDefault<string>;
  charge_day: number;
  started_on: IsoDate;
  next_charge_on: IsoDate | null;
  attempts: WithDefault<number>;
  consent_wording: string;
  consent_channel: string;
  consent_recorded_by: string | null;
  consent_at: IsoTimestamp;
  cancelled_at: IsoTimestamp | null;
  cancelled_by: string | null;
  created_by: string | null;
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
  pms_payer_healthcode: PmsPayerHealthcodeTable;
  pms_healthcode_settings: PmsHealthcodeSettingsTable;
  pms_site_healthcode: PmsSiteHealthcodeTable;
  pms_practitioner_insurer_numbers: PmsPractitionerInsurerNumbersTable;
  pms_service_codes: PmsServiceCodesTable;
  pms_service_insurer_codes: PmsServiceInsurerCodesTable;
  pms_case_diagnosis: PmsCaseDiagnosisTable;
  pms_invoice_bill_status: PmsInvoiceBillStatusTable;
  pms_course_types: PmsCourseTypesTable;
  pms_patient_courses: PmsPatientCoursesTable;
  pms_course_uses: PmsCourseUsesTable;
  pms_invoice_line_refs: PmsInvoiceLineRefsTable;
  pms_gift_cards: PmsGiftCardsTable;
  pms_gift_card_moves: PmsGiftCardMovesTable;
  pms_products: PmsProductsTable;
  pms_stock_moves: PmsStockMovesTable;
  pms_card_settings: PmsCardSettingsTable;
  pms_card_readers: PmsCardReadersTable;
  pms_card_intents: PmsCardIntentsTable;
  pms_card_events: PmsCardEventsTable;
  pms_card_mandates: PmsCardMandatesTable;
  pms_membership_plans: PmsMembershipPlansTable;
  pms_memberships: PmsMembershipsTable;
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
  "pms_payer_healthcode",
  "pms_healthcode_settings",
  "pms_site_healthcode",
  "pms_practitioner_insurer_numbers",
  "pms_service_codes",
  "pms_service_insurer_codes",
  "pms_case_diagnosis",
  "pms_invoice_bill_status",
  "pms_course_types",
  "pms_patient_courses",
  "pms_course_uses",
  "pms_invoice_line_refs",
  "pms_gift_cards",
  "pms_gift_card_moves",
  "pms_products",
  "pms_stock_moves",
  "pms_card_settings",
  "pms_card_readers",
  "pms_card_intents",
  "pms_card_events",
  "pms_card_mandates",
  "pms_membership_plans",
  "pms_memberships",
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
  pms_payer_healthcode: ["tenant_id", "referrer_id"],
  pms_healthcode_settings: ["tenant_id"],
  pms_site_healthcode: ["tenant_id", "site_id"],
  pms_practitioner_insurer_numbers: ["tenant_id", "practitioner_id", "referrer_id"],
  pms_service_codes: ["tenant_id", "service_id"],
  pms_service_insurer_codes: ["tenant_id", "service_id", "referrer_id"],
  pms_case_diagnosis: ["tenant_id", "id"],
  pms_invoice_bill_status: ["tenant_id", "invoice_id"],
  pms_course_types: ["tenant_id", "id"],
  pms_patient_courses: ["tenant_id", "id"],
  pms_course_uses: ["tenant_id", "id"],
  pms_invoice_line_refs: ["tenant_id", "invoice_line_id"],
  pms_gift_cards: ["tenant_id", "id"],
  pms_gift_card_moves: ["tenant_id", "id"],
  pms_products: ["tenant_id", "id"],
  pms_stock_moves: ["tenant_id", "id"],
  pms_card_settings: ["tenant_id"],
  pms_card_readers: ["tenant_id", "id"],
  pms_card_intents: ["tenant_id", "id"],
  pms_card_events: ["tenant_id", "id"],
  pms_card_mandates: ["tenant_id", "id"],
  pms_membership_plans: ["tenant_id", "id"],
  pms_memberships: ["tenant_id", "id"],
};

/** Timestamp columns beyond created_at/updated_at (TEXT in SQLite, timestamptz in Postgres) – the D1 → Postgres copy. */
export const BILLING_TIMESTAMP_COLUMNS: readonly string[] = ["issued_at", "cancelled_at", "exported_at", "reversed_at", "last_checked_at", "voided_at", "removed_at", "last_synced_at", "consent_at"];

/**
 * Healthcode groundwork tables (0220–0225): each row hangs off one parent row (a payer account, the clinic's billing
 * settings, a site, practitioner, service, case or invoice) by a foreign key with ON DELETE CASCADE, so offboarding deletes them with their parents
 * and does not name them in its batch (the gateway's statement limit – src/server/auth/offboard-batch.test.ts). They
 * are still exported and counted like every other table.
 */
export const HEALTHCODE_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = [
  "pms_payer_healthcode",
  "pms_healthcode_settings",
  "pms_site_healthcode",
  "pms_practitioner_insurer_numbers",
  "pms_service_codes",
  "pms_service_insurer_codes",
  "pms_case_diagnosis",
  "pms_invoice_bill_status",
];

/**
 * Courses (0231–0233, 0238): course types go with the clinic's billing settings row (written in the same batch as
 * each type); a patient's courses with their patient, course type, case, invoice and sale line; their uses with the
 * course; a line's reference with the line.
 */
export const COURSE_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = ["pms_course_types", "pms_patient_courses", "pms_course_uses", "pms_invoice_line_refs"];

/** Gift cards (0234–0235): cards go with the clinic's billing settings row (and buyer, invoice, line); moves with their card. */
export const GIFT_CARD_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = ["pms_gift_cards", "pms_gift_card_moves"];

/** Products and stock (0236–0237): products go with the clinic's billing settings row; moves with product, site and line. */
export const PRODUCT_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = ["pms_products", "pms_stock_moves"];

/**
 * Card payments (0226–0229, 0239–0241): the clinic's card settings row goes with its billing settings row; readers,
 * intents, events, saved cards, membership plans and memberships with the card settings row (and their site, invoice,
 * patient, plan or saved card).
 */
export const CARD_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = [
  "pms_card_settings",
  "pms_card_readers",
  "pms_card_intents",
  "pms_card_events",
  "pms_card_mandates",
  "pms_membership_plans",
  "pms_memberships",
];

export const BILLING_CASCADE_DELETED_TABLES: readonly (typeof BILLING_TABLES)[number][] = [
  ...HEALTHCODE_CASCADE_DELETED_TABLES,
  ...CARD_CASCADE_DELETED_TABLES,
  ...COURSE_CASCADE_DELETED_TABLES,
  ...GIFT_CARD_CASCADE_DELETED_TABLES,
  ...PRODUCT_CASCADE_DELETED_TABLES,
];

/** Every billing table holds one clinic's data (offboarding exports them decrypted, then deletes them). */
export const BILLING_TENANT_TABLES: readonly (typeof BILLING_TABLES)[number][] = BILLING_TABLES;
