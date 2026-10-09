import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { SITE_URL } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";
import "./globals.css";

/** Self-hosted by next/font at build time: no font request to a third party from the browser. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * App-wide metadata. The product name comes from PRODUCT (src/modules/medreport/config.public.ts),
 * the one place it is set. The public site ((marketing)) is indexable; everything else (the demo at
 * /reports and /pms-sandbox, the app, sign-in pages) inherits noindex from here or sets it itself.
 * The tab icon is src/app/icon.svg.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.tagline,
  applicationName: PRODUCT.name,
  authors: [{ name: PRODUCT.vendor, url: "https://appstackx.co.uk" }],
  robots: { index: false, follow: false },
  openGraph: {
    title: PRODUCT.name,
    description: PRODUCT.tagline,
    siteName: PRODUCT.name,
    locale: "en_GB",
    type: "website",
  },
  twitter: { card: "summary", title: PRODUCT.name, description: PRODUCT.tagline },
};

export const viewport: Viewport = {
  themeColor: "#0D9488",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        {/* Cookie choices (never shown in the app or the demo) and consent-gated analytics. */}
        <ConsentBanner />
        <AnalyticsProvider />
      </body>
    </html>
  );
}
