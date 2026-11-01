import type { Metadata } from "next";
import { brandIcons, brandMetadata } from "@/lib/brand";
import { currentBrand } from "@/server/brand";

/**
 * Sign-in pages (/login, /two-factor, /accept-invite, /reset-password): never indexed. The tab title names the brand
 * of the host (src/lib/brand.ts): "Sign in · ClinForms" on ClinForms' hosts, the clinic brand's name on its own; the
 * tab icon is the host brand's too (ClinForms' hosts: the root's src/app/icon.svg, as before).
 */
export function generateMetadata(): Metadata {
  const brand = currentBrand();
  const name = brand.productName;
  const icons = brandIcons(brand);
  return {
    title: { default: name, template: `%s · ${name}` },
    ...brandMetadata(brand),
    robots: { index: false, follow: false },
    ...(icons ? { icons } : {}),
  };
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
