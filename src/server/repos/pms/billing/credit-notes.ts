/**
 * Credit notes (`pms_credit_notes`, `pms_credit_note_lines`): money taken off an ISSUED invoice, line by line, with
 * its own number (the clinic's credit note prefix and sequence) and a reason. VAT is reversed in the same
 * proportion as each line charged it.
 *
 * - The database refuses crediting more than a line (or the invoice) charged, and an excess deduction line is never
 *   credited (credit the patient's excess invoice instead).
 * - A line credited in full releases its diary appointment (it can be billed again, e.g. to the right payer); an
 *   invoice credited in full releases every appointment on it and gives the sessions and value it used back to its
 *   treatment authorisation. A partial credit leaves the authorisation as it is.
 * - Never deleted. A credit note after payment leaves the invoice with "refund due" (record the refund).
 */
import { sql } from "kysely";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import { CreditNoteInputSchema, VoidInvoiceInputSchema, WriteOffInputSchema, type CreditNoteInput, type VoidInvoiceInput, type WriteOffInput } from "../../../../modules/pms/billing/schemas";
import type { CreditNote, CreditNoteKind, Invoice } from "../../../../modules/pms/billing/types";
import { creditShare, sumTotals } from "../../../../modules/pms/billing/vat";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import { recordAuthorisationUsage } from "../cases";
import { RepoInputError, assertId, assertTenantId, encryptField, nowIso, num, parseInput, pmsAuditQuery, pmsId, translateDbError, type RepoContext } from "../context";
import { getInvoice } from "./invoices";
import { ensureSettingsQuery } from "./settings";
import { CRN, CRN_LINES, INV, LINES, chunks, isUniqueRefusal, todayOf, toCreditNote } from "./shared";

const MESSAGES = {
  check: "The credit is more than is left to credit on the invoice or one of its lines.",
  foreignKey: "That invoice or line does not exist in this clinic.",
};

/** Net and VAT already credited per invoice line (for the VAT share of the next credit). */
async function creditedByLine(ctx: RepoContext, tenantId: string, lineIds: string[]): Promise<Map<string, { netPence: number; vatPence: number }>> {
  const out = new Map<string, { netPence: number; vatPence: number }>();
  for (const group of chunks(lineIds)) {
    if (group.length === 0) continue;
    const rows = await ctx.db
      .selectFrom(CRN_LINES)
      .select((eb) => ["invoice_line_id", eb.fn.sum<number>("net_pence").as("net"), eb.fn.sum<number>("vat_pence").as("vat")])
      .where("tenant_id", "=", tenantId)
      .where("invoice_line_id", "in", group)
      .groupBy("invoice_line_id")
      .execute();
    for (const r of rows) out.set(r.invoice_line_id, { netPence: num(r.net), vatPence: num(r.vat) });
  }
  return out;
}

export async function createCreditNote(ctx: RepoContext, tenantId: string, input: CreditNoteInput, actor: PmsActor): Promise<CreditNote> {
  assertTenantId(tenantId);
  const d = parseInput(CreditNoteInputSchema, input, "Credit note");
  const inv = await getInvoice(ctx, tenantId, d.invoiceId);
  if (!inv) throw new RepoInputError("That invoice does not exist in this clinic.");
  return issueCreditNote(ctx, tenantId, inv, d.lines, { kind: "credit", reason: d.reason, issuedOn: d.issuedOn ?? undefined }, actor);
}

interface CreditOptions {
  kind: CreditNoteKind;
  /** Plain words (encrypted). */
  reason: string;
  issuedOn?: string;
  /** Audit detail extras (ids, codes – never text). */
  detail?: Record<string, unknown>;
}

/**
 * The one way a credit note is written (every kind). Credit and void give the appointments back to billing (a
 * line credited in full can be billed again) and, when the invoice is credited in full, the value and sessions it
 * used back to its authorisation. A write-off or a transfer to the patient does neither: the visit happened and
 * stays billed – only the amount is no longer collected from this payer.
 */
