import type { Metadata } from "next";
import { brandIcons, brandMetadata } from "@/lib/brand";
import { headers } from "next/headers";
import { currentBrand } from "@/server/brand";
import { notFoundTitle, packageMissingForPath } from "@/server/brand-home";

/**
 * /app – the signed-in clinic area. Every page and server action checks the session, two-step verification
 * and clinic membership itself (src/server/auth/session.ts); the Edge middleware only redirects requests
 * without a session cookie.
 */
export async function generateMetadata(): Promise<Metadata> {
  // The brand of the host (src/lib/brand.ts): "· ClinForms" on ClinForms' hosts, the clinic brand's name on its own –
  // and its tab icon on every signed-in page (ClinForms' hosts: no entry, the root's src/app/icon.svg as before).
  const brand = currentBrand();
  const icons = brandIcons(brand);
  // 01/11/2026 (R3): the clinic area or the Studio of a clinic without its package is the 404 page – titled as one
  // here too (when a layout below answers notFound(), its own metadata is not applied; a template without "%s" names
  // every page below the same).
  const notFound = await packageMissingForPath(headers().get("x-clinforms-path"));
  const template = notFound ? notFoundTitle() : `%s · ${brand.productName}`;
  return {
    title: { default: notFound ? notFoundTitle() : "Clinic", template },
    ...brandMetadata(brand),
    robots: { index: false, follow: false },
    ...(icons ? { icons } : {}),
  };
}

export default function AppAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}
