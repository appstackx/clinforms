import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
 * the one place it is set. /reports and /pms-sandbox refine it in their own layouts. The tab icon is
 * src/app/icon.svg.
 */
export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.tagline,
  applicationName: PRODUCT.name,
  authors: [{ name: PRODUCT.vendor, url: "https://appstackx.co.uk" }],
  // Demo build with fictional data: keep it out of search engines.
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
