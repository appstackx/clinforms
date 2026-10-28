/**
 * Billing's figures for the reports (src/server/pms/reporting/sources.ts – the reports never read billing's tables
 * themselves). AGGREGATED in the database by UK date, site and payer type; every statement names the clinic; the
 * same SQL on SQLite / D1 and Postgres. Amounts in whole pence.
 *
 *   invoiced – issued invoices by issue date; VOID invoices are left out (a void is not revenue)
 *   credited – credit notes by issue date (credits, write-offs, transfers); the void kind and anything on a void
 *              invoice left out, so invoiced − credited is the clinic's net
 *   received – recorded payments by the date received; refunds negative; reversed payments left out
 *   debt     – what is still owed NOW on issued invoices, by payer, site and due date (the issue date when none) –
 *              the same invoices and age bands as billing's aged debt (src/modules/pms/billing/aging.ts)
 *
 * Payer type: an invoice addressed to the patient counts as "self_pay" (the patient pays, even on an insured case);
 * a payer invoice keeps the case's payer type. Payments from an account take the account's kind.
 */
import { sql, type RawBuilder } from "kysely";
import type { PayerType } from "../../../modules/pms/core/types";
import type { DebtFact, RevenueFact } from "../../../modules/pms/reporting/facts";
import { assertTenantId, num, type RepoContext } from "../../repos/pms/context";
import type { BillingReportingSource, ReportingQuery } from "../reporting/sources";

const PAYER_KINDS = new Set<string>(["insurer", "mlc", "solicitor", "employer"]);

function siteIn(column: string, siteIds: readonly string[] | null): RawBuilder<unknown> {
  if (!siteIds) return sql``;
  if (siteIds.length === 0) return sql` and 1 = 0`;
  return sql` and ${sql.ref(column)} in (${sql.join(siteIds.slice(0, 90))})`;
}

function payerTypeOf(value: string | null): PayerType {
  if (value === "self_pay") return "self_pay";
  return value && PAYER_KINDS.has(value) ? (value as PayerType) : "other";
}

async function revenueFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<RevenueFact[]> {
  assertTenantId(tenantId);
  const [invoiced, credited, received] = await Promise.all([
    sql<{ d: string; site_id: string | null; payer: string; n: number | string; total: number | string | null }>`
      select i.issued_on as d, i.site_id, case when i.bill_to = 'patient' then 'self_pay' else i.payer_type end as payer, count(*) as n, sum(i.total_pence) as total
      from pms_invoices i
      where i.tenant_id = ${tenantId} and i.status = 'issued' and i.voided_at is null and i.issued_on >= ${q.from} and i.issued_on <= ${q.to}${siteIn("i.site_id", q.siteIds)}
      group by 1, 2, 3
    `.execute(ctx.db),
    sql<{ d: string; site_id: string | null; payer: string; n: number | string; total: number | string | null }>`
      select c.issued_on as d, i.site_id, case when i.bill_to = 'patient' then 'self_pay' else i.payer_type end as payer, count(*) as n, sum(c.total_pence) as total
      from pms_credit_notes c
      join pms_invoices i on i.tenant_id = c.tenant_id and i.id = c.invoice_id
      where c.tenant_id = ${tenantId} and i.tenant_id = ${tenantId} and c.kind <> 'void' and i.voided_at is null and c.issued_on >= ${q.from} and c.issued_on <= ${q.to}${siteIn("i.site_id", q.siteIds)}
      group by 1, 2, 3
    `.execute(ctx.db),
    sql<{ d: string; site_id: string | null; payer_kind: string; kind: string | null; n: number | string; total: number | string | null }>`
      select p.received_on as d, p.site_id, p.payer_kind, r.kind as kind, count(*) as n, sum(case when p.kind = 'refund' then -p.amount_pence else p.amount_pence end) as total
      from pms_payments p
      left join pms_referrers r on r.tenant_id = p.tenant_id and r.id = p.payer_referrer_id
      where p.tenant_id = ${tenantId} and p.status = 'recorded' and p.received_on >= ${q.from} and p.received_on <= ${q.to}${siteIn("p.site_id", q.siteIds)}
      group by 1, 2, 3, 4
    `.execute(ctx.db),
  ]);
  const out: RevenueFact[] = [];
  for (const r of invoiced.rows) out.push({ month: r.d.slice(0, 7), date: r.d, siteId: r.site_id, practitionerId: null, payerType: payerTypeOf(r.payer), kind: "invoiced", count: num(r.n), amountPence: num(r.total ?? 0) });
  for (const r of credited.rows) out.push({ month: r.d.slice(0, 7), date: r.d, siteId: r.site_id, practitionerId: null, payerType: payerTypeOf(r.payer), kind: "credited", count: num(r.n), amountPence: num(r.total ?? 0) });
  for (const r of received.rows) {
    const payerType = r.payer_kind === "patient" ? "self_pay" : payerTypeOf(r.kind);
    out.push({ month: r.d.slice(0, 7), date: r.d, siteId: r.site_id, practitionerId: null, payerType, kind: "received", count: num(r.n), amountPence: num(r.total ?? 0) });
  }
  return out;
}

async function debtFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<DebtFact[]> {
  assertTenantId(tenantId);
  const { rows } = await sql<{ payer: string; referrer: string | null; site_id: string | null; due: string; n: number | string; owed: number | string | null }>`
    select case when i.bill_to = 'patient' then 'self_pay' else i.payer_type end as payer,
      case when i.bill_to = 'payer' then i.payer_referrer_id else null end as referrer,
      i.site_id, coalesce(i.due_on, i.issued_on) as due, count(*) as n, sum(i.total_pence - i.paid_pence - i.credited_pence) as owed
    from pms_invoices i
    where i.tenant_id = ${tenantId} and i.status = 'issued' and i.total_pence - i.paid_pence - i.credited_pence > 0${siteIn("i.site_id", q.siteIds)}
    group by 1, 2, 3, 4
  `.execute(ctx.db);
  return rows.map((r) => ({ payerType: payerTypeOf(r.payer), payerReferrerId: r.referrer, siteId: r.site_id, dueOn: r.due, invoices: num(r.n), outstandingPence: num(r.owed ?? 0) }));
}

/** Billing's reporting source (registered by default in src/server/pms/reporting/sources.ts). */
export const BILLING_REPORTING_SOURCE: BillingReportingSource = { revenueFacts, debtFacts };
