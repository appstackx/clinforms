"use client";
/**
 * Billing (design round 2c "Billing – invoices, aged debt, remittance"): the totals, the tabs (Invoices / Attended,
 * not invoiced / Aged debt / Remittances / Statements), the invoice list with search, status chips, paging and CSV.
 * Every filter lives in the URL; the server page loads the tab shown. On a phone the table becomes cards.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Download, Plus } from "lucide-react";
import { AGE_BUCKET_LABELS } from "@/modules/pms/billing/aging";
import type { AgedDebtView, BillingFiguresView, InvoiceRowView, UninvoicedVisitView } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { DataTable, EmptyState, FilterBar, FilterSearch, PmsButton, StatusPill, pmsButtonVariants, type DataTableColumn } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money } from "./format";
import { VisitsTable } from "./visits-table";

export type BillingTab = "invoices" | "visits" | "aged" | "remittances" | "statements";

export interface RemittanceRowView {
  id: string;
  on: string;
  payerName: string;
  reference: string | null;
  amountPence: number;
  allocatedPence: number;
  method: string;
}

export interface BillingListProps {
  tab: BillingTab;
  figures: BillingFiguresView;
  /** Invoices tab. */
  rows: InvoiceRowView[];
  total: number;
  page: number;
  pageSize: number;
  state: string;
  q: string;
  /** Attended, not invoiced. */
  visits: UninvoicedVisitView[] | null;
  aged: AgedDebtView | null;
  remittances: RemittanceRowView[] | null;
  statementAccounts: { value: string; label: string }[] | null;
  today: string;
  can: { edit: boolean; pay: boolean; export: boolean };
  failed: string | null;
}

const CHIPS: { state: string; label: string }[] = [
  { state: "all", label: "All" },
  { state: "draft", label: "Draft" },
  { state: "issued", label: "Issued" },
  { state: "part_paid", label: "Part-paid" },
  { state: "paid", label: "Paid" },
  { state: "overdue", label: "Overdue" },
  { state: "void", label: "Void" },
];

function hrefFor(p: { tab?: BillingTab; state?: string; q?: string; page?: number }): string {
  const q = new URLSearchParams();
  if (p.tab && p.tab !== "invoices") q.set("tab", p.tab);
  if (p.state && p.state !== "all") q.set("state", p.state);
  if (p.q) q.set("q", p.q);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `${BILLING_PATH}?${s}` : BILLING_PATH;
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-white px-4 py-3.5">
      <span className="text-sm text-[#475569]">{label}</span>
      <strong className={cn("text-[22px] font-bold leading-7 tabular-nums", tone === "danger" ? "text-destructive-strong" : "text-foreground")}>{value}</strong>
      <span className="text-xs text-[#475569]">{sub}</span>
    </div>
  );
}

