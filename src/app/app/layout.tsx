import type { Metadata } from "next";
import { currentBrand } from "@/server/brand";

/**
 * /app – the signed-in clinic area. Every page and server action checks the session, two-step verification
 * and clinic membership itself (src/server/auth/session.ts); the Edge middleware only redirects requests
 * without a session cookie.
 */
export function generateMetadata(): Metadata {
  // The brand of the host (src/lib/brand.ts): "· ClinForms" on ClinForms' hosts, the clinic brand's name on its own.
  return {
    title: { default: "Clinic", template: `%s · ${currentBrand().productName}` },
    robots: { index: false, follow: false },
  };
}

export default function AppAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}
