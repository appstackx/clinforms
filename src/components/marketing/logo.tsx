import Link from "next/link";
import { PUBLIC_SITE_BRAND } from "@/lib/brand";

/** The ClinForms mark (same glyph as src/app/icon.svg). Also used by the app's own chrome (account shell). */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#0D9488" />
      <path d="M10 7h9l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="#fff" />
      <path d="M19 7v5h5" fill="#99f6e4" />
      <path d="M12 16h8M12 19.5h8M12 23h5" stroke="#0D9488" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The website's logo: the mark and the name, linking home. Laid out by the site's design system (.logo / .logo-word,
 * src/components/clindesk/styles/site.css), so the name is set like ClinDesk's word mark.
 */
export function Logo({ name = PUBLIC_SITE_BRAND.productName }: { name?: string }) {
  return (
    <Link href="/" className="logo" aria-label={`${name} home`}>
      <LogoMark className="cf-mark" />
      <span className="logo-word">{name}</span>
    </Link>
  );
}
