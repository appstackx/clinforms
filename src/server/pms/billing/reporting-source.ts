/**
 * Billing's figures for the reports (src/server/pms/reporting/sources.ts – the reports never read billing's tables
 * themselves). AGGREGATED in the database by UK date, site and payer type; every statement names the clinic; the
 * same SQL on SQLite / D1 and Postgres. Amounts in whole pence.
 *
 *   invoiced – issued invoices by issue date; VOID invoices are left out (a void is not revenue)
 *   credited – credit notes by issue date (credits, write-offs, transfers); the void kind and anything on a void
 *              invoice left out, so invoiced − credited is the clinic's net
 *   received – recorded payments by the date received; refunds negative; reversed payments and gift-card spends left
 *              out (the money came in when the card was sold)
 *   PK06 (courses, gift cards, products – docs/clinic-system/courses-giftcards-products.md §9): the "as at" date is
 *   query.to and query.end the instant it ends; a course / card belongs to the site of the invoice that sold it.
 *   debt     – what is still owed NOW on issued invoices, by payer, site and due date (the issue date when none) –
 *              the same invoices and age bands as billing's aged debt (src/modules/pms/billing/aging.ts)
 *
 * Payer type: an invoice addressed to the patient counts as "self_pay" (the patient pays, even on an insured case);
 * a payer invoice keeps the case's payer type. Payments from an account take the account's kind.
 */
import { sql, type RawBuilder } from "kysely";
import type { PayerType } from "../../../modules/pms/core/types";
import type { CourseFact, CourseSaleFact, DebtFact, GiftCardFact, GiftCardFactKind, ProductSaleFact, ReportProduct, RevenueFact, StockFact } from "../../../modules/pms/reporting/facts";
import { assertTenantId, num, type RepoContext } from "../../repos/pms/context";
import { giftCardsInstalled, notGiftCardSpend } from "../../repos/pms/billing/gift-cards";
import { readOrEmpty } from "../../repos/pms/billing/healthcode";
import { listProducts } from "../../repos/pms/billing/products";
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
  // Money received leaves gift-card spends out (the money came in when the card was sold) – the same rule as Billing's
  // "Taken today": the payment's "redeem" move, never its method text. Only once the gift-card tables exist.
  const notSpend = (await giftCardsInstalled(ctx, tenantId)) ? sql` and ${notGiftCardSpend(tenantId, sql.ref("p.id"))}` : sql``;
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
      where p.tenant_id = ${tenantId} and p.status = 'recorded' and p.received_on >= ${q.from} and p.received_on <= ${q.to}${siteIn("p.site_id", q.siteIds)}${notSpend}
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

/* ------------------------------------------------------------------------------------------------
 * PK06 – courses, gift cards, products and stock. Every read answers [] before its tables exist.
 * ----------------------------------------------------------------------------------------------*/

/**
 * Courses open at the end of the "as at" date D (= q.to): sold on or before D, not cancelled by the end of D, D on
 * or before the expiry (the expiry day itself still counts). Sessions used = uses dated on or before D and not
 * reversed by the end of D. Value = the sale line's total less credit notes on that line issued on or before D.
 * Tenant ids in the subqueries come from the outer row (D1 allows at most 100 bound parameters per statement).
 */
