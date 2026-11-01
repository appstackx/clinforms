/**
 * The clinic-system offer card for a ClinForms clinic's owners and admins (01/11/2026, Khuram's R2). Copy and the rule
 * of who sees it: src/lib/clindesk-offer.ts. `onHide` (the Overview only) adds "Hide this" (a server action).
 */
import Link from "next/link";
import { CLINDESK_OFFER, CLINDESK_OFFER_BUY_HREF } from "@/lib/clindesk-offer";
import { cn } from "@/lib/utils";

export function ClinDeskOfferCard({ onHide, className, showSwitchNote = false }: { onHide?: () => Promise<void>; className?: string; showSwitchNote?: boolean }) {
  return (
    <section aria-labelledby="clinic-offer-title" className={cn("rounded-2xl border border-teal-200 bg-teal-50/60 p-5 shadow-sm sm:p-6", className)} data-testid="clinic-system-offer">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="clinic-offer-title" className="text-base font-semibold text-slate-900">
            {CLINDESK_OFFER.title}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{CLINDESK_OFFER.pitch}</p>
          <ul className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
            {CLINDESK_OFFER.features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5 text-teal-700">
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {showSwitchNote ? <p className="mt-3 text-xs text-slate-600">{CLINDESK_OFFER.switchNote}</p> : null}
        </div>
        {onHide ? (
          <form action={onHide}>
            <button type="submit" className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
              {CLINDESK_OFFER.hide}
            </button>
          </form>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={CLINDESK_OFFER_BUY_HREF}
          className="inline-flex h-10 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          data-testid="clinic-system-offer-buy"
        >
          {CLINDESK_OFFER.buy}
        </Link>
        <a
          href={CLINDESK_OFFER.infoHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-teal-800 underline underline-offset-4 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {CLINDESK_OFFER.info}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}
