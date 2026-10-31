import type { Metadata } from "next";
import { currentBrand } from "@/server/brand";

/**
 * Sign-in pages (/login, /two-factor, /accept-invite, /reset-password): never indexed. The tab title names the brand
 * of the host (src/lib/brand.ts): "Sign in · ClinForms" on ClinForms' hosts, the clinic brand's name on its own.
 */
export function generateMetadata(): Metadata {
  const name = currentBrand().productName;
  return {
    title: { default: name, template: `%s · ${name}` },
    robots: { index: false, follow: false },
  };
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
