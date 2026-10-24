/**
 * Plumbing shared by the billing repositories (src/server/repos/pms/billing/*): row converters, the clock, the
 * batch runner and the plain messages for database refusals. Rules: ../context.ts and docs/clinic-system/billing.md.
 *
 * How the billing writes stay correct without interactive transactions (D1):
 * - every multi-statement write is ONE runBatch (atomic on D1, a transaction on Postgres and SQLite);
 * - the database itself holds the invariants (CHECK / NOT NULL / UNIQUE in migrations 0130–0131): a statement that
 *   would break one fails, and the whole batch is rolled back – so a later statement never has to "know" whether
 *   an earlier one applied;
 * - a value the write depends on is read INSIDE the statement (scalar subqueries), e.g. an allocation's invoice id
 *   is "(SELECT id FROM pms_invoices WHERE … status = 'issued' …)": no match → NULL → NOT NULL fails → rollback;
 * - on Postgres the first statement of a batch updates the row everything else depends on (a row lock), so a
 *   concurrent batch on the same invoice or payment waits and then sees the committed result.
 */
import type { Selectable } from "kysely";
import { formatDocumentNumber } from "../../../../modules/pms/billing/numbers";
import { balanceOf } from "../../../../modules/pms/billing/status";
import type { BillTo, Allocation, CreditNote, InvoiceLine, InvoiceStatus, InvoiceSummary, LineKind, Payment, PaymentKind, PaymentMethod, PaymentStatus, PayerKind, VisitStatus } from "../../../../modules/pms/billing/types";
import type { VatCode } from "../../../../modules/pms/billing/vat";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PayerType } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import type { PmsCreditNoteLinesTable, PmsCreditNotesTable, PmsInvoiceLinesTable, PmsInvoicesTable, PmsPaymentAllocationsTable, PmsPaymentsTable } from "../../../db/pms-schema/billing";
import { RepoInputError, decryptField, isOn, num, numOrNull, translateDbError, type ConstraintMessages, type DbContext, type RepoContext } from "../context";

export const INV = "pms_invoices";
export const LINES = "pms_invoice_lines";
export const CRN = "pms_credit_notes";
export const CRN_LINES = "pms_credit_note_lines";
export const PAY = "pms_payments";
export const ALLOC = "pms_payment_allocations";

/** Today in the UK ("YYYY-MM-DD") on the repository's clock. */
export function todayOf(ctx: DbContext): string {
  return ukToday(ctx.now ? ctx.now() : new Date());
}

export const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "status",
  "number_prefix",
  "number_seq",
  "patient_id",
  "case_id",
  "bill_to",
  "payer_type",
  "payer_referrer_id",
  "authorisation_id",
  "related_invoice_id",
  "issued_on",
  "due_on",
  "first_service_on",
  "last_service_on",
  "net_pence",
  "vat_pence",
  "total_pence",
  "paid_pence",
  "credited_pence",
  "exported_at",
  "created_at",
  "updated_at",
] as const;

type SummaryRow = Pick<Selectable<PmsInvoicesTable>, (typeof SUMMARY_COLUMNS)[number]>;

