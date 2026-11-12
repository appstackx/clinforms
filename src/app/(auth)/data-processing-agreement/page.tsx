import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark, LegalLinks } from "@/components/account/shell";
import { LegalPage } from "@/components/marketing/legal-page";
import { DPA, dpaIsDraft, fillDpa } from "@/lib/legal/dpa";
import { COMPANY } from "@/lib/site";
import { currentBrand } from "@/server/brand";
import { signupBrandForPage } from "@/server/signup/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data processing agreement" };

/**
 * /data-processing-agreement – the DPA accepted at self-serve sign-up (docs/auth.md §1b), rendered from ONE content file
 * (content/dpa.json, src/lib/legal/dpa.ts). 404 unless CLINFORMS_SELF_SIGNUP is on for this host's brand. While the
 * text is a DRAFT pending legal review the page says so above the text. Not indexed (the sign-in pages' layout).
 */
export default function DataProcessingAgreementPage() {
  if (!signupBrandForPage()) notFound();
  const brand = currentBrand();
  const vars = { product: brand.productName, company: COMPANY.legalName };
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-6 sm:px-6 lg:px-8">
        <Link href="/" aria-label={`${brand.productName} home`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
          <BrandMark name={brand.productName} brand={brand.id} />
        </Link>
      </div>
      {dpaIsDraft() ? (
        <div className="mx-auto mt-6 max-w-3xl px-4 sm:px-6 lg:px-8">
          <div role="note" data-testid="dpa-draft" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>{DPA.status}.</strong> {DPA.statusNote}
          </div>
        </div>
      ) : null}
      <LegalPage title={DPA.title} lastUpdated={DPA.lastUpdated} intro={<p>{fillDpa(DPA.intro, vars)}</p>}>
        {DPA.sections.map((section) => (
          <section key={section.id} aria-labelledby={`dpa-${section.id}`}>
            <h2 id={`dpa-${section.id}`}>{section.heading}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i}>{fillDpa(p, vars)}</p>
            ))}
          </section>
        ))}
        <p className="text-sm text-slate-500">Version: {DPA.version}</p>
      </LegalPage>
      <div className="pb-10">
        <LegalLinks />
      </div>
    </main>
  );
}