async function issueCreditNote(ctx: RepoContext, tenantId: string, inv: Invoice, requested: readonly { invoiceLineId: string; totalPence: number }[], options: CreditOptions, actor: PmsActor): Promise<CreditNote> {
  if (inv.status !== "issued") throw new RepoInputError("Only an issued invoice can be credited (cancel a draft instead).");
  if (inv.voidedAt) throw new RepoInputError("This invoice is void.");
  const today = todayOf(ctx);
  const issuedOn = options.issuedOn ?? today;
  if (issuedOn > today) throw new RepoInputError("Credit note: issuedOn: The date cannot be in the future.");
  if (inv.issuedOn && issuedOn < inv.issuedOn) throw new RepoInputError("Credit note: issuedOn: The credit note cannot be dated before the invoice.");
  const releases = options.kind === "credit" || options.kind === "void";
  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  const credited = await creditedByLine(
    ctx,
    tenantId,
    requested.map((l) => l.invoiceLineId),
  );
  const parts = requested.map((req, i) => {
    const line = byId.get(req.invoiceLineId);
    if (!line) throw new RepoInputError(`Credit note: line ${i + 1} is not on this invoice.`);
    if (line.kind === "excess_deduction") throw new RepoInputError("An excess deduction is not credited: credit the patient's excess invoice instead.");
    const left = line.totalPence - line.creditedPence;
    if (req.totalPence > left) throw new RepoInputError(`Credit note: line ${line.lineNo} has only ${left} pence left to credit.`);
    const done = credited.get(line.id) ?? { netPence: 0, vatPence: 0 };
    const remaining = { netPence: line.netPence - done.netPence, vatPence: line.vatPence - done.vatPence, totalPence: left };
    return { line, share: creditShare(remaining, req.totalPence) };
  });
  const totals = sumTotals(parts.map((p) => p.share));
  if (totals.totalPence > inv.totalPence - inv.creditedPence) throw new RepoInputError("The credit is more than is left to credit on the invoice.");
  const fullyCredited = inv.creditedPence + totals.totalPence >= inv.totalPence;
  const givesBack = releases && fullyCredited && Boolean(inv.authorisationId) && (inv.authSessions > 0 || inv.authValuePence > 0);

  const id = pmsId(P.creditNote, ctx);
  const at = nowIso(ctx);
  const nextSeq = sql<number>`(select case when m.n + 1 > s.first_credit_note_number then m.n + 1 else s.first_credit_note_number end from pms_billing_settings s, (select coalesce(max(number_seq), 0) as n from pms_credit_notes where tenant_id = ${tenantId}) m where s.tenant_id = ${tenantId})`;
  // A void needs the invoice unpaid at the moment it runs: statement 1 marks it void only then, and the credit
  // note's invoice id is NULL (refused, whole batch rolled back) unless it was marked by THIS call.
  const issuedInvoice =
    options.kind === "void"
      ? sql<string>`(select id from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and status = 'issued' and voided_at = ${at})`
      : sql<string>`(select id from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and status = 'issued' and voided_at is null)`;
  const queries: BatchQuery[] = [
    // Postgres: lock the invoice first (a concurrent credit note or payment on it waits for this one).
    options.kind === "void"
      ? ctx.db.updateTable(INV).set({ voided_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", inv.id).where("status", "=", "issued").where("voided_at", "is", null).where("paid_pence", "=", 0)
      : ctx.db.updateTable(INV).set({ updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", inv.id),
    ensureSettingsQuery(ctx, tenantId, at),
    ctx.db.insertInto(CRN).values({
      tenant_id: tenantId,
      id,
      kind: options.kind,
      invoice_id: issuedInvoice,
      number_prefix: sql<string>`(select credit_note_prefix from pms_billing_settings where tenant_id = ${tenantId})`,
      number_seq: nextSeq,
      issued_on: issuedOn,
      net_pence: totals.netPence,
      vat_pence: totals.vatPence,
      total_pence: totals.totalPence,
      reason_enc: encryptField(ctx, tenantId, CRN, "reason_enc", id, options.reason),
      created_by: actor.userId,
      created_at: at,
      updated_at: at,
    }),
  ];
  for (const { line, share } of parts) {
    const lineId = pmsId(P.creditNoteLine, ctx);
    queries.push(
      ctx.db.insertInto(CRN_LINES).values({
        tenant_id: tenantId,
        id: lineId,
        credit_note_id: id,
        invoice_line_id: line.id,
        net_pence: share.netPence,
        vat_pence: share.vatPence,
        total_pence: share.totalPence,
        // NULL (refused) when the line is not this invoice's or is an excess deduction; negative (refused) when over.
        line_remaining_after: sql<number>`(select total_pence - credited_pence - ${share.totalPence} from pms_invoice_lines where tenant_id = ${tenantId} and id = ${line.id} and invoice_id = ${inv.id} and kind <> 'excess_deduction')`,
        created_at: at,
      }),
      ctx.db
        .updateTable(LINES)
        .set((eb) => ({
          credited_pence: eb("credited_pence", "+", share.totalPence),
          ...(releases ? { billing_lock: sql<number>`case when credited_pence + ${share.totalPence} >= total_pence then 0 else billing_lock end` } : {}),
          updated_at: at,
        }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", line.id)
        .where("invoice_id", "=", inv.id),
    );
  }
  queries.push(
    ctx.db
      .updateTable(INV)
      .set((eb) => ({ credited_pence: eb("credited_pence", "+", totals.totalPence), rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", inv.id),
  );
  if (releases) {
    queries.push(
      // Credited in full: every appointment on it can be billed again.
      ctx.db
        .updateTable(LINES)
        .set({ billing_lock: 0, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("invoice_id", "=", inv.id)
        .where(sql<boolean>`exists (select 1 from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and credited_pence >= total_pence)`),
    );
  }
  if (givesBack) {
    // The invoice no longer holds the authorisation's usage (given back just after this batch, audited there).
    queries.push(
      ctx.db
        .updateTable(INV)
        .set({ auth_sessions: 0, auth_value_pence: 0 })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", inv.id)
        .where(sql<boolean>`credited_pence >= total_pence`),
    );
  }
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: options.kind === "void" ? "pms.invoice.void" : options.kind === "write_off" ? "pms.invoice.write_off" : options.kind === "transfer" ? "pms.invoice.transfer" : "pms.credit_note.create",
      targetType: "pms_credit_note",
      targetId: id,
      detail: { invoiceId: inv.id, kind: options.kind, lines: parts.length, totalPence: totals.totalPence, full: fullyCredited, ...(options.detail ?? {}) },
    }),
  );
  for (let attempt = 0; ; attempt++) {
    try {
      await runBatch(ctx.db, queries);
      break;
    } catch (err) {
      if (isUniqueRefusal(err) && attempt < 3) continue; // two credit notes numbered at the same moment (Postgres)
      if (classifyDbError(err) === "CONSTRAINT_NOT_NULL") {
        throw new RepoInputError(options.kind === "void" ? "That invoice cannot be voided: it has payments on it, or it changed. Take the payments off or refund them first." : "That invoice can no longer be credited (it changed). Reload the page.");
      }
      throw translateDbError(err, MESSAGES);
    }
  }
  if (givesBack && inv.authorisationId) {
    await recordAuthorisationUsage(ctx, tenantId, inv.authorisationId, { sessions: -inv.authSessions, valuePence: -inv.authValuePence }, actor, id);
  }
  return (await getCreditNote(ctx, tenantId, id)) as CreditNote;
}

/** Spreads an amount over an invoice's lines from the last line back (never an excess deduction, never past a line). */
export function spreadOverLines(inv: Pick<Invoice, "lines">, amountPence: number): { invoiceLineId: string; totalPence: number }[] {
  let left = amountPence;
  const out: { invoiceLineId: string; totalPence: number }[] = [];
  for (const line of inv.lines.slice().reverse()) {
    if (left <= 0) break;
    if (line.kind === "excess_deduction") continue;
    const room = line.totalPence - line.creditedPence;
    if (room <= 0) continue;
    const take = Math.min(room, left);
    out.push({ invoiceLineId: line.id, totalPence: take });
    left -= take;
  }
  if (left > 0) throw new RepoInputError("The amount is more than is left on the invoice.");
  return out;
}

/**
 * Voids an issued invoice (owners and administrators): a credit note of kind "void" for everything left on it,
 * the invoice marked void, its appointments released and its authorisation usage given back. Refused while
 * payments are on it (take them off or refund them first). A draft is cancelled instead (cancelDraftInvoice).
 */
export async function voidInvoice(ctx: RepoContext, tenantId: string, invoiceId: string, input: VoidInvoiceInput, actor: PmsActor): Promise<CreditNote> {
  assertTenantId(tenantId);
  assertId(invoiceId, "invoice id");
  const d = parseInput(VoidInvoiceInputSchema, input, "Void");
  const inv = await getInvoice(ctx, tenantId, invoiceId);
  if (!inv) throw new RepoInputError("That invoice does not exist in this clinic.");
  if (inv.status !== "issued") throw new RepoInputError("Only an issued invoice is voided (cancel a draft instead).");
  if (inv.voidedAt) throw new RepoInputError("This invoice is already void.");
  if (inv.paidPence !== 0) throw new RepoInputError("That invoice cannot be voided: it has payments on it. Take the payments off or refund them first.");
  const lines = inv.lines.filter((l) => l.kind !== "excess_deduction" && l.totalPence - l.creditedPence > 0).map((l) => ({ invoiceLineId: l.id, totalPence: l.totalPence - l.creditedPence }));
  if (lines.length === 0) throw new RepoInputError("Nothing is left on this invoice to void.");
  return issueCreditNote(ctx, tenantId, inv, lines, { kind: "void", reason: d.reason }, actor);
}

/**
 * Writes off part of what an invoice still owes (an insurer's short payment above its agreed rate, a small
 * balance…): a credit note of kind "write_off" spread over the lines from the last one back. Never more than the
 * balance. The visits stay billed.
 */
export async function writeOffInvoice(ctx: RepoContext, tenantId: string, input: WriteOffInput, actor: PmsActor, detail: Record<string, unknown> = {}): Promise<CreditNote> {
  assertTenantId(tenantId);
  const d = parseInput(WriteOffInputSchema, input, "Write-off");
  const inv = await getInvoice(ctx, tenantId, d.invoiceId);
  if (!inv) throw new RepoInputError("That invoice does not exist in this clinic.");
  if (d.amountPence > inv.balancePence) throw new RepoInputError("Write-off: the amount is more than the invoice still owes.");
  const reason = d.note ? `${d.reason}: ${d.note}` : d.reason;
  return issueCreditNote(ctx, tenantId, inv, spreadOverLines(inv, d.amountPence), { kind: "write_off", reason, issuedOn: d.issuedOn ?? undefined, detail: { reason: d.reason, ...detail } }, actor);
}

/** The credit side of moving an insurer's unpaid part to the patient (src/server/pms/billing/remittance.ts makes the patient's invoice). */
export async function transferInvoiceBalance(ctx: RepoContext, tenantId: string, invoiceId: string, amountPence: number, patientInvoiceId: string, actor: PmsActor): Promise<CreditNote> {
  assertTenantId(tenantId);
  assertId(invoiceId, "invoice id");
  assertId(patientInvoiceId, "invoice id");
  if (!Number.isInteger(amountPence) || amountPence <= 0) throw new RepoInputError("Enter an amount to move.");
  const inv = await getInvoice(ctx, tenantId, invoiceId);
  if (!inv) throw new RepoInputError("That invoice does not exist in this clinic.");
  if (inv.billTo !== "payer") throw new RepoInputError("Only an insurer's or other payer's invoice is moved to the patient.");
  if (amountPence > inv.balancePence) throw new RepoInputError("The amount is more than the invoice still owes.");
  return issueCreditNote(ctx, tenantId, inv, spreadOverLines(inv, amountPence), { kind: "transfer", reason: `Moved to the patient's invoice`, detail: { patientInvoiceId } }, actor);
}

/** One credit note, reason decrypted. */
export async function getCreditNote(ctx: RepoContext, tenantId: string, id: string): Promise<CreditNote | null> {
  assertTenantId(tenantId);
  assertId(id, "credit note id");
  const row = await ctx.db.selectFrom(CRN).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const lines = await ctx.db.selectFrom(CRN_LINES).selectAll().where("tenant_id", "=", tenantId).where("credit_note_id", "=", id).orderBy("id").limit(100).execute();
  return toCreditNote(ctx, row, lines, true);
}

/** An invoice's credit notes (reasons not decrypted), oldest first. */
export async function listCreditNotesForInvoice(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<CreditNote[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(CRN).selectAll().where("tenant_id", "=", tenantId).where("invoice_id", "=", invoiceId).orderBy("number_seq").limit(100).execute();
  if (rows.length === 0) return [];
  const lines = await ctx.db
    .selectFrom(CRN_LINES)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where(
      "credit_note_id",
      "in",
      rows.map((r) => r.id),
    )
    .limit(2000)
    .execute();
  return rows.map((r) =>
    toCreditNote(
      ctx,
      r,
      lines.filter((l) => l.credit_note_id === r.id),
      false,
    ),
  );
}

/** Credit notes in a date range (statements, reports), reasons not decrypted. */
export async function listCreditNotes(ctx: RepoContext, tenantId: string, options: { from?: string; until?: string; invoiceIds?: string[]; kind?: CreditNoteKind; limit?: number } = {}): Promise<CreditNote[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(CRN).selectAll().where("tenant_id", "=", tenantId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.from) q = q.where("issued_on", ">=", options.from);
  if (options.until) q = q.where("issued_on", "<=", options.until);
  if (options.invoiceIds) {
    if (options.invoiceIds.length === 0) return [];
    const out: CreditNote[] = [];
    for (const group of chunks(options.invoiceIds)) {
      const rows = await q.where("invoice_id", "in", group).orderBy("issued_on").orderBy("number_seq").limit(500).execute();
      out.push(...rows.map((r) => toCreditNote(ctx, r, [], false)));
    }
    return out;
  }
  const rows = await q
    .orderBy("issued_on", "desc")
    .orderBy("number_seq", "desc")
    .limit(Math.min(Math.max(1, options.limit ?? 100), 500))
    .execute();
  return rows.map((r) => toCreditNote(ctx, r, [], false));
}
