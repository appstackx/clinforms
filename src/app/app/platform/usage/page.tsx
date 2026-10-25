import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Notice, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { formatPence, formatPenceExact, periodLabel } from "@/lib/packages";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { getDb } from "@/server/db";
import { recentPeriods, ukPeriodOf } from "@/server/repos/usage-period";
import { platformUsage, type PlatformUsageRow } from "@/server/usage/view";
import { SignOutForm } from "../../session-forms";
import { usageQuery } from "./params";

/**
 * /app/platform/usage – ClinForms staff only (as /app/platform: everyone else gets the ordinary 404). Every clinic's
 * month: package, allowance, reports counted (a report counts when its answers are first drafted, or when it is
 * approved if nothing needed drafting), approvals, extra reports and what they would be charged, live calls, tokens,
 * the estimated drafting cost (list prices, converted at the rate shown) and the estimated margin. CSV download.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage – Platform" };

const TH = "px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-sm text-slate-800";
const NUM = `${TD} whitespace-nowrap text-right tabular-nums`;
const TOKENS = `${TD} min-w-[9rem] text-right tabular-nums`;

const count = (n: number) => n.toLocaleString("en-GB");
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

function Tokens({ r }: { r: Pick<PlatformUsageRow, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens"> }) {
  const total = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
  return (
    <>
      {count(total)}
      <span className="block text-xs font-normal text-slate-500">
        in {count(r.inputTokens)} · out {count(r.outputTokens)}
      </span>
      <span className="block text-xs font-normal text-slate-500">
        cache {count(r.cacheReadTokens)} read · {count(r.cacheWriteTokens)} write
      </span>
    </>
  );
}

export default async function PlatformUsagePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const admin = await requirePlatformAdmin();
  const query = usageQuery(searchParams);
  const usage = await platformUsage(getDb(), query.period, query.rate);
  const months = recentPeriods(ukPeriodOf(new Date()), 12);
  if (!months.includes(query.period)) months.push(query.period);
  const t = usage.totals;
  const csvHref = `/app/platform/usage/export?month=${encodeURIComponent(query.period)}${query.rateOverridden ? `&rate=${encodeURIComponent(String(query.rate))}` : ""}`;
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <Link href="/app/platform" className="truncate text-sm font-medium text-slate-800 underline-offset-4 hover:underline">
              Platform
            </Link>
            <span className="text-slate-300" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">Usage</span>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">ClinForms staff</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-600 md:inline">{admin.email}</span>
            <SignOutForm>
              <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Signing out…">
                Sign out
              </SubmitButton>
            </SignOutForm>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[100rem] px-4 py-8">
        <PageHeader
          title={`Usage – ${usage.periodLabel}`}
          description="Every clinic's month (UK calendar month). A report counts once: when its answers are first drafted, or when it is approved if nothing needed drafting. Costs are estimates from list prices; prices exclude VAT."
        />

        <Panel className="mb-6">
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Choose the month">
            <div>
              <label htmlFor="usage-month" className="mb-1 block text-sm font-medium text-slate-800">
                Month
              </label>
              <select
                id="usage-month"
                name="month"
                defaultValue={query.period}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                {months.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="usage-rate" className="mb-1 block text-sm font-medium text-slate-800">
                $1 in £
              </label>
              <input
                id="usage-rate"
                name="rate"
                inputMode="decimal"
                defaultValue={String(query.rate)}
                className="h-10 w-24 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              />
            </div>
            <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
              Show
            </button>
            <a
              href={csvHref}
              className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Download CSV
            </a>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            The rate is {query.rateOverridden ? "the one entered above" : "the deployment's setting (CLINFORMS_USD_GBP_RATE, default 0.79)"}. Margin = price +
            extra reports − estimated drafting cost.
          </p>
        </Panel>

        {!usage.available ? (
          <div className="mb-6">
            <Notice tone="warning">The usage tables are not on this database yet (migration 0007). Nothing is counted until it is applied.</Notice>
          </div>
        ) : null}

        <Panel title={`Clinics (${usage.rows.length})`}>
          {usage.rows.length === 0 ? (
            <p className="text-sm text-slate-600">No clinics yet.</p>
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="min-w-full" data-usage-table>
                <caption className="sr-only">Usage of every clinic in {usage.periodLabel}</caption>
                <thead>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className={TH}>
                      Clinic
                    </th>
                    <th scope="col" className={TH}>
                      Package
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Price
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Allowance
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Counted
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Approved
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Counted, not approved
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Extra
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Extra × rate
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Est. drafting cost
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Est. margin
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Drafting calls
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Form readings
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Tokens
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usage.rows.map((r) => (
                    <tr key={r.tenantId} data-usage-row={r.tenantId}>
                      <th scope="row" className={`${TD} min-w-[11rem] text-left font-normal`}>
                        <span className="font-medium">{r.name}</span>
                        <span className="block break-all font-mono text-xs text-slate-500">
                          {r.tenantId}
                          {r.closed ? " · closed" : ""}
                        </span>
                        {r.demoClinic ? (
                          <span className="mt-1 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" data-usage-demo>
                            Demo clinic
                          </span>
                        ) : null}
                      </th>
                      <td className={TD}>{r.packageLabel}</td>
                      <td className={NUM}>{r.package ? formatPence(r.pricePence) : "–"}</td>
                      <td className={NUM}>{r.reportsIncluded === null ? "–" : count(r.reportsIncluded)}</td>
                      <td className={NUM}>{count(r.counted)}</td>
                      <td className={NUM}>
                        {count(r.approved)}
                        {r.amendmentsApproved ? <span className="block text-xs text-slate-500">+{count(r.amendmentsApproved)} amended</span> : null}
                      </td>
                      <td className={NUM}>{count(r.countedNotApproved)}</td>
                      <td className={NUM}>{r.reportsIncluded === null ? "–" : count(r.extra)}</td>
                      <td className={NUM}>
                        {r.extraReportPence === null ? "–" : formatPenceExact(r.extraChargePence)}
                        {r.extraReportPence !== null ? <span className="block text-xs text-slate-500">at {formatPence(r.extraReportPence)}</span> : null}
                      </td>
                      <td className={NUM}>
                        {formatPenceExact(r.costPence)}
                        <span className="block text-xs text-slate-500">{usd(r.costMicroUsd)}</span>
                      </td>
                      <td className={`${NUM} ${r.marginPence < 0 ? "text-red-700" : ""}`}>{formatPenceExact(r.marginPence)}</td>
                      <td className={NUM}>
                        {count(r.draftingCalls)}
                        {r.failedCalls ? <span className="block text-xs text-amber-800">+{count(r.failedCalls)} failed</span> : null}
                      </td>
                      <td className={NUM}>
                        {count(r.formsRead)}
                        {r.readingCalls ? <span className="block text-xs text-slate-500">{count(r.readingCalls)} live calls</span> : null}
                      </td>
                      <td className={TOKENS}>
                        <Tokens r={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold" data-usage-totals>
                    <th scope="row" className={`${TD} text-left`}>
                      Total
                    </th>
                    <td className={TD} />
                    <td className={NUM}>{formatPence(t.pricePence)}</td>
                    <td className={NUM} />
                    <td className={NUM}>{count(t.counted)}</td>
                    <td className={NUM}>
                      {count(t.approved)}
                      {t.amendmentsApproved ? <span className="block text-xs font-normal text-slate-500">+{count(t.amendmentsApproved)} amended</span> : null}
                    </td>
                    <td className={NUM}>{count(t.countedNotApproved)}</td>
                    <td className={NUM}>{count(t.extra)}</td>
                    <td className={NUM}>{formatPenceExact(t.extraChargePence)}</td>
                    <td className={NUM}>
                      {formatPenceExact(t.costPence)}
                      <span className="block text-xs font-normal text-slate-500">{usd(t.costMicroUsd)}</span>
                    </td>
                    <td className={`${NUM} ${t.marginPence < 0 ? "text-red-700" : ""}`}>{formatPenceExact(t.marginPence)}</td>
                    <td className={NUM}>
                      {count(t.draftingCalls)}
                      {t.failedCalls ? <span className="block text-xs font-normal text-amber-800">+{count(t.failedCalls)} failed</span> : null}
                    </td>
                    <td className={NUM}>{count(t.formsRead)}</td>
                    <td className={TOKENS}>
                      <Tokens r={t} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {usage.rows.some((r) => r.demoClinic) ? (
            <p className="mt-3 text-xs text-slate-500">Demo clinics (made-up data only) are counted like any clinic and are included in the totals: their drafting costs are real.</p>
          ) : null}
        </Panel>
        <p className="mt-4 text-sm">
          <Link href="/app/platform" className="font-medium text-teal-700 underline-offset-4 hover:underline">
            Back to the platform page
          </Link>
        </p>
      </main>
    </>
  );
}
