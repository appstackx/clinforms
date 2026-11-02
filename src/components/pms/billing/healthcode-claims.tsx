/**
 * The claims page's Healthcode tab (HC12, docs/clinic-system/healthcode.md): the issued insurer invoices of the dates,
 * split into "Ready" and "Needs review" (each reason with a link to fix it), and the export log by batch. The
 * Healthcode file button stays disabled until file submission is switched on – nothing is sent from here.
 * Server-rendered (links and a GET form only).
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { HealthcodeClaimRow, HealthcodeClaimsView } from "@/modules/pms/billing/healthcode";
import { PmsNotice, pmsButtonVariants } from "@/components/pms/ui";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { BILLING_PATH, date, focusRing, money } from "./format";

const field = "h-9 rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-foreground";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Rows({ rows, testId, reasons }: { rows: HealthcodeClaimRow[]; testId: string; reasons: boolean }) {
  return (
    <ScrollRegion label={reasons ? "Invoices that need review" : "Invoices ready for Healthcode"} className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-[#475569]">
            <th scope="col" className="py-2 pr-3">Invoice</th>
            <th scope="col" className="py-2 pr-3">Issued</th>
            <th scope="col" className="py-2 pr-3">Patient</th>
            <th scope="col" className="py-2 pr-3">Insurer</th>
            <th scope="col" className="py-2 pr-3 text-right">Total</th>
            <th scope="col" className="py-2">{reasons ? "What to do" : "Site ID"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoiceId} className="border-b border-border align-top last:border-0" data-testid={`${testId}-row`}>
              <td className="py-2 pr-3">
                <Link href={`${BILLING_PATH}/invoices/${r.invoiceId}`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
                  {r.number}
                </Link>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{date(r.issuedOn)}</td>
              <td className="py-2 pr-3">{r.patientName}</td>
              <td className="py-2 pr-3">{r.payerName}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(r.totalPence)}</td>
              <td className="py-2">
                {reasons ? (
                  <ul className="flex flex-col gap-1">
                    {r.issues.map((i, k) => (
                      <li key={k}>
                        {i.message}
                        {i.fix ? (
                          <>
                            {" "}
                            <Link href={i.fix.href} className={cn("whitespace-nowrap text-primary-strong underline underline-offset-2", focusRing)}>
                              {i.fix.label}
                            </Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="font-mono text-xs">{r.siteCode}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function HealthcodeClaims({ view }: { view: HealthcodeClaimsView }) {
  const total = view.ready.length + view.needsReview.length;
  return (
    <div className="flex flex-col gap-4" data-testid="healthcode-tab">
      <p className="text-sm text-[#475569]">
        Issued insurer invoices, checked against what Healthcode needs. Fix the ones that need review – each reason links to the screen that fixes it – and they move to Ready.
      </p>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-4" data-testid="healthcode-filter">
        <input type="hidden" name="tab" value="healthcode" />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Insurer
          <select name="payer" defaultValue={view.query.payerReferrerId ?? ""} className={cn(field, "min-w-[220px]")}>
            <option value="">Every insurer</option>
            {view.payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Invoices from
          <input type="date" name="from" defaultValue={view.query.from} className={field} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          to
          <input type="date" name="until" defaultValue={view.query.until} className={field} required />
        </label>
        <button type="submit" className={pmsButtonVariants({ variant: "secondary" })}>
          Show invoices
        </button>
      </form>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4" aria-labelledby="hc-ready-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="hc-ready-h" className="text-base font-semibold">
            Ready <span className="font-normal text-[#475569]">· {count(view.ready.length, "invoice", "invoices")}</span>
          </h2>
          <div className="ml-auto flex flex-col items-end gap-1">
            <button type="button" disabled={!view.fileEnabled || view.ready.length === 0} aria-describedby="hc-file-note" className={pmsButtonVariants({ variant: "primary" })} data-testid="healthcode-download">
              Download Healthcode file
            </button>
            {!view.fileEnabled ? (
              <span id="hc-file-note" className="text-xs text-[#475569]" data-testid="healthcode-file-note">
                {view.fileNote}
              </span>
            ) : null}
          </div>
        </div>
        {view.notes.map((n) => (
          <p key={n} className="text-sm text-[#475569]">
            {n}
          </p>
        ))}
        {view.ready.length === 0 ? <p className="text-sm text-[#475569]">{total === 0 ? "No issued insurer invoices in these dates." : "None yet – the invoices below need a little more first."}</p> : <Rows rows={view.ready} testId="healthcode-ready" reasons={false} />}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4" aria-labelledby="hc-review-h">
        <h2 id="hc-review-h" className="text-base font-semibold">
          Needs review <span className="font-normal text-[#475569]">· {count(view.needsReview.length, "invoice", "invoices")}</span>
        </h2>
        {view.needsReview.length === 0 ? <p className="text-sm text-[#475569]">Nothing to review.</p> : <Rows rows={view.needsReview} testId="healthcode-review" reasons />}
      </section>
      {view.truncated ? <p className="text-sm text-[#864E0E]">Only the first 200 invoices are checked – choose a shorter date range to see the rest.</p> : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4" aria-labelledby="hc-log-h">
        <h2 id="hc-log-h" className="text-base font-semibold">
          Export log
        </h2>
        {view.batches.length === 0 ? (
          <p className="text-sm text-[#475569]">No claims exported yet.</p>
        ) : (
          <ScrollRegion label="Export log" className="relative overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm" data-testid="export-log">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-[#475569]">
                  <th scope="col" className="py-2 pr-3">Batch reference</th>
                  <th scope="col" className="py-2 pr-3">How</th>
                  <th scope="col" className="py-2 pr-3 text-right">Invoices</th>
                  <th scope="col" className="py-2">Exported</th>
                </tr>
              </thead>
              <tbody>
                {view.batches.map((b) => (
                  <tr key={`${b.batchRef}-${b.channel}`} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{b.batchRef}</td>
                    <td className="py-2 pr-3">{b.channelLabel}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.invoices}</td>
                    <td className="py-2">{date(b.createdAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
      <PmsNotice tone="info" title="Sending through Healthcode">
        The clinic&apos;s identifiers and codes are recorded here so bills are ready to go. The Healthcode file itself is switched on once its file format is confirmed with Healthcode; until then claims go by the claims file or the insurer&apos;s portal.
      </PmsNotice>
    </div>
  );
}
