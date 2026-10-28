/**
 * Payments and refunds (`pms_payments`) and how they are spread over invoices (`pms_payment_allocations`).
 *
 * - Who paid: the patient, or a payer account (an insurer's remittance, a solicitor's cheque). A payment is
 *   allocated only to invoices addressed to that payer; what is not allocated stays on account.
 * - A refund is money paid back: allocated (as a negative amount) to an invoice whose balance is below zero.
 * - The database refuses over-allocation (beyond the payment, or past an invoice's balance), a second allocation of
 *   the same payment to the same invoice, and allocating a reversed payment (shared.ts explains how).
 * - Never deleted: a mistaken payment is REVERSED (owners and administrators), which takes it off every invoice;
 *   one allocation can be removed to allocate it elsewhere.
 * - Card payments through a payment link arrive with provider "stripe" and its reference (unique per clinic, so a
 *   payment is never recorded twice).
 */
import { sql } from "kysely";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import { AllocationsInputSchema, PaymentInputSchema, ReversePaymentInputSchema, type AllocationInput, type PaymentInput } from "../../../../modules/pms/billing/schemas";
import type { Allocation, InvoiceSummary, PayerKind, Payment, PaymentKind, PaymentMethod, PaymentStatus } from "../../../../modules/pms/billing/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, pmsId, translateDbError, type RepoContext } from "../context";
import { ALLOC, INV, PAY, SUMMARY_COLUMNS, affected, billingAuditWhen, chunks, todayOf, toAllocation, toInvoiceSummary, toPayment } from "./shared";

/** Allocations per batch: 2 statements each + the payment's own + the audit row stay under D1's 100. */
export const ALLOCATIONS_PER_BATCH = 40;

const MESSAGES = {
  unique: "This payment is already recorded, or already allocated to that invoice.",
  check: "An amount is more than the invoice still owes (or more than is left of the payment).",
  foreignKey: "The patient or payer account does not exist in this clinic.",
};
const NOT_ALLOCATABLE = "An invoice cannot take this payment: it is not issued, it is addressed to someone else, or the payment has been reversed.";

async function run(ctx: RepoContext, queries: BatchQuery[]) {
  try {
    return await runBatch(ctx.db, queries);
  } catch (err) {
    if (classifyDbError(err) === "CONSTRAINT_NOT_NULL") throw new RepoInputError(NOT_ALLOCATABLE);
    throw translateDbError(err, MESSAGES);
  }
}

interface PayerOfPayment {
  id: string;
  kind: PaymentKind;
  payerKind: PayerKind;
  patientId: string | null;
  payerReferrerId: string | null;
}