export function BillingList(props: BillingListProps) {
  const { tab, figures, rows, total, page, pageSize, state, q, can, failed } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = React.useState(q);
  React.useEffect(() => setQuery(q), [q]);
  // Search as you type, after a short pause.
  React.useEffect(() => {
    if (query === q) return;
    const t = window.setTimeout(() => router.replace(hrefFor({ tab, state, q: query.trim() })), 350);
    return () => window.clearTimeout(t);
  }, [query, q, tab, state, router]);

  const tabs: { key: BillingTab; label: string; hidden?: boolean }[] = [
    { key: "invoices", label: "Invoices" },
    { key: "visits", label: `Attended, not invoiced (${figures.uninvoicedVisits})`, hidden: !can.edit },
    { key: "aged", label: "Aged debt" },
    { key: "remittances", label: "Remittances" },
    { key: "statements", label: "Statements" },
  ];
  const taken = figures.takenTodayByMethod.length ? figures.takenTodayByMethod.map((m) => `${m.label} ${money(m.pence)}`).join(" · ") : "Nothing yet today";

  const columns: DataTableColumn<InvoiceRowView>[] = [
    {
      id: "no",
      header: "Invoice",
      cell: (r) => (
        <Link href={`${BILLING_PATH}/invoices/${r.id}`} className={cn("font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
          {r.number ?? "Draft"}
        </Link>
      ),
    },
    { id: "to", header: "Bill to", cell: (r) => r.billToName, truncateAt: 240 },
    { id: "patient", header: "Patient", cell: (r) => r.patientName },
    { id: "issued", header: "Issued", cell: (r) => date(r.issuedOn), numeric: true },
    { id: "due", header: "Due", cell: (r) => date(r.dueOn), numeric: true },
    { id: "status", header: "Status", cell: (r) => <StatusPill kind="invoice" status={r.state} size="sm" /> },
    { id: "total", header: "Total", cell: (r) => money(r.totalPence), align: "right", numeric: true },
    { id: "balance", header: "Balance", cell: (r) => <strong>{money(Math.max(0, r.balancePence))}</strong>, align: "right", numeric: true },
  ];

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
        <Link href={`${BILLING_PATH}/claims`} className={cn("ml-auto text-sm font-medium text-primary-strong underline underline-offset-2", focusRing)} data-testid="claims-link">
          Insurer claims
        </Link>
        <Link href={`${BILLING_PATH}/payers`} className={cn("text-sm font-medium text-primary-strong underline underline-offset-2", focusRing)} data-testid="payer-accounts-link">
          Payer accounts
        </Link>
        {can.edit ? (
          <Link href={`${BILLING_PATH}/visits`} className={cn(pmsButtonVariants({ variant: "primary" }), "h-9")} data-testid="invoice-visits-button">
            <Plus aria-hidden />
            Invoice attended visits
            <span className="ml-1 rounded-full bg-white px-1.5 text-xs font-bold text-primary-strong" aria-label={`${figures.uninvoicedVisits} waiting`}>
              {figures.uninvoicedVisits}
            </span>
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="billing-figures">
        <Figure label="Outstanding" value={money(figures.outstandingPence)} sub={`${figures.outstandingCount} invoices · patients ${money(figures.outstandingPatientsPence)}, insurers ${money(figures.outstandingAccountsPence)}`} />
        <Figure label="Overdue" value={money(figures.overduePence)} sub={`${figures.overdueCount} invoices past their due date`} tone={figures.overduePence > 0 ? "danger" : undefined} />
        <Figure label="Taken today" value={money(figures.takenTodayPence)} sub={taken} />
      </div>

      <section className="flex min-w-0 flex-col rounded-xl border border-border bg-white">
        <nav aria-label="Billing sections" className="flex gap-1 overflow-x-auto border-b border-border px-3">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => (
              <Link
                key={t.key}
                href={hrefFor({ tab: t.key })}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium", focusRing, tab === t.key ? "border-[#0E958A] text-foreground" : "border-transparent text-[#475569] hover:text-foreground")}
              >
                {t.label}
              </Link>
            ))}
        </nav>

        {failed ? (
          <p role="alert" className="p-4 text-destructive-strong">
            {failed}
          </p>
        ) : null}

        {tab === "invoices" && !failed ? (
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <FilterBar className="min-w-0 flex-1 border-b-0 p-0">
                <FilterSearch id="invoice-search" label="Search invoices" placeholder="Invoice no., patient or insurer" value={query} onChange={setQuery} />
                <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
                  {CHIPS.map((c) => (
                    <Link
                      key={c.state}
                      href={hrefFor({ tab, state: c.state, q })}
                      aria-current={state === c.state ? "true" : undefined}
                      className={cn(
                        "inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium",
                        focusRing,
                        state === c.state ? "border-[#0F172A] bg-[#0F172A] text-white" : "border-border bg-white text-[#334155] hover:bg-[#F8FAFC]",
                      )}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </FilterBar>
              {can.export ? (
                <a href={`${BILLING_PATH}/export?${new URLSearchParams({ state, q }).toString()}`} className={cn(pmsButtonVariants({ variant: "secondary" }), "ml-auto")} download>
                  <Download aria-hidden />
                  CSV
                </a>
              ) : null}
            </div>
            <DataTable
              label="Invoices"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              minWidth={900}
              renderCard={(r) => (
                <Link href={`${BILLING_PATH}/invoices/${r.id}`} className={cn("flex flex-col gap-1 rounded-xl border border-border bg-white p-3", focusRing)}>
                  <span className="flex items-center justify-between gap-2">
                    <strong className="text-primary-strong">{r.number ?? "Draft"}</strong>
                    <StatusPill kind="invoice" status={r.state} size="sm" />
                  </span>
                  <span className="text-sm text-foreground">{r.billToName}</span>
                  <span className="flex justify-between text-sm text-[#475569]">
                    <span>{r.patientName}</span>
                    <strong className="text-foreground">{money(Math.max(0, r.balancePence))}</strong>
                  </span>
                </Link>
              )}
              empty={
                <EmptyState
                  title={state === "all" && !q ? "No invoices yet" : "No invoices with this status"}
                  action={
                    state !== "all" || q ? (
                      <PmsButton variant="secondary" onClick={() => router.replace(hrefFor({ tab }))}>
                        Show all
                      </PmsButton>
                    ) : undefined
                  }
                >
                  {state === "all" && !q ? "Invoice attended visits to start." : null}
                </EmptyState>
              }
              pagination={total > pageSize ? { page, pageSize, total, onPageChange: (p) => router.push(hrefFor({ tab, state, q, page: p })) } : undefined}
            />
          </div>
        ) : null}

        {tab === "visits" && props.visits ? (
          <div className="flex flex-col gap-3 p-3">
            <p className="text-sm text-[#475569]">Completed visits, and missed or late-cancelled ones with a fee, that have no invoice yet. Insured visits create a patient invoice for the patient&apos;s part (excess or contribution) and an insurer invoice for the rest.</p>
            <VisitsTable visits={props.visits} mode="tab" today={props.today} />
          </div>
        ) : null}

        {tab === "aged" && props.aged ? <AgedDebt aged={props.aged} /> : null}

        {tab === "remittances" && props.remittances ? (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[#475569]">Payments from insurers and other accounts. Allocate one payment across their invoices; short payments can be written off or moved to the patient.</p>
              {can.pay ? (
                <Link href={`${BILLING_PATH}/remittances/new`} className={pmsButtonVariants({ variant: "primary" })} data-testid="new-remittance">
                  Allocate an insurer payment
                </Link>
              ) : null}
            </div>
            {props.remittances.length === 0 ? (
              <p className="text-sm text-[#475569]">No payments from accounts yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Payments from accounts</caption>
                  <thead className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
                    <tr>
                      <th scope="col" className="px-3 py-2">Received</th>
                      <th scope="col" className="px-3 py-2">Account</th>
                      <th scope="col" className="px-3 py-2">Reference</th>
                      <th scope="col" className="px-3 py-2">Method</th>
                      <th scope="col" className="px-3 py-2 text-right">Amount</th>
                      <th scope="col" className="px-3 py-2 text-right">Unallocated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.remittances.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums">{date(r.on)}</td>
                        <td className="px-3 py-2">{r.payerName}</td>
                        <td className="px-3 py-2">{r.reference ?? "–"}</td>
                        <td className="px-3 py-2">{r.method}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.amountPence)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.amountPence - r.allocatedPence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "statements" && props.statementAccounts ? <StatementForm accounts={props.statementAccounts} today={props.today} pathname={pathname} /> : null}
      </section>
    </div>
  );
}

function AgedDebt({ aged }: { aged: AgedDebtView }) {
  const cols = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[1fr_340px]">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[620px] text-sm" data-testid="aged-debt">
          <caption className="px-3 py-2 text-left font-semibold text-foreground">Aged debt at {date(aged.asOf)}</caption>
          <thead className="bg-[#F8FAFC] text-xs font-semibold text-[#334155]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Account type</th>
              {cols.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-right">
                  {AGE_BUCKET_LABELS[c] === "Not yet due" ? "Current" : AGE_BUCKET_LABELS[c]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {aged.rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {r.label}
                </th>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 text-right tabular-nums">
                    {money(r.buckets[c])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(r.totalPence)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#0F172A]">
              <th scope="row" className="px-3 py-2 text-left font-semibold">
                Total
              </th>
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 text-right font-semibold tabular-nums">
                  {money(aged.totals[c])}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-bold tabular-nums">{money(aged.totals.totalPence)}</td>
            </tr>
          </tbody>
        </table>
        {aged.refundsDuePence > 0 ? <p className="px-3 py-2 text-xs text-[#475569]">Refunds due (owed back, not netted off): {money(aged.refundsDuePence)}</p> : null}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <strong className="text-foreground">Largest overdue accounts</strong>
        {aged.largest.length === 0 ? <p className="text-sm text-[#475569]">Nothing overdue.</p> : null}
        {aged.largest.map((d) => (
          <div key={d.key} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="text-xs text-[#475569]">{d.daysOverdue} days</span>
            <span className="font-semibold tabular-nums">{money(d.amountPence)}</span>
            <Link
              className={cn(pmsButtonVariants({ variant: "secondary", size: "sm" }))}
              href={`${BILLING_PATH}/statements/print?${new URLSearchParams(d.patientId ? { patient: d.patientId } : { account: d.payerReferrerId ?? "" }).toString()}`}
            >
              Statement
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementForm({ accounts, today, pathname }: { accounts: { value: string; label: string }[]; today: string; pathname: string }) {
  const [account, setAccount] = React.useState(accounts[0]?.value ?? "");
  const firstOfQuarter = `${today.slice(0, 5)}${String(Math.max(1, Number(today.slice(5, 7)) - 2)).padStart(2, "0")}-01`;
  const [from, setFrom] = React.useState(firstOfQuarter);
  const [until, setUntil] = React.useState(today);
  void pathname;
  const [kind, id] = account.split(":");
  const href = `${BILLING_PATH}/statements/print?${new URLSearchParams({ [kind === "patient" ? "patient" : "account"]: id ?? "", from, until }).toString()}`;
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm text-[#475569]">A statement lists invoices, credit notes, payments and refunds in a period with the running balance and the age of what is owed.</p>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Account
          <select value={account} onChange={(e) => setAccount(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] bg-white px-2 text-sm", focusRing)} data-testid="statement-account">
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2 text-sm", focusRing)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          To
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2 text-sm", focusRing)} />
        </label>
        {account ? (
          <Link href={href} className={pmsButtonVariants({ variant: "primary" })} data-testid="statement-open">
            Open statement
          </Link>
        ) : null}
      </div>
      {accounts.length === 0 ? <p className="text-sm text-[#475569]">Nobody owes anything – no statement to send.</p> : null}
    </div>
  );
}
