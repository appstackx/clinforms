/**
 * Billing reports: the invoices behind the debtors (aged debt) report, and the entries of an account statement.
 * Read-only. Paged internally (500 rows a page) with a hard cap, so a large clinic never loads an unbounded list.
 */
import { sql } from "kysely";
import type { DebtInvoice } from "../../../../modules/pms/billing/aging";
import { formatDocumentNumber } from "../../../../modules/pms/billing/numbers";
import type { StatementEntry } from "../../../../modules/pms/billing/statements";
import { formatUkDate } from "../../../../modules/pms/core/text";
import { assertTenantId, num, numOrNull, type RepoContext } from "../context";
import type { PayerRef } from "./payments";
import { OPEN_INVOICE, chunks } from "./shared";

const PAGE = 500;
export const REPORT_ROW_CAP = 20_000;

export interface DebtInvoiceRow extends DebtInvoice {
  number: string | null;
  patientId: string;
  payerReferrerId: string | null;
  billTo: "patient" | "payer";
  siteId: string | null;
}

/**
 * Issued invoices with a balance (owed, or owed back), for the aged debt report – the OPEN invoices only (the
 * partial index pms_invoices_open, 0212), optionally at some sites (a member limited to some sites: filtered in
 * the query, never through a capped list).
 */
export async function debtInvoices(
  ctx: RepoContext,
  tenantId: string,
  options: { siteIds?: ReadonlySet<string> | null; debtor?: PayerRef } = {},
): Promise<{ rows: DebtInvoiceRow[]; truncated: boolean }> {
  assertTenantId(tenantId);
  const sites = options.siteIds ? Array.from(options.siteIds).slice(0, 90) : null;
  if (sites && sites.length === 0) return { rows: [], truncated: false };
  const out: DebtInvoiceRow[] = [];
  let after = "";
  for (;;) {
    let q = ctx.db
      .selectFrom("pms_invoices")
      .select(["id", "bill_to", "patient_id", "payer_referrer_id", "site_id", "issued_on", "due_on", "number_prefix", "number_seq", "total_pence", "paid_pence", "credited_pence"])
      .where("tenant_id", "=", tenantId)
      .where(OPEN_INVOICE)
      .where("id", ">", after);
    if (sites) q = q.where("site_id", "in", sites);
    // One debtor (a statement's ages): its invoices only – the debtor key below decides, this narrows the read.
    const d = options.debtor;
    if (d) q = d.payerKind === "patient" ? q.where("patient_id", "=", d.patientId) : q.where("bill_to", "=", "payer").where("payer_referrer_id", "=", d.payerReferrerId);
    const page = await q.orderBy("id").limit(PAGE).execute();
    for (const r of page) {
      const billTo = r.bill_to as "patient" | "payer";
      out.push({
        id: r.id,
        debtorKey: billTo === "payer" && r.payer_referrer_id ? `account:${r.payer_referrer_id}` : `patient:${r.patient_id}`,
        issuedOn: r.issued_on ?? "",
        dueOn: r.due_on,
        balancePence: num(r.total_pence) - num(r.paid_pence) - num(r.credited_pence),
        number: formatDocumentNumber(r.number_prefix, numOrNull(r.number_seq)),
        patientId: r.patient_id,
        payerReferrerId: r.payer_referrer_id,
        billTo,
        siteId: r.site_id,
      });
    }
    if (page.length < PAGE) return { rows: out, truncated: false };
    if (out.length >= REPORT_ROW_CAP) return { rows: out, truncated: true };
    after = page[page.length - 1].id;
  }
}

export interface StatementEntryRow extends StatementEntry {
  patientId: string | null;
  invoiceId: string | null;
}

/**
 * Every issued invoice addressed to the payer, the credit notes on them, and the payer's recorded payments and
 * refunds, up to `until` (reversed payments are left out).
 */
export async function statementEntries(ctx: RepoContext, tenantId: string, payer: PayerRef, until: string): Promise<{ entries: StatementEntryRow[]; truncated: boolean }> {
  assertTenantId(tenantId);
  const entries: StatementEntryRow[] = [];
  let truncated = false;
  let invQ = ctx.db
    .selectFrom("pms_invoices")
    .select(["id", "patient_id", "number_prefix", "number_seq", "issued_on", "total_pence", "first_service_on", "last_service_on"])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "issued")
    .where("issued_on", "<=", until);
  invQ = payer.payerKind === "patient" ? invQ.where("bill_to", "=", "patient").where("patient_id", "=", payer.patientId) : invQ.where("bill_to", "=", "payer").where("payer_referrer_id", "=", payer.payerReferrerId);
  const invoices = await invQ.orderBy("issued_on").orderBy("number_seq").limit(REPORT_ROW_CAP).execute();
  if (invoices.length === REPORT_ROW_CAP) truncated = true;
  const numbers = new Map<string, string>();
  for (const r of invoices) {
    const number = formatDocumentNumber(r.number_prefix, numOrNull(r.number_seq)) ?? "";
    numbers.set(r.id, number);
    const dates = r.first_service_on ? (r.first_service_on === r.last_service_on || !r.last_service_on ? formatUkDate(r.first_service_on) : `${formatUkDate(r.first_service_on)} to ${formatUkDate(r.last_service_on)}`) : null;
    entries.push({ kind: "invoice", id: r.id, on: r.issued_on as string, reference: number, description: dates ? `Invoice (treatment ${dates})` : "Invoice", amountPence: num(r.total_pence), patientId: r.patient_id, invoiceId: r.id });
  }
  for (const group of chunks(invoices.map((i) => i.id))) {
    if (group.length === 0) continue;
    const credits = await ctx.db
      .selectFrom("pms_credit_notes")
      .select(["id", "invoice_id", "number_prefix", "number_seq", "issued_on", "total_pence"])
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "in", group)
      .where("issued_on", "<=", until)
      .limit(PAGE * 4)
      .execute();
    for (const c of credits) {
      const inv = invoices.find((i) => i.id === c.invoice_id);
      entries.push({
        kind: "credit_note",
        id: c.id,
        on: c.issued_on,
        reference: formatDocumentNumber(c.number_prefix, num(c.number_seq)) ?? "",
        description: `Credit note on ${numbers.get(c.invoice_id) ?? "an invoice"}`,
        amountPence: num(c.total_pence),
        patientId: inv?.patient_id ?? null,
        invoiceId: c.invoice_id,
      });
    }
  }
  let payQ = ctx.db
    .selectFrom("pms_payments")
    .select(["id", "kind", "method", "received_on", "amount_pence", "reference"])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "recorded")
    .where("received_on", "<=", until);
  payQ = payer.payerKind === "patient" ? payQ.where("patient_id", "=", payer.patientId) : payQ.where("payer_referrer_id", "=", payer.payerReferrerId);
  const payments = await payQ.orderBy("received_on").orderBy("id").limit(REPORT_ROW_CAP).execute();
  if (payments.length === REPORT_ROW_CAP) truncated = true;
  for (const p of payments) {
    const refund = p.kind === "refund";
    entries.push({
      kind: refund ? "refund" : "payment",
      id: p.id,
      on: p.received_on,
      reference: p.reference ?? "",
      description: refund ? "Refund" : "Payment received",
      amountPence: num(p.amount_pence),
      patientId: null,
      invoiceId: null,
    });
  }
  return { entries, truncated };
}
