import Link from "next/link";
import { cn } from "@/lib/utils";
import { BILLING_PATH, date, focusRing, money } from "@/components/pms/billing/format";
import { PmsNotice, pmsButtonVariants } from "@/components/pms/ui";
import { requireClinicActor } from "@/server/pms/actor";
import { claimsFor } from "@/server/pms/billing/claims";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Insurer claims" }, "billing.view");

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const field = "h-9 rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-foreground";

/**
 * /app/clinic/billing/claims (K2-BILL-011): choose a payer account and the invoice dates → the issued invoices to
 * claim → "Download claims file" (CSV, one row per treatment, each invoice logged as sent). Healthcode e-billing is
 * listed as not connected. billing.view; the download also reports.export (checked again on the server).
 */
export default async function ClaimsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await claimsFor(actor, { payerReferrerId: one(searchParams.payer) || undefined, from: one(searchParams.from) || undefined, until: one(searchParams.until) || undefined, includeSent: one(searchParams.sent) === "1" });
  const v = r.ok ? r.value : null;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1080px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>Insurer claims</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Insurer claims</h1>
      <p className="text-sm text-[#475569]">The claims file lists the issued invoices of one payer account, one row per treatment, with the membership number, claim reference and authorisation code – to upload to the insurer&apos;s provider portal or send as agreed with them.</p>
      {!r.ok ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {r.error}
        </p>
      ) : null}
      {v ? (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-4" data-testid="claims-filter">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Payer account
              <select name="payer" defaultValue={v.query.payerReferrerId ?? ""} className={cn(field, "min-w-[240px]")} required>
                <option value="">Choose a payer account</option>
                {v.payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Invoices from
              <input type="date" name="from" defaultValue={v.query.from} className={field} required />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              to
              <input type="date" name="until" defaultValue={v.query.until} className={field} required />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="sent" value="1" defaultChecked={v.query.includeSent} className="h-4 w-4 accent-[#0B7970]" />
              Include invoices already claimed
            </label>
            <button type="submit" className={pmsButtonVariants({ variant: "secondary" })}>
              Show invoices
            </button>
          </form>

          {v.payerName ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4" aria-labelledby="claims-h">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="claims-h" className="text-base font-semibold">
                  {v.payerName}
                </h2>
                <span className="text-sm text-[#475569]" data-testid="claims-summary">
                  {v.rows.length === 1 ? "1 invoice" : `${v.rows.length} invoices`} · {money(v.totalPence)}
                  {v.alreadySent && !v.query.includeSent ? ` · ${v.alreadySent} already claimed (left out)` : ""}
                </span>
                {v.canDownload && v.rows.length > 0 ? (
                  <form method="post" action={`${BILLING_PATH}/claims/file`} className="ml-auto">
                    <input type="hidden" name="payerReferrerId" value={v.query.payerReferrerId ?? ""} />
                    <input type="hidden" name="from" value={v.query.from} />
                    <input type="hidden" name="until" value={v.query.until} />
                    <input type="hidden" name="includeSent" value={v.query.includeSent ? "1" : ""} />
                    <button type="submit" className={pmsButtonVariants({ variant: "primary" })} data-testid="claims-download">
                      Download claims file (CSV)
                    </button>
                  </form>
                ) : null}
              </div>
              {!v.canDownload ? <p className="text-sm text-[#475569]">Downloading the claims file needs the &quot;Export data&quot; permission.</p> : null}
              {v.rows.length === 0 ? (
                <p className="text-sm text-[#475569]">No issued invoices to claim for this payer and dates.</p>
              ) : (
                <ScrollRegion label="Claims" className="relative overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm" data-testid="claims-table">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-[#475569]">
                        <th scope="col" className="py-2 pr-3">Invoice</th>
                        <th scope="col" className="py-2 pr-3">Issued</th>
                        <th scope="col" className="py-2 pr-3 text-right">Total</th>
                        <th scope="col" className="py-2 pr-3 text-right">Balance</th>
                        <th scope="col" className="py-2">Claimed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.rows.map((row) => (
                        <tr key={row.id} className="border-b border-border last:border-0">
                          <td className="py-2 pr-3">
                            <Link href={`${BILLING_PATH}/invoices/${row.id}`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
                              {row.number}
                            </Link>
                          </td>
                          <td className="py-2 pr-3">{date(row.issuedOn)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money(row.totalPence)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money(row.balancePence)}</td>
                          <td className="py-2">{row.sentAt ? date(row.sentAt.slice(0, 10)) : "Not yet"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              )}
              {v.rows.length > v.maxPerFile ? <p className="text-sm text-[#864E0E]">At most {v.maxPerFile} invoices go in one file – choose a shorter date range.</p> : null}
            </section>
          ) : null}

          <section aria-labelledby="channels-h" className="flex flex-col gap-2">
            <h2 id="channels-h" className="text-base font-semibold">
              How claims are sent
            </h2>
            {v.channels.map((c) => (
              <PmsNotice key={c.id} tone={c.connected ? "info" : "warning"} title={`${c.label} – ${c.connected ? "available" : "not connected"}`}>
                {c.description}
              </PmsNotice>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