export function toInvoiceSummary(r: SummaryRow): InvoiceSummary {
  const amounts = { totalPence: num(r.total_pence), paidPence: num(r.paid_pence), creditedPence: num(r.credited_pence) };
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    status: r.status as InvoiceStatus,
    number: formatDocumentNumber(r.number_prefix, numOrNull(r.number_seq)),
    numberSeq: numOrNull(r.number_seq),
    patientId: r.patient_id,
    caseId: r.case_id,
    billTo: r.bill_to as BillTo,
    payerType: r.payer_type as PayerType,
    payerReferrerId: r.payer_referrer_id,
    authorisationId: r.authorisation_id,
    relatedInvoiceId: r.related_invoice_id,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    firstServiceOn: r.first_service_on,
    lastServiceOn: r.last_service_on,
    netPence: num(r.net_pence),
    vatPence: num(r.vat_pence),
    ...amounts,
    balancePence: balanceOf(amounts),
    exportedAt: r.exported_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toInvoiceLine(ctx: RepoContext, r: Selectable<PmsInvoiceLinesTable>): InvoiceLine {
  return {
    id: r.id,
    lineNo: num(r.line_no),
    kind: r.kind as LineKind,
    serviceId: r.service_id,
    appointmentId: r.appointment_id,
    visitStatus: (r.visit_status as VisitStatus | null) ?? null,
    practitionerId: r.practitioner_id,
    serviceOn: r.service_on,
    description: decryptField(ctx, r.tenant_id, LINES, "description_enc", r.id, r.description_enc),
    billingCode: r.billing_code,
    quantity: num(r.quantity),
    unitPricePence: num(r.unit_price_pence),
    discountPence: num(r.discount_pence),
    vatCode: r.vat_code as VatCode,
    vatRateBp: num(r.vat_rate_bp),
    netPence: num(r.net_pence),
    vatPence: num(r.vat_pence),
    totalPence: num(r.total_pence),
    creditedPence: num(r.credited_pence),
  };
}

export function toCreditNote(ctx: RepoContext, r: Selectable<PmsCreditNotesTable>, lines: Selectable<PmsCreditNoteLinesTable>[], withReason: boolean): CreditNote {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    number: formatDocumentNumber(r.number_prefix, num(r.number_seq)) as string,
    numberSeq: num(r.number_seq),
    invoiceId: r.invoice_id,
    issuedOn: r.issued_on,
    netPence: num(r.net_pence),
    vatPence: num(r.vat_pence),
    totalPence: num(r.total_pence),
    reason: withReason ? decryptField(ctx, r.tenant_id, CRN, "reason_enc", r.id, r.reason_enc) : null,
    lines: lines.map((l) => ({ id: l.id, invoiceLineId: l.invoice_line_id, netPence: num(l.net_pence), vatPence: num(l.vat_pence), totalPence: num(l.total_pence) })),
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export function toPayment(ctx: RepoContext, r: Selectable<PmsPaymentsTable>, withNotes: boolean): Payment {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    kind: r.kind as PaymentKind,
    status: r.status as PaymentStatus,
    payerKind: r.payer_kind as PayerKind,
    patientId: r.patient_id,
    payerReferrerId: r.payer_referrer_id,
    receivedOn: r.received_on,
    method: r.method as PaymentMethod,
    amountPence: num(r.amount_pence),
    allocatedPence: num(r.allocated_pence),
    reference: r.reference,
    notes: withNotes ? decryptField(ctx, r.tenant_id, PAY, "notes_enc", r.id, r.notes_enc) : null,
    provider: r.provider,
    providerRef: r.provider_ref,
    reversedAt: r.reversed_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export function toAllocation(r: Selectable<PmsPaymentAllocationsTable>): Allocation {
  return { id: r.id, paymentId: r.payment_id, invoiceId: r.invoice_id, amountPence: num(r.amount_pence), createdAt: r.created_at };
}

export { isOn };

/** Runs a batch, translating constraint refusals into a plain RepoInputError. */
export async function billingBatch(ctx: DbContext, queries: BatchQuery[], messages: ConstraintMessages & { notNull?: string } = {}) {
  try {
    return await runBatch(ctx.db, queries);
  } catch (err) {
    if (classifyDbError(err) === "CONSTRAINT_NOT_NULL") throw new RepoInputError(messages.notNull ?? "That record is not in a state that allows this.");
    throw translateDbError(err, messages);
  }
}

/** Whether an error is a unique-index refusal (document numbers: two clinics' staff issuing at the same moment on Postgres). */
export function isUniqueRefusal(err: unknown): boolean {
  return classifyDbError(err) === "CONSTRAINT_UNIQUE";
}

export function affected(result: { numAffectedRows?: bigint; numUpdatedRows?: bigint } | undefined): number {
  if (!result) return 0;
  return Number(result.numAffectedRows ?? result.numUpdatedRows ?? 0);
}

/** A random token (draft edits check their own token applied). */
export function editToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** IN-lists in groups of 90 (D1 allows 100 bound parameters per statement). */
export function chunks<T>(items: readonly T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
