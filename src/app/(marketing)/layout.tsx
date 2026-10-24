import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PUBLIC_SITE_BRAND } from "@/lib/brand";

/**
 * The public website (/, /request-access, /security and the legal pages): indexable. Static, so it is built for one
 * brand – the public site's (src/lib/brand.ts); hosts of a brand without a public site are sent to sign-in by the
 * middleware.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
      >
        Skip to content
      </a>
      <SiteHeader brand={PUBLIC_SITE_BRAND} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter brand={PUBLIC_SITE_BRAND} />
    </div>
  );
}
