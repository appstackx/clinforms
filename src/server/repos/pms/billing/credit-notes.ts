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
import { CreditNoteInputSchema, type CreditNoteInput } from "../../../../modules/pms/billing/schemas";
import type { CreditNote } from "../../../../modules/pms/billing/types";
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
  if (inv.status !== "issued") throw new RepoInputError("Only an issued invoice can be credited (cancel a draft instead).");
  const today = todayOf(ctx);
  const issuedOn = d.issuedOn ?? today;
  if (issuedOn > today) throw new RepoInputError("Credit note: issuedOn: The date cannot be in the future.");
  if (inv.issuedOn && issuedOn < inv.issuedOn) throw new RepoInputError("Credit note: issuedOn: The credit note cannot be dated before the invoice.");
  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  const credited = await creditedByLine(ctx, tenantId, d.lines.map((l) => l.invoiceLineId));
  const parts = d.lines.map((req, i) => {
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

  const id = pmsId(P.creditNote, ctx);
  const at = nowIso(ctx);
  const nextSeq = sql<number>`(select case when m.n + 1 > s.first_credit_note_number then m.n + 1 else s.first_credit_note_number end from pms_billing_settings s, (select coalesce(max(number_seq), 0) as n from pms_credit_notes where tenant_id = ${tenantId}) m where s.tenant_id = ${tenantId})`;
  const issuedInvoice = sql<string>`(select id from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and status = 'issued')`;
  const queries: BatchQuery[] = [
    // Postgres: lock the invoice first (a concurrent credit note or payment on it waits for this one).
    ctx.db.updateTable(INV).set({ updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", inv.id),
    ensureSettingsQuery(ctx, tenantId, at),
    ctx.db.insertInto(CRN).values({
      tenant_id: tenantId,
      id,
      invoice_id: issuedInvoice,
      number_prefix: sql<string>`(select credit_note_prefix from pms_billing_settings where tenant_id = ${tenantId})`,
      number_seq: nextSeq,
      issued_on: issuedOn,
      net_pence: totals.netPence,
      vat_pence: totals.vatPence,
      total_pence: totals.totalPence,
      reason_enc: encryptField(ctx, tenantId, CRN, "reason_enc", id, d.reason),
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
          billing_lock: sql<number>`case when credited_pence + ${share.totalPence} >= total_pence then 0 else billing_lock end`,
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
    // Credited in full: every appointment on it can be billed again.
    ctx.db
      .updateTable(LINES)
      .set({ billing_lock: 0, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", inv.id)
      .where(sql<boolean>`exists (select 1 from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and credited_pence >= total_pence)`),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.credit_note.create", targetType: "pms_credit_note", targetId: id, detail: { invoiceId: inv.id, lines: parts.length, totalPence: totals.totalPence, full: fullyCredited } }),
  );
  for (let attempt = 0; ; attempt++) {
    try {
      await runBatch(ctx.db, queries);
      break;
    } catch (err) {
      if (isUniqueRefusal(err) && attempt < 3) continue; // two credit notes numbered at the same moment (Postgres)
      if (classifyDbError(err) === "CONSTRAINT_NOT_NULL") throw new RepoInputError("That invoice can no longer be credited (it changed). Reload the page.");
      throw translateDbError(err, MESSAGES);
    }
  }
  if (fullyCredited && inv.authorisationId && (inv.authSessions > 0 || inv.authValuePence > 0)) {
    await recordAuthorisationUsage(ctx, tenantId, inv.authorisationId, { sessions: -inv.authSessions, valuePence: -inv.authValuePence }, actor, id);
    await ctx.db.updateTable(INV).set({ auth_sessions: 0, auth_value_pence: 0 }).where("tenant_id", "=", tenantId).where("id", "=", inv.id).execute();
  }
  return (await getCreditNote(ctx, tenantId, id)) as CreditNote;
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
export async function listCreditNotes(ctx: RepoContext, tenantId: string, options: { from?: string; until?: string; invoiceIds?: string[]; limit?: number } = {}): Promise<CreditNote[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(CRN).selectAll().where("tenant_id", "=", tenantId);
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