/** The statements that allocate a chunk of a payment (see shared.ts for why each one is safe on D1 and Postgres). */
function allocationQueries(ctx: RepoContext, tenantId: string, payment: PayerOfPayment, allocations: readonly AllocationInput[], actor: PmsActor, at: string): BatchQuery[] {
  if (allocations.length === 0) return [];
  if (allocations.length > ALLOCATIONS_PER_BATCH) throw new RepoInputError(`At most ${ALLOCATIONS_PER_BATCH} invoices at a time.`);
  const sign = payment.kind === "refund" ? -1 : 1;
  const total = allocations.reduce((a, x) => a + x.amountPence, 0);
  const payerMatch =
    payment.payerKind === "patient"
      ? sql<boolean>`bill_to = 'patient' and patient_id = ${payment.patientId}`
      : sql<boolean>`bill_to = 'payer' and payer_referrer_id = ${payment.payerReferrerId}`;
  const queries: BatchQuery[] = [
    // First: the payment row (Postgres row lock; the CHECK refuses allocating more than was received).
    ctx.db
      .updateTable(PAY)
      .set((eb) => ({ allocated_pence: eb("allocated_pence", "+", total), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", payment.id)
      .where("status", "=", "recorded"),
  ];
  for (const a of allocations) {
    const signed = sign * a.amountPence;
    queries.push(
      ctx.db
        .updateTable(INV)
        .set((eb) => ({ paid_pence: eb("paid_pence", "+", signed), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", a.invoiceId),
      ctx.db.insertInto(ALLOC).values({
        tenant_id: tenantId,
        id: pmsId(P.allocation, ctx),
        payment_id: sql<string>`(select id from pms_payments where tenant_id = ${tenantId} and id = ${payment.id} and status = 'recorded' and kind = ${payment.kind})`,
        invoice_id: sql<string>`(select id from pms_invoices where tenant_id = ${tenantId} and id = ${a.invoiceId} and status = 'issued' and ${payerMatch})`,
        amount_pence: signed,
        invoice_balance_after: sql<number>`(select total_pence - paid_pence - credited_pence from pms_invoices where tenant_id = ${tenantId} and id = ${a.invoiceId})`,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
    );
  }
  return queries;
}

export interface RecordPaymentOptions {
  /** "manual" (default) or the payment provider ("stripe" for test-mode payment links). */
  provider?: string;
  /** The provider's own reference (unique per clinic and provider). */
  providerRef?: string | null;
}

/** Records a payment or refund, allocating it (in batches of 40) as given; the rest stays on account. */
export async function recordPayment(ctx: RepoContext, tenantId: string, input: PaymentInput, actor: PmsActor, options: RecordPaymentOptions = {}): Promise<PaymentWithAllocations> {
  assertTenantId(tenantId);
  const d = parseInput(PaymentInputSchema, input, "Payment");
  const kind: PaymentKind = d.kind ?? "payment";
  if (d.receivedOn > todayOf(ctx)) throw new RepoInputError("Payment: receivedOn: The date cannot be in the future.");
  const provider = options.provider ?? "manual";
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(provider)) throw new RepoInputError("Unknown payment provider.");
  if (options.providerRef !== undefined && options.providerRef !== null) assertId(options.providerRef, "provider reference");
  const id = pmsId(P.payment, ctx);
  const at = nowIso(ctx);
  const payer: PayerOfPayment = { id, kind, payerKind: d.payerKind, patientId: d.patientId ?? null, payerReferrerId: d.payerReferrerId ?? null };
  const allocations = d.allocations ?? [];
  const [first, ...rest] = chunks(allocations, ALLOCATIONS_PER_BATCH);
  await run(ctx, [
    ctx.db.insertInto(PAY).values({
      tenant_id: tenantId,
      id,
      kind,
      status: "recorded",
      payer_kind: d.payerKind,
      patient_id: payer.patientId,
      payer_referrer_id: payer.payerReferrerId,
      received_on: d.receivedOn,
      method: d.method,
      amount_pence: d.amountPence,
      allocated_pence: 0,
      reference: d.reference ?? null,
      notes_enc: encryptField(ctx, tenantId, PAY, "notes_enc", id, d.notes),
      provider,
      provider_ref: options.providerRef ?? null,
      site_id: d.siteId ?? null,
      import_ref: d.importRef ?? null,
      created_by: actor.userId,
      created_at: at,
      updated_at: at,
    }),
    ...allocationQueries(ctx, tenantId, payer, first ?? [], actor, at),
    pmsAuditQuery(ctx, tenantId, actor, {
      action: kind === "refund" ? "pms.refund.record" : "pms.payment.record",
      targetType: "pms_payment",
      targetId: id,
      detail: { method: d.method, amountPence: d.amountPence, payerKind: d.payerKind, allocations: (first ?? []).length, provider },
    }),
  ]);
  for (const chunk of rest) await allocatePayment(ctx, tenantId, id, chunk, actor);
  return (await getPayment(ctx, tenantId, id)) as PaymentWithAllocations;
}

/** Allocates (more of) a recorded payment to invoices addressed to its payer. */
export async function allocatePayment(ctx: RepoContext, tenantId: string, paymentId: string, allocations: AllocationInput[], actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(paymentId, "payment id");
  if (allocations.length === 0) return;
  const parsed = parseInput(AllocationsInputSchema, { allocations }, "Allocation").allocations;
  const row = await ctx.db.selectFrom(PAY).select(["id", "kind", "payer_kind", "patient_id", "payer_referrer_id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", paymentId).executeTakeFirst();
  if (!row) throw new RepoInputError("That payment does not exist in this clinic.");
  if (row.status !== "recorded") throw new RepoInputError("That payment has been reversed.");
  const payer: PayerOfPayment = { id: row.id, kind: row.kind as PaymentKind, payerKind: row.payer_kind as PayerKind, patientId: row.patient_id, payerReferrerId: row.payer_referrer_id };
  const at = nowIso(ctx);
  for (const chunk of chunks(parsed, ALLOCATIONS_PER_BATCH)) {
    await run(ctx, [
      ...allocationQueries(ctx, tenantId, payer, chunk, actor, at),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.payment.allocate", targetType: "pms_payment", targetId: paymentId, detail: { allocations: chunk.length, amountPence: chunk.reduce((a, x) => a + x.amountPence, 0) } }),
    ]);
  }
}

/** Takes one allocation off its invoice (the amount goes back on account). Owners and administrators. */
export async function removeAllocation(ctx: RepoContext, tenantId: string, allocationId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(allocationId, "allocation id");
  const a = await ctx.db.selectFrom(ALLOC).select(["payment_id", "invoice_id", "reversed"]).where("tenant_id", "=", tenantId).where("id", "=", allocationId).executeTakeFirst();
  if (!a || num(a.reversed) === 1) return false;
  const at = nowIso(ctx);
  const live = sql<boolean>`exists (select 1 from pms_payment_allocations where tenant_id = ${tenantId} and id = ${allocationId} and reversed = 0)`;
  const results = await run(ctx, [
    ctx.db.updateTable(ALLOC).set({ updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", allocationId).where("reversed", "=", 0),
    ctx.db
      .updateTable(INV)
      .set({
        paid_pence: sql<number>`paid_pence - (select amount_pence from pms_payment_allocations where tenant_id = ${tenantId} and id = ${allocationId})`,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", a.invoice_id)
      .where(live),
    ctx.db
      .updateTable(PAY)
      .set({
        allocated_pence: sql<number>`allocated_pence - (select abs(amount_pence) from pms_payment_allocations where tenant_id = ${tenantId} and id = ${allocationId})`,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", a.payment_id)
      .where(live),
    ctx.db.updateTable(ALLOC).set({ reversed: 1, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", allocationId).where("reversed", "=", 0),
    // Audited in the same batch, only when this call took it off (reversed now, at this instant).
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.payment.unallocate", targetType: "pms_payment", targetId: a.payment_id, detail: { invoiceId: a.invoice_id, allocationId } },
      ctx.db.selectFrom(ALLOC).select("id").where("tenant_id", "=", tenantId).where("id", "=", allocationId).where("reversed", "=", 1).where("updated_at", "=", at),
    ),
  ]);
  return affected(results[3]) > 0;
}

/**
 * Reverses a payment entered by mistake (or a bounced cheque): it comes off every invoice it was allocated to.
 * Kept, marked reversed, with the reason (encrypted). A card payment is NOT refunded to the card by this – record a
 * refund for that.
 */
export async function reversePayment(ctx: RepoContext, tenantId: string, paymentId: string, input: { reason: string }, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(paymentId, "payment id");
  const d = parseInput(ReversePaymentInputSchema, input, "Reverse");
  const at = nowIso(ctx);
  const recorded = sql<boolean>`exists (select 1 from pms_payments where tenant_id = ${tenantId} and id = ${paymentId} and status = 'recorded')`;
  const results = await run(ctx, [
    ctx.db.updateTable(PAY).set({ updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", paymentId).where("status", "=", "recorded"),
    ctx.db
      .updateTable(INV)
      .set({
        paid_pence: sql<number>`paid_pence - (select coalesce(sum(a.amount_pence), 0) from pms_payment_allocations a where a.tenant_id = ${tenantId} and a.payment_id = ${paymentId} and a.reversed = 0 and a.invoice_id = pms_invoices.id)`,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "in", (eb) => eb.selectFrom(ALLOC).select("invoice_id").where("tenant_id", "=", tenantId).where("payment_id", "=", paymentId).where("reversed", "=", 0))
      .where(recorded),
    ctx.db.updateTable(ALLOC).set({ reversed: 1, updated_at: at }).where("tenant_id", "=", tenantId).where("payment_id", "=", paymentId).where("reversed", "=", 0).where(recorded),
    ctx.db
      .updateTable(PAY)
      .set({ status: "reversed", allocated_pence: 0, reversed_at: at, reversed_by: actor.userId, reverse_reason_enc: encryptField(ctx, tenantId, PAY, "reverse_reason_enc", paymentId, d.reason), updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", paymentId)
      .where("status", "=", "recorded"),
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.payment.reverse", targetType: "pms_payment", targetId: paymentId, detail: {} },
      ctx.db.selectFrom(PAY).select("id").where("tenant_id", "=", tenantId).where("id", "=", paymentId).where("status", "=", "reversed").where("reversed_at", "=", at),
    ),
  ]);
  return affected(results[3]) > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Read
 * ----------------------------------------------------------------------------------------------*/

export interface PaymentWithAllocations extends Payment {
  allocations: Allocation[];
  /** Decrypted (reversed payments). */
  reverseReason: string | null;
}

export async function getPayment(ctx: RepoContext, tenantId: string, id: string): Promise<PaymentWithAllocations | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(PAY).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const allocs = await ctx.db.selectFrom(ALLOC).selectAll().where("tenant_id", "=", tenantId).where("payment_id", "=", id).where("reversed", "=", 0).orderBy("created_at").limit(500).execute();
  return {
    ...toPayment(ctx, row, true),
    allocations: allocs.map(toAllocation),
    reverseReason: decryptField(ctx, tenantId, PAY, "reverse_reason_enc", id, row.reverse_reason_enc),
  };
}

export interface ListPaymentsOptions {
  payerKind?: PayerKind;
  patientId?: string;
  payerReferrerId?: string;
  kind?: PaymentKind;
  method?: PaymentMethod;
  status?: PaymentStatus;
  /** Only payments with money not allocated yet. */
  unallocatedOnly?: boolean;
  /** The member's site scope: payments taken at those sites, plus payer accounts' payments (no site). */
  siteIds?: ReadonlySet<string> | null;
  /** Only payments with a reference (insurer remittances). */
  withReference?: boolean;
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** Payments (no notes), newest first. */
export async function listPayments(ctx: RepoContext, tenantId: string, options: ListPaymentsOptions = {}): Promise<Payment[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(PAY).selectAll().where("tenant_id", "=", tenantId);
  if (options.payerKind) q = q.where("payer_kind", "=", options.payerKind);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.payerReferrerId) q = q.where("payer_referrer_id", "=", options.payerReferrerId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.method) q = q.where("method", "=", options.method);
  if (options.status) q = q.where("status", "=", options.status);
  if (options.unallocatedOnly) q = q.where("status", "=", "recorded").where(sql<boolean>`allocated_pence < amount_pence`);
  if (options.from) q = q.where("received_on", ">=", options.from);
  if (options.until) q = q.where("received_on", "<=", options.until);
  if (options.withReference) q = q.where("reference", "is not", null);
  if (options.siteIds) {
    const ids = Array.from(options.siteIds).slice(0, 90);
    q = q.where((eb) => eb.or([eb("payer_kind", "=", "account"), ...(ids.length ? [eb("site_id", "in", ids)] : [])]));
  }
  const rows = await q
    .orderBy("received_on", "desc")
    .orderBy("id", "desc")
    .limit(Math.min(Math.max(1, options.limit ?? 50), 500))
    .offset(Math.max(0, options.offset ?? 0))
    .execute();
  return rows.map((r) => toPayment(ctx, r, false));
}

export interface InvoiceAllocation extends Allocation {
  kind: PaymentKind;
  method: PaymentMethod;
  receivedOn: string;
  reference: string | null;
}

/** What was paid (and refunded) on an invoice, oldest first. */
export async function listAllocationsForInvoice(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<InvoiceAllocation[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("pms_payment_allocations as a")
    .innerJoin("pms_payments as p", (j) => j.onRef("p.tenant_id", "=", "a.tenant_id").onRef("p.id", "=", "a.payment_id"))
    .select(["a.id", "a.payment_id", "a.invoice_id", "a.amount_pence", "a.created_at", "p.kind", "p.method", "p.received_on", "p.reference"])
    .where("a.tenant_id", "=", tenantId)
    .where("a.invoice_id", "=", invoiceId)
    .where("a.reversed", "=", 0)
    .orderBy("p.received_on")
    .orderBy("a.created_at")
    .limit(200)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    invoiceId: r.invoice_id,
    amountPence: num(r.amount_pence),
    createdAt: r.created_at,
    kind: r.kind as PaymentKind,
    method: r.method as PaymentMethod,
    receivedOn: r.received_on,
    reference: r.reference,
  }));
}

export type PayerRef = { payerKind: "patient"; patientId: string } | { payerKind: "account"; payerReferrerId: string };

/** Issued invoices addressed to a payer with money owed (payments) or owed back (refunds), oldest first. */
export async function openInvoicesFor(ctx: RepoContext, tenantId: string, payer: PayerRef, kind: PaymentKind = "payment"): Promise<InvoiceSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(INV).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("status", "=", "issued");
  q = payer.payerKind === "patient" ? q.where("bill_to", "=", "patient").where("patient_id", "=", payer.patientId) : q.where("bill_to", "=", "payer").where("payer_referrer_id", "=", payer.payerReferrerId);
  q = q.where(sql<number>`total_pence - paid_pence - credited_pence`, kind === "refund" ? "<" : ">", 0);
  const rows = await q.orderBy("issued_on").orderBy("number_seq").limit(500).execute();
  return rows.map(toInvoiceSummary);
}

/** Money a payer has paid but not allocated yet, less refunds not allocated (credit on account). */
export async function accountCredit(ctx: RepoContext, tenantId: string, payer: PayerRef): Promise<number> {
  assertTenantId(tenantId);
  let q = ctx.db
    .selectFrom(PAY)
    .select(sql<number>`coalesce(sum(case when kind = 'payment' then amount_pence - allocated_pence else allocated_pence - amount_pence end), 0)`.as("n"))
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "recorded");
  q = payer.payerKind === "patient" ? q.where("patient_id", "=", payer.patientId) : q.where("payer_referrer_id", "=", payer.payerReferrerId);
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}
