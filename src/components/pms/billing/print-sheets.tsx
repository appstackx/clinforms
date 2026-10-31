/**
 * A4 print layouts (design round 3 "Print – invoice A4" and "Print – patient statement A4"): the clinic's
 * letterhead, who it is for, the lines, totals, how to pay and the printed-by footer. Presentational only – used by
 * the print pages (which add the A4 print stylesheet) and, scaled down, by the invoice's preview.
 * Black on white, no colour needed to read it; "Demonstration" notice on demo clinics comes from the page.
 */
import { Fragment } from "react";
import type { InvoiceDetailView, PrintClinic, StatementView } from "@/modules/pms/billing/view";
import { contributionWording } from "@/modules/pms/billing/excess";
import { INVOICE_STATE_LABELS } from "@/modules/pms/billing/status";
import { vatLabel } from "@/modules/pms/billing/vat";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";

const money = (p: number) => formatPence(p);
const d = (iso: string | null) => (iso ? formatUkDate(iso) : "–");

function stamp(at: string): string {
  const t = new Date(at);
  const date = t.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
  const time = t.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function Letterhead({ clinic, title, sub }: { clinic: PrintClinic; title: string; sub: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <strong className="text-[17px] leading-6">{clinic.name}</strong>
        {clinic.lines.map((l) => (
          <span key={l} className="text-[13px]">
            {l}
          </span>
        ))}
        {clinic.contact ? <span className="text-[13px]">{clinic.contact}</span> : null}
        {clinic.vatNumber ? <span className="text-[13px]">VAT no. {clinic.vatNumber}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <strong className="text-[28px] font-bold leading-8 tracking-wide">{title}</strong>
        <span className="text-[13px]">{sub}</span>
      </div>
    </header>
  );
}

function Footer({ printedBy, printedAt }: { printedBy: string; printedAt: string }) {
  return (
    <footer className="mt-auto flex justify-between border-t border-[#94A3B8] pt-2 text-[11px] print:fixed print:bottom-[12mm] print:left-[18mm] print:right-[18mm]">
      <span>
        Printed {stamp(printedAt)} by {printedBy}
      </span>
      <span>Page 1 of 1</span>
    </footer>
  );
}

export function PrintInvoiceSheet({ clinic, invoice: inv, howToPay, printedBy, printedAt, demo }: { clinic: PrintClinic; invoice: InvoiceDetailView; howToPay: string[]; printedBy: string; printedAt: string; demo?: boolean }) {
  const insured = inv.billTo === "payer";
  const excessTotal = inv.lines.reduce((a, l) => a + l.excessPence, 0);
  const paidRows = inv.money.filter((m) => m.amountPence < 0);
  const refundRows = inv.money.filter((m) => m.amountPence > 0);
  return (
    <article className="print-sheet mx-auto flex min-h-[1123px] w-[794px] flex-col gap-6 bg-white px-[68px] py-[64px] text-[14px] leading-5 text-[#0F172A]" data-testid="print-invoice">
      <Letterhead clinic={clinic} title={inv.status === "draft" ? "DRAFT INVOICE" : "INVOICE"} sub={inv.number ?? "Not yet numbered"} />
      <section className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong>Bill to</strong>
          <span>{inv.billToName}</span>
          {inv.billToLines.map((l) => (
            <span key={l}>{l}</span>
          ))}
          {inv.billToReferences.map((r) => (
            <span key={r.label}>
              {r.label}: {r.value}
            </span>
          ))}
        </div>
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-right">
          <dt>Issued</dt>
          <dd>{d(inv.issuedOn)}</dd>
          <dt>Due</dt>
          <dd>{d(inv.dueOn)}</dd>
          <dt>Status</dt>
          <dd className="font-semibold">{INVOICE_STATE_LABELS[inv.state]}</dd>
        </dl>
      </section>
      <table className="w-full border-collapse text-[14px]">
        <caption className="sr-only">Items</caption>
        <thead>
          <tr className="border-b-2 border-[#0F172A] text-left">
            <th scope="col" className="py-2 pr-3">Date</th>
            <th scope="col" className="py-2 pr-3">Item</th>
            <th scope="col" className="py-2 pr-3">Practitioner</th>
            {insured && excessTotal > 0 ? (
              <>
                <th scope="col" className="py-2 pr-3 text-right">Fee</th>
                <th scope="col" className="py-2 pr-3 text-right">{contributionWording(inv.contribution?.mode ?? "per_case").column}</th>
              </>
            ) : null}
            <th scope="col" className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b border-[#CBD5E1] align-top">
              <td className="py-2.5 pr-3 tabular-nums">{d(l.serviceOn)}</td>
              <td className="py-2.5 pr-3">{l.description}</td>
              <td className="py-2.5 pr-3">{l.practitionerName ? `${l.practitionerName}${l.practitionerRegistration ? `, ${l.practitionerRegistration}` : ""}` : ""}</td>
              {insured && excessTotal > 0 ? (
                <>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(l.totalPence)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{l.excessPence ? `−${money(l.excessPence)}` : ""}</td>
                </>
              ) : null}
              <td className="py-2.5 text-right tabular-nums">{money(l.totalPence - l.excessPence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto grid w-[300px] grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        {inv.vatRegistered && inv.vatPence > 0 ? (
          <>
            <span>Net</span>
            <span className="text-right tabular-nums">{money(inv.netPence)}</span>
            <span>VAT</span>
            <span className="text-right tabular-nums">{money(inv.vatPence)}</span>
          </>
        ) : null}
        <span>Total</span>
        <span className="text-right tabular-nums">{money(inv.totalPence)}</span>
        {paidRows.map((m) => (
          <Fragment key={m.id}>
            <span>
              {m.kind === "payment" ? "Paid" : m.label.split(" ")[0]} {d(m.on)}
              {m.kind === "payment" ? ` · ${m.label.replace(/^Payment – /, "").replace(/^Remittance /, "remittance ")}` : ""}
            </span>
            <span className="text-right tabular-nums">−{money(-m.amountPence)}</span>
          </Fragment>
        ))}
        {refundRows.map((m) => (
          <Fragment key={m.id}>
            <span>Refunded {d(m.on)}</span>
            <span className="text-right tabular-nums">{money(m.amountPence)}</span>
          </Fragment>
        ))}
        <strong className="border-t-2 border-[#0F172A] pt-2 text-[17px]">Balance due</strong>
        <strong className="border-t-2 border-[#0F172A] pt-2 text-right text-[17px] tabular-nums">{money(Math.max(0, inv.balancePence))}</strong>
      </div>
      {howToPay.length ? (
        <section className="flex flex-col gap-1.5 rounded-[6px] border border-[#0F172A] px-4 py-3">
          <strong>How to pay</strong>
          {howToPay.map((h, i) => (
            <span key={`${i}-${h}`}>{h}</span>
          ))}
        </section>
      ) : null}
      <p className="text-[13px]">
        {inv.vatRegistered ? `VAT: ${Array.from(new Set(inv.lines.map((l) => vatLabel(l.vatCode, l.vatRateBp)))).join(", ")}.` : "Physiotherapy is exempt from VAT."} Thank you.
      </p>
      {demo ? <p className="text-[12px] font-semibold">Demonstration clinic – fictional patient and invoice. Do not pay.</p> : null}
      <Footer printedBy={printedBy} printedAt={printedAt} />
    </article>
  );
}

export function PrintStatementSheet({ clinic, statement: s, printedBy, printedAt, demo }: { clinic: PrintClinic; statement: StatementView; printedBy: string; printedAt: string; demo?: boolean }) {
  return (
    <article className="print-sheet mx-auto flex min-h-[1123px] w-[794px] flex-col gap-6 bg-white px-[68px] py-[64px] text-[14px] leading-5 text-[#0F172A]" data-testid="print-statement">
      <Letterhead clinic={clinic} title="STATEMENT" sub={`${d(s.from)} – ${d(s.until)}`} />
      <section className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span>{s.account.name}</span>
          {s.account.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
          {s.account.reference ? <span>{s.account.reference}</span> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 rounded-[6px] border-2 border-[#0F172A] px-4 py-2.5">
          <span className="text-[13px]">Balance due</span>
          <strong className="text-[26px] tabular-nums" data-testid="statement-balance">
            {money(Math.max(0, s.closingPence))}
          </strong>
        </div>
      </section>
      <table className="w-full border-collapse">
        <caption className="sr-only">Statement</caption>
        <thead>
          <tr className="border-b-2 border-[#0F172A] text-left">
            <th scope="col" className="py-2 pr-3">Date</th>
            <th scope="col" className="py-2 pr-3">Details</th>
            <th scope="col" className="py-2 pr-3 text-right">Charges</th>
            <th scope="col" className="py-2 pr-3 text-right">Payments</th>
            <th scope="col" className="py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#CBD5E1]">
            <td className="py-2.5 pr-3 tabular-nums">{d(s.from)}</td>
            <td className="py-2.5 pr-3">Opening balance</td>
            <td />
            <td />
            <td className="py-2.5 text-right tabular-nums">{money(s.openingPence)}</td>
          </tr>
          {s.rows.map((r, i) => (
            <tr key={i} className="border-b border-[#CBD5E1]">
              <td className="py-2.5 pr-3 tabular-nums">{d(r.on)}</td>
              <td className="py-2.5 pr-3">{r.details}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{r.chargePence ? money(r.chargePence) : ""}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{r.paymentPence ? money(r.paymentPence) : ""}</td>
              <td className="py-2.5 text-right tabular-nums">{money(r.balancePence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-4 overflow-hidden rounded-[6px] border border-[#0F172A] text-center" data-testid="statement-ages">
        {(
          [
            ["Current", s.ages.current],
            ["31–60 days", s.ages.d31_60],
            ["61–90 days", s.ages.d61_90],
            ["Over 90 days", s.ages.d90_plus],
          ] as const
        ).map(([label, v], i) => (
          <div key={label} className={i > 0 ? "border-l border-[#0F172A] px-2 py-2" : "px-2 py-2"}>
            <div className="text-[13px]">{label}</div>
            <strong className="tabular-nums">{money(v)}</strong>
          </div>
        ))}
      </div>
      {s.howToPay.length ? <p>Please pay: {s.howToPay.join(" · ")}. If you have already paid, thank you – please ignore this statement.</p> : null}
      {demo ? <p className="text-[12px] font-semibold">Demonstration clinic – fictional patient. Do not pay.</p> : null}
      <Footer printedBy={printedBy} printedAt={printedAt} />
    </article>
  );
}

/** The A4 print stylesheet: only the sheet prints, on A4, without the app around it. */
export const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .print-root, .print-root * { visibility: visible !important; }
  .print-root { position: absolute !important; left: 0; top: 0; width: 210mm; padding: 0 !important; margin: 0 !important; background: #fff !important; }
  .print-root .print-sheet { width: 210mm !important; min-height: 297mm !important; padding: 16mm 18mm !important; box-shadow: none !important; }
  .print-toolbar { display: none !important; }
}
`;