async function courseFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<{ open: CourseFact[]; sold: CourseSaleFact[] }> {
  assertTenantId(tenantId);
  return readOrEmpty("pms_patient_courses", { open: [], sold: [] } as { open: CourseFact[]; sold: CourseSaleFact[] }, async () => {
    const [open, sold] = await Promise.all([
      sql<{ site_id: string | null; expires_on: string | null; sessions_total: number | string; used: number | string; net: number | string | null; n: number | string }>`
        select x.site_id, x.expires_on, x.sessions_total, x.used, x.net, count(*) as n from (
        select i.site_id, c.expires_on, c.sessions_total,
          (select count(*) from pms_course_uses u where u.tenant_id = c.tenant_id and u.patient_course_id = c.id and u.used_on <= ${q.to} and (u.reversed_at is null or u.reversed_at >= ${q.end})) as used,
          l.total_pence - coalesce((select sum(cl.total_pence) from pms_credit_note_lines cl join pms_credit_notes cn on cn.tenant_id = cl.tenant_id and cn.id = cl.credit_note_id where cl.tenant_id = l.tenant_id and cl.invoice_line_id = l.id and cn.issued_on <= ${q.to}), 0) as net
        from pms_patient_courses c
        join pms_invoices i on i.tenant_id = c.tenant_id and i.id = c.sale_invoice_id
        join pms_invoice_lines l on l.tenant_id = c.tenant_id and l.id = c.sale_line_id
        where c.tenant_id = ${tenantId} and c.sold_on <= ${q.to} and (c.cancelled_at is null or c.cancelled_at >= ${q.end}) and (c.expires_on is null or c.expires_on >= ${q.to})${siteIn("i.site_id", q.siteIds)}
        ) x
        group by x.site_id, x.expires_on, x.sessions_total, x.used, x.net
      `.execute(ctx.db),
      sql<{ d: string; site_id: string | null; n: number | string; total: number | string | null }>`
        select c.sold_on as d, i.site_id, count(*) as n, sum(l.total_pence) as total
        from pms_patient_courses c
        join pms_invoices i on i.tenant_id = c.tenant_id and i.id = c.sale_invoice_id
        join pms_invoice_lines l on l.tenant_id = c.tenant_id and l.id = c.sale_line_id
        where c.tenant_id = ${tenantId} and c.sold_on >= ${q.from} and c.sold_on <= ${q.to}${siteIn("i.site_id", q.siteIds)}
        group by 1, 2
      `.execute(ctx.db),
    ]);
    return {
      open: open.rows.map((r) => ({ siteId: r.site_id, expiresOn: r.expires_on, sessionsTotal: num(r.sessions_total), sessionsUsed: Math.min(num(r.used), num(r.sessions_total)), netPence: num(r.net ?? 0), courses: num(r.n) })),
      sold: sold.rows.map((r) => ({ date: r.d, siteId: r.site_id, courses: num(r.n), amountPence: num(r.total ?? 0) })),
    };
  });
}

/**
 * Gift-card moves up to the end of the "as at" date, before / in the period: a sale by the card's sale date (the
 * invoice's issue date), any other move by when it was recorded. Cards without a sale invoice site count as "no site".
 */
async function giftCardFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<GiftCardFact[]> {
  assertTenantId(tenantId);
  return readOrEmpty("pms_gift_card_moves", [] as GiftCardFact[], async () => {
    const { rows } = await sql<{ site_id: string | null; expires_on: string | null; kind: string; bucket: string; n: number | string; total: number | string | null }>`
      select i.site_id, g.expires_on, m.kind,
        case when m.kind = 'sale'
          then (case when g.sold_on < ${q.from} then 'before' when g.sold_on <= ${q.to} then 'in' else 'after' end)
          else (case when m.created_at < ${q.start} then 'before' when m.created_at < ${q.end} then 'in' else 'after' end)
        end as bucket,
        count(*) as n, sum(m.amount_pence) as total
      from pms_gift_card_moves m
      join pms_gift_cards g on g.tenant_id = m.tenant_id and g.id = m.gift_card_id
      left join pms_invoices i on i.tenant_id = g.tenant_id and i.id = g.sale_invoice_id
      where m.tenant_id = ${tenantId}${siteIn("i.site_id", q.siteIds)}
      group by 1, 2, 3, 4
    `.execute(ctx.db);
    return rows
      .filter((r) => r.bucket === "before" || r.bucket === "in")
      .map((r) => ({ siteId: r.site_id, expiresOn: r.expires_on, kind: r.kind as GiftCardFactKind, when: r.bucket as "before" | "in", moves: num(r.n), amountPence: num(r.total ?? 0) }));
  });
}

