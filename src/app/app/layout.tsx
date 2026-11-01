import type { Metadata } from "next";
import { brandIcons, brandMetadata } from "@/lib/brand";
import { currentBrand } from "@/server/brand";

/**
 * /app – the signed-in clinic area. Every page and server action checks the session, two-step verification
 * and clinic membership itself (src/server/auth/session.ts); the Edge middleware only redirects requests
 * without a session cookie.
 */
export function generateMetadata(): Metadata {
  // The brand of the host (src/lib/brand.ts): "· ClinForms" on ClinForms' hosts, the clinic brand's name on its own –
  // and its tab icon on every signed-in page (ClinForms' hosts: no entry, the root's src/app/icon.svg as before).
  const brand = currentBrand();
  const icons = brandIcons(brand);
  return {
    title: { default: "Clinic", template: `%s · ${brand.productName}` },
    ...brandMetadata(brand),
    robots: { index: false, follow: false },
    ...(icons ? { icons } : {}),
  };
}

export default function AppAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}