/** Product lines on issued invoices (void left out) and credit notes on them (void kind / void invoices left out). */
async function productSaleFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<ProductSaleFact[]> {
  assertTenantId(tenantId);
  return readOrEmpty("pms_invoice_line_refs", [] as ProductSaleFact[], async () => {
    type Row = { d: string; site_id: string | null; product_id: string; n: number | string; qty: number | string | null; net: number | string | null; vat: number | string | null };
    const [sold, credited] = await Promise.all([
      sql<Row>`
        select i.issued_on as d, i.site_id, r.ref_id as product_id, count(*) as n, sum(l.quantity) as qty, sum(l.net_pence) as net, sum(l.vat_pence) as vat
        from pms_invoice_line_refs r
        join pms_invoice_lines l on l.tenant_id = r.tenant_id and l.id = r.invoice_line_id
        join pms_invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        where r.tenant_id = ${tenantId} and r.ref_type = 'product' and i.status = 'issued' and i.voided_at is null and i.issued_on >= ${q.from} and i.issued_on <= ${q.to}${siteIn("i.site_id", q.siteIds)}
        group by 1, 2, 3
      `.execute(ctx.db),
      sql<Row>`
        select c.issued_on as d, i.site_id, r.ref_id as product_id, count(*) as n, sum(case when cl.line_remaining_after = 0 then l.quantity else 0 end) as qty, sum(cl.net_pence) as net, sum(cl.vat_pence) as vat
        from pms_credit_note_lines cl
        join pms_credit_notes c on c.tenant_id = cl.tenant_id and c.id = cl.credit_note_id
        join pms_invoice_lines l on l.tenant_id = cl.tenant_id and l.id = cl.invoice_line_id
        join pms_invoice_line_refs r on r.tenant_id = l.tenant_id and r.invoice_line_id = l.id
        join pms_invoices i on i.tenant_id = c.tenant_id and i.id = c.invoice_id
        where cl.tenant_id = ${tenantId} and r.ref_type = 'product' and c.kind <> 'void' and i.voided_at is null and c.issued_on >= ${q.from} and c.issued_on <= ${q.to}${siteIn("i.site_id", q.siteIds)}
        group by 1, 2, 3
      `.execute(ctx.db),
    ]);
    const out: ProductSaleFact[] = [];
    const push = (kind: "sold" | "credited", r: Row) => out.push({ date: r.d, siteId: r.site_id, productId: r.product_id, kind, lines: num(r.n), quantity: num(r.qty ?? 0), netPence: num(r.net ?? 0), vatPence: num(r.vat ?? 0) });
    for (const r of sold.rows) push("sold", r);
    for (const r of credited.rows) push("credited", r);
    return out;
  });
}

/** Stock on hand now: the sum of the moves per site and product. */
async function stockFacts(ctx: RepoContext, tenantId: string, q: ReportingQuery): Promise<StockFact[]> {
  assertTenantId(tenantId);
  return readOrEmpty("pms_stock_moves", [] as StockFact[], async () => {
    const { rows } = await sql<{ site_id: string; product_id: string; n: number | string | null }>`
      select s.site_id, s.product_id, sum(s.quantity) as n
      from pms_stock_moves s
      where s.tenant_id = ${tenantId}${siteIn("s.site_id", q.siteIds)}
      group by 1, 2
    `.execute(ctx.db);
    return rows.map((r) => ({ siteId: r.site_id, productId: r.product_id, onHand: num(r.n ?? 0) }));
  });
}

async function products(ctx: RepoContext, tenantId: string): Promise<ReportProduct[]> {
  const list = await listProducts(ctx, tenantId, { includeArchived: true });
  return list.map((p) => ({ id: p.id, name: p.name, sku: p.sku, pricePence: p.pricePence, lowStockAt: p.lowStockAt, active: p.active }));
}

/** Billing's reporting source (registered by default in src/server/pms/reporting/sources.ts). */
export const BILLING_REPORTING_SOURCE: BillingReportingSource = { revenueFacts, debtFacts, courseFacts, giftCardFacts, productSaleFacts, stockFacts, products };
